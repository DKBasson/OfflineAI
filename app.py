import asyncio
import atexit
import json
import os
import platform
import shlex
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
import httpx

try:
    from faster_whisper import WhisperModel as _WhisperModel
    _WHISPER_AVAILABLE = True
except ImportError:
    _WHISPER_AVAILABLE = False

try:
    import docx as _docx_module
    _DOCX_AVAILABLE = True
except ImportError:
    _DOCX_AVAILABLE = False

try:
    from odf.opendocument import load as _odf_load
    from odf.teletype import extractText as _odf_extract_text
    from odf import text as _odf_text
    _ODF_AVAILABLE = True
except ImportError:
    _ODF_AVAILABLE = False

try:
    import pypdf as _pypdf
    _PDF_AVAILABLE = True
except ImportError:
    _PDF_AVAILABLE = False

_WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL", "tiny")
_whisper_model: object = None
_whisper_lock = asyncio.Lock()


async def _get_whisper() -> object:
    global _whisper_model
    async with _whisper_lock:
        if _whisper_model is None:
            _whisper_model = await asyncio.to_thread(
                _WhisperModel, _WHISPER_MODEL_SIZE, device="cpu", compute_type="int8"
            )
    return _whisper_model

app = FastAPI(title="OfflineAI")

OLLAMA     = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
HOST       = os.environ.get("OFFLINEAI_HOST", "127.0.0.1")
PORT       = int(os.environ.get("OFFLINEAI_PORT", "8080"))
AUTH_TOKEN = os.environ.get("OFFLINEAI_TOKEN", "").strip()
LAN_MODE   = HOST in {"0.0.0.0", "::"}
AUTH_REQUIRED = LAN_MODE and bool(AUTH_TOKEN)
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}
STATIC_DIR = Path(__file__).parent / "static"
FRONTEND_DIR = Path(__file__).parent / "frontend"
MAX_BODY   = 50 * 1024 * 1024
FALLBACK_MODEL = "gemma4:e4b"
IMAGE_GEN_MAX_WIDTH = int(os.environ.get("OFFLINEAI_IMAGE_MAX_WIDTH", "1024"))
IMAGE_GEN_MAX_HEIGHT = int(os.environ.get("OFFLINEAI_IMAGE_MAX_HEIGHT", "1024"))
IMAGE_GEN_MAX_STEPS = int(os.environ.get("OFFLINEAI_IMAGE_MAX_STEPS", "16"))
IMAGE_GEN_DEFAULT_WIDTH = int(os.environ.get("OFFLINEAI_IMAGE_DEFAULT_WIDTH", "640"))
IMAGE_GEN_DEFAULT_HEIGHT = int(os.environ.get("OFFLINEAI_IMAGE_DEFAULT_HEIGHT", "640"))
IMAGE_GEN_DEFAULT_STEPS = int(os.environ.get("OFFLINEAI_IMAGE_DEFAULT_STEPS", "6"))

_TOKEN_STATS_FILE = Path(__file__).parent / "token_stats.json"

def _load_token_stats() -> dict:
    try:
        if _TOKEN_STATS_FILE.exists():
            raw = json.loads(_TOKEN_STATS_FILE.read_text(encoding="utf-8"))
            return {k: v for k, v in raw.items()
                    if isinstance(v, list) and len(v) == 2
                    and all(isinstance(x, (int, float)) for x in v)}
    except Exception:
        pass
    return {}

def _save_token_stats() -> None:
    try:
        _TOKEN_STATS_FILE.write_text(json.dumps(_token_stats), encoding="utf-8")
    except Exception:
        pass

_token_stats: dict[str, list[int]] = _load_token_stats()

_BASE = Path(__file__).parent
_STYLES_CSS = (_BASE / "styles.css").read_text(encoding="utf-8")

if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if FRONTEND_DIR.is_dir():
    app.mount("/frontend", StaticFiles(directory=str(FRONTEND_DIR)), name="frontend")


@app.middleware("http")
async def require_lan_token(request: Request, call_next):
    client_host = request.client.host if request.client else ""
    is_loopback = client_host in LOOPBACK_HOSTS
    if AUTH_REQUIRED and not is_loopback and request.url.path.startswith("/api/"):
        supplied = request.headers.get("x-offlineai-token") or request.query_params.get("token")
        if supplied != AUTH_TOKEN:
            return JSONResponse({"error": "Authentication required"}, status_code=401)
    return await call_next(request)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    try:
        body_size = int(content_length) if content_length else 0
    except ValueError:
        return JSONResponse({"error": "Invalid Content-Length header"}, status_code=400)
    if body_size > MAX_BODY:
        return JSONResponse({"error": "Request body too large (max 50 MB)"}, status_code=413)
    return await call_next(request)


def _is_loopback_request(request: Request) -> bool:
    client_host = request.client.host if request.client else ""
    return client_host in LOOPBACK_HOSTS or client_host == "::ffff:127.0.0.1"


def _runtime_control_allowed(request: Request) -> bool:
    if _is_loopback_request(request):
        return True
    supplied = request.headers.get("x-offlineai-token") or request.query_params.get("token")
    return bool(AUTH_TOKEN and supplied == AUTH_TOKEN)


def _start_ollama_serve() -> tuple[bool, str]:
    ollama = shutil.which("ollama")
    if not ollama:
        return False, "The ollama command was not found on PATH."

    kwargs = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if platform.system() == "Windows":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen([ollama, "serve"], **kwargs)
    return True, "ollama serve started"


def _restart_ollama_process() -> dict:
    custom_cmd = os.environ.get("OLLAMA_RESTART_CMD", "").strip()
    if custom_cmd:
        try:
            cmd = shlex.split(custom_cmd)
            if not cmd:
                return {"ok": False, "error": "OLLAMA_RESTART_CMD is empty."}
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30, check=False)
            if proc.returncode != 0:
                detail = (proc.stderr or proc.stdout or "").strip()
                return {
                    "ok": False,
                    "error": f"Restart command exited with {proc.returncode}.",
                    "detail": detail,
                    "method": "custom",
                }
            return {"ok": True, "method": "custom"}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "method": "custom"}

    try:
        system = platform.system()
        if system == "Windows":
            taskkill = shutil.which("taskkill")
            if taskkill:
                subprocess.run(
                    [taskkill, "/f", "/im", "ollama.exe"],
                    capture_output=True,
                    text=True,
                    timeout=8,
                    check=False,
                )
        else:
            pkill = shutil.which("pkill")
            killall = shutil.which("killall")
            if pkill:
                subprocess.run([pkill, "-x", "ollama"], capture_output=True, text=True, timeout=8, check=False)
            elif killall:
                subprocess.run([killall, "ollama"], capture_output=True, text=True, timeout=8, check=False)

        time.sleep(0.8)
        started, message = _start_ollama_serve()
        if not started:
            return {"ok": False, "error": message, "method": "ollama serve"}
        return {"ok": True, "message": message, "method": "ollama serve"}
    except Exception as exc:
        return {"ok": False, "error": str(exc), "method": "ollama serve"}


async def _wait_for_ollama_ready(timeout: float = 12.0) -> tuple[bool, str]:
    deadline = time.monotonic() + timeout
    last_error = ""
    async with httpx.AsyncClient(timeout=1.0) as client:
        while time.monotonic() < deadline:
            try:
                resp = await client.get(f"{OLLAMA}/")
                if resp.status_code < 500:
                    return True, ""
                last_error = resp.text
            except Exception as exc:
                last_error = str(exc)
            await asyncio.sleep(0.5)
    return False, last_error


@app.get("/", response_class=HTMLResponse)
async def root():
    return HTMLResponse((_BASE / "index.html").read_text(encoding="utf-8"))


@app.get("/styles.css")
async def styles():
    return Response(_STYLES_CSS, media_type="text/css")


async def _ollama_json_request(method: str, path: str, *, body: dict | None = None, timeout: float = 5.0) -> dict:
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.request(method, f"{OLLAMA}{path}", json=body)
        response.raise_for_status()
        return response.json()


@app.get("/api/models")
async def get_models():
    try:
        return await _ollama_json_request("GET", "/api/tags", timeout=3.0)
    except Exception as exc:
        return {"models": [{"name": FALLBACK_MODEL}], "offline": True, "error": str(exc)}


@app.get("/api/status")
async def status():
    try:
        data = await _ollama_json_request("GET", "/api/tags", timeout=2.0)
        return {
            "ollama": True,
            "models_count": len(data.get("models", [])),
            "lan": HOST in {"0.0.0.0", "::"},
            "auth_required": AUTH_REQUIRED,
            "host": HOST,
            "port": PORT,
        }
    except Exception as exc:
        return JSONResponse(
            {
                "ollama": False,
                "error": str(exc),
                "lan": HOST in {"0.0.0.0", "::"},
                "auth_required": AUTH_REQUIRED,
                "host": HOST,
                "port": PORT,
            },
            status_code=503,
        )


@app.post("/api/ollama/restart")
async def restart_ollama(request: Request):
    if not _runtime_control_allowed(request):
        return JSONResponse({"error": "Ollama restart requires localhost access or a valid LAN token."}, status_code=403)

    result = await asyncio.to_thread(_restart_ollama_process)
    if not result.get("ok"):
        return JSONResponse(result, status_code=500)

    ready, error = await _wait_for_ollama_ready()
    if not ready:
        return JSONResponse(
            {
                "ok": False,
                "error": "Restart command ran, but Ollama did not respond within 12 seconds.",
                "detail": error,
                "method": result.get("method"),
            },
            status_code=503,
        )

    return {
        "ok": True,
        "message": "Ollama restarted",
        "method": result.get("method"),
    }


@app.post("/api/show")
async def show_model(request: Request):
    body = await request.json()
    try:
        return await _ollama_json_request("POST", "/api/show", body=body, timeout=5.0)
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)


@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """Stream transcription progress for an audio file using faster-whisper (SSE)."""
    if not _WHISPER_AVAILABLE:
        return JSONResponse(
            {"error": "Audio transcription requires faster-whisper. Install with: pip install faster-whisper"},
            status_code=501,
        )
    suffix = Path(file.filename).suffix if file.filename else ".wav"
    content = await file.read()
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    # Load (or reuse) the model before spawning the worker thread.
    model = await _get_whisper()

    async def event_stream():
        q: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def _run():
            try:
                segments_iter, info = model.transcribe(tmp_path, beam_size=5)
                duration = max(info.duration or 0, 0.001)
                texts: list[str] = []
                for seg in segments_iter:
                    texts.append(seg.text)
                    pct = min(99, int(seg.end / duration * 100))
                    loop.call_soon_threadsafe(
                        q.put_nowait, {"type": "progress", "percent": pct}
                    )
                loop.call_soon_threadsafe(
                    q.put_nowait,
                    {"type": "done", "transcript": " ".join(texts).strip()},
                )
            except Exception as exc:
                loop.call_soon_threadsafe(
                    q.put_nowait, {"type": "error", "error": str(exc)}
                )
            finally:
                Path(tmp_path).unlink(missing_ok=True)

        threading.Thread(target=_run, daemon=True).start()

        while True:
            item = await q.get()
            yield f"data: {json.dumps(item)}\n\n"
            if item["type"] in ("done", "error"):
                break

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/extract")
async def extract_document(file: UploadFile = File(...)):
    """Extract plain text from a Word (.docx) or ODF (.odt/.ods/.odp) document."""
    suffix = Path(file.filename).suffix.lower() if file.filename else ""
    content = await file.read()

    if suffix == ".docx":
        if not _DOCX_AVAILABLE:
            return JSONResponse(
                {"error": "python-docx is required. Install with: pip install python-docx"},
                status_code=501,
            )
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            def _read_docx():
                doc = _docx_module.Document(tmp_path)
                return "\n".join(p.text for p in doc.paragraphs)
            text = await asyncio.to_thread(_read_docx)
            return {"text": text}
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    elif suffix in {".odt", ".ods", ".odp"}:
        if not _ODF_AVAILABLE:
            return JSONResponse(
                {"error": "odfpy is required. Install with: pip install odfpy"},
                status_code=501,
            )
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            def _read_odf():
                odoc = _odf_load(tmp_path)
                paragraphs = odoc.getElementsByType(_odf_text.P)
                return "\n".join(_odf_extract_text(p) for p in paragraphs)
            text = await asyncio.to_thread(_read_odf)
            return {"text": text}
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    elif suffix == ".pdf":
        if not _PDF_AVAILABLE:
            return JSONResponse(
                {"error": "pypdf is required. Install with: pip install pypdf"},
                status_code=501,
            )
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            def _read_pdf():
                reader = _pypdf.PdfReader(tmp_path)
                return "\n".join(
                    page.extract_text() or "" for page in reader.pages
                ).strip()
            text = await asyncio.to_thread(_read_pdf)
            return {"text": text}
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    else:
        return JSONResponse(
            {"error": f"Unsupported document format: '{suffix}'. Supported: .docx, .odt, .ods, .odp, .pdf"},
            status_code=415,
        )


def _ndjson_error(message: str) -> bytes:
    return (json.dumps({"error": message}) + "\n").encode()


def _clamp_int(value, minimum: int, maximum: int, fallback: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = fallback
    return max(minimum, min(maximum, n))


def _apply_image_generation_caps(body: dict) -> dict:
    capped = dict(body or {})
    capped["width"] = _clamp_int(capped.get("width"), 256, IMAGE_GEN_MAX_WIDTH, IMAGE_GEN_DEFAULT_WIDTH)
    capped["height"] = _clamp_int(capped.get("height"), 256, IMAGE_GEN_MAX_HEIGHT, IMAGE_GEN_DEFAULT_HEIGHT)
    capped["steps"] = _clamp_int(capped.get("steps"), 2, IMAGE_GEN_MAX_STEPS, IMAGE_GEN_DEFAULT_STEPS)
    return capped


async def stream_ollama_response(path: str, body: dict, *, write_timeout: float):
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=None, write=write_timeout, pool=5.0)
        ) as client:
            async with client.stream("POST", f"{OLLAMA}{path}", json=body) as resp:
                if resp.status_code >= 400:
                    detail = (await resp.aread()).decode("utf-8", errors="replace").strip()
                    reason = detail or resp.reason_phrase
                    yield _ndjson_error(f"Ollama returned {resp.status_code}: {reason}")
                    return
                async for chunk in resp.aiter_bytes():
                    if chunk:
                        yield chunk
    except httpx.ConnectError:
        yield _ndjson_error("Cannot connect to Ollama. Start it with: ollama serve")
    except httpx.HTTPError as exc:
        yield _ndjson_error(f"Ollama request failed: {exc}")
    except Exception as exc:
        yield _ndjson_error(str(exc))


def _token_table_lines(active: str | None, prompt_req: int, completion_req: int) -> list[str]:
    stats    = _token_stats
    name_col = max(15, max((len(k) for k in stats), default=0) + 4)
    total_p  = sum(v[0] for v in stats.values())
    total_c  = sum(v[1] for v in stats.values())
    grand    = total_p + total_c
    W = name_col + 39
    C = "─"
    if active is not None:
        head = f" Token Usage  ·  +{prompt_req + completion_req:,} this request "
    else:
        head = " Session Token Summary  ·  Server Shutdown "
    head = head.center(W)
    lines = [
        f"┌{C * W}┐",
        f"│{head}│",
        f"├{C * name_col}┬{C * 12}┬{C * 12}┬{C * 12}┤",
        f"│ {'Client':<{name_col - 2}} │ {'Prompt':>10} │ {'Completion':>10} │ {'Total':>10} │",
        f"├{C * name_col}┼{C * 12}┼{C * 12}┼{C * 12}┤",
    ]
    for name, (p, c) in sorted(stats.items(), key=lambda x: -(x[1][0] + x[1][1])):
        marker = " ◀" if name == active else ""
        lines.append(
            f"│ {(name + marker):<{name_col - 2}} │ {p:>10,} │ {c:>10,} │ {p + c:>10,} │"
        )
    lines += [
        f"├{C * name_col}┼{C * 12}┼{C * 12}┼{C * 12}┤",
        f"│ {'TOTAL':<{name_col - 2}} │ {total_p:>10,} │ {total_c:>10,} │ {grand:>10,} │",
        f"└{C * name_col}┴{C * 12}┴{C * 12}┴{C * 12}┘",
    ]
    return lines


def _print_token_table(display_name: str, prompt_req: int, completion_req: int) -> None:
    print("\n" + "\n".join(_token_table_lines(display_name, prompt_req, completion_req)))


def _print_shutdown_summary() -> None:
    if not _token_stats:
        return
    print("\n" + "\n".join(_token_table_lines(None, 0, 0)))


atexit.register(_print_shutdown_summary)


def _tally_done_line(line: bytes, display_name: str) -> None:
    line = line.strip()
    if not line:
        return
    try:
        data = json.loads(line)
        if data.get("done"):
            prompt_req     = data.get("prompt_eval_count", 0)
            completion_req = data.get("eval_count", 0)
            entry = _token_stats.setdefault(display_name, [0, 0])
            entry[0] += prompt_req
            entry[1] += completion_req
            _save_token_stats()
            _print_token_table(display_name, prompt_req, completion_req)
    except (json.JSONDecodeError, AttributeError):
        pass


async def _chat_stream_with_token_log(body: dict, client_host: str):
    display_name = body.get("user", "").strip() or client_host
    ollama_body  = {k: v for k, v in body.items() if k != "user"}
    buf = b""
    async for chunk in stream_ollama_response("/api/chat", ollama_body, write_timeout=120.0):
        buf += chunk
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            _tally_done_line(line, display_name)
        yield chunk
    if buf.strip():
        _tally_done_line(buf, display_name)


@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    client_host = request.client.host if request.client else "unknown"
    return StreamingResponse(
        _chat_stream_with_token_log(body, client_host),
        media_type="application/x-ndjson",
    )


@app.get("/api/tokens")
async def get_tokens():
    return JSONResponse(_token_stats)


@app.delete("/api/tokens")
async def reset_user_tokens(user: str = ""):
    if user and user in _token_stats:
        _token_stats[user] = [0, 0]
        _save_token_stats()
    return JSONResponse({"ok": True})


@app.post("/api/pull")
async def pull_model(request: Request):
    body = await request.json()
    return StreamingResponse(
        stream_ollama_response("/api/pull", body, write_timeout=30.0),
        media_type="application/x-ndjson",
    )


@app.post("/api/generate-image")
async def generate_image(request: Request):
    """Proxy image generation requests to Ollama's /api/generate endpoint.
    Supports streaming NDJSON with progress updates and a final base64 image."""
    body = _apply_image_generation_caps(await request.json())
    return StreamingResponse(
        stream_ollama_response("/api/generate", body, write_timeout=300.0),
        media_type="application/x-ndjson",
    )


if __name__ == "__main__":
    import socket
    import uvicorn

    host = HOST
    port = PORT

    lan_ip = None
    if host in {"0.0.0.0", "::"}:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            lan_ip = s.getsockname()[0]
            s.close()
        except Exception:
            lan_ip = "127.0.0.1"

    print("══════════════════════════════════════════")
    print("  OfflineAI")
    print(f"  Local:    http://127.0.0.1:{port}")
    if lan_ip:
        print(f"  Network:  http://{lan_ip}:{port}")
        if AUTH_REQUIRED:
            print(f"  Token:    {AUTH_TOKEN}")
    else:
        print("  Network:  disabled (set OFFLINEAI_HOST=0.0.0.0 to expose)")
    print("══════════════════════════════════════════")
    print("Make sure Ollama is running: ollama serve")
    print(f"Make sure model is available: ollama pull {FALLBACK_MODEL}")
    uvicorn.run(app, host=host, port=port)
