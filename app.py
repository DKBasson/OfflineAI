import asyncio
import atexit
import json
import os
import platform
import re
import shlex
import shutil
import subprocess
import tempfile
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, Response, FileResponse
from fastapi.staticfiles import StaticFiles
import httpx

try:
    from ddgs import DDGS as _DDGS
    _SEARCH_AVAILABLE = True
except ImportError:
    try:
        from duckduckgo_search import DDGS as _DDGS
        _SEARCH_AVAILABLE = True
    except ImportError:
        _SEARCH_AVAILABLE = False

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

try:
    from bs4 import BeautifulSoup
    _BS4_AVAILABLE = True
except ImportError:
    _BS4_AVAILABLE = False

try:
    import markdown as _markdown_lib
    _MARKDOWN_AVAILABLE = True
except ImportError:
    _MARKDOWN_AVAILABLE = False

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
# Maximum number of distinct user entries kept in token_stats.json.
# When exceeded, entries with the lowest total token count are pruned first.
_MAX_TOKEN_STATS_ENTRIES = int(os.environ.get("OFFLINEAI_MAX_TOKEN_ENTRIES", "500"))

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
    global _token_stats
    # Prune to prevent unbounded growth: keep entries with the highest total tokens.
    if len(_token_stats) > _MAX_TOKEN_STATS_ENTRIES:
        _token_stats = dict(
            sorted(
                _token_stats.items(),
                key=lambda x: x[1][0] + x[1][1],
                reverse=True,
            )[:_MAX_TOKEN_STATS_ENTRIES]
        )
    try:
        _TOKEN_STATS_FILE.write_text(json.dumps(_token_stats), encoding="utf-8")
    except Exception:
        pass

_token_stats: dict[str, list[int]] = _load_token_stats()

_BASE = Path(__file__).parent
_STYLES_CSS = (_BASE / "styles.css").read_text(encoding="utf-8")
_REACT_DIST = _BASE / "react-dist"
_REACT_MODE = _REACT_DIST.is_dir() and (_REACT_DIST / "index.html").is_file()

if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if _REACT_MODE:
    _react_assets = _REACT_DIST / "assets"
    if _react_assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_react_assets)), name="react-assets")
elif FRONTEND_DIR.is_dir():
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
    if _REACT_MODE:
        return HTMLResponse((_REACT_DIST / "index.html").read_text(encoding="utf-8"))
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


@app.post("/api/search")
async def web_search(request: Request):
    """Perform a web search using DuckDuckGo and return results."""
    if not _SEARCH_AVAILABLE:
        return JSONResponse(
            {"error": "Web search requires duckduckgo-search. Install with: pip install duckduckgo-search"},
            status_code=501,
        )
    body = await request.json()
    query = (body.get("query") or "").strip()
    if not query:
        return JSONResponse({"error": "No search query provided"}, status_code=400)

    max_results = min(int(body.get("max_results", 5)), 10)

    def _do_search():
        try:
            ddgs = _DDGS()
            results = list(ddgs.text(query, max_results=max_results))
            return results
        except Exception as exc:
            return {"error": str(exc)}

    results = await asyncio.to_thread(_do_search)
    if isinstance(results, dict) and "error" in results:
        return JSONResponse({"error": results["error"]}, status_code=502)

    return {"query": query, "results": results}


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


# ---------------------------------------------------------------------------
# Research Agent helpers
# ---------------------------------------------------------------------------


def _sse_event(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _generate_search_queries(topic: str, num_queries: int, model: str) -> list[str]:
    """Use LLM to generate diverse search queries for a research topic."""
    prompt = f"""Generate exactly {num_queries} diverse web search queries to research the topic: "{topic}"

Rules:
- Each query should explore a different angle or aspect of the topic
- Queries should be specific enough to get relevant results
- Include a mix of overview queries and specific detail queries
- Return ONLY the queries, one per line, no numbering, no explanations"""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{OLLAMA}/api/chat", json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.7, "num_predict": 512},
            })
            data = resp.json()
            content = data.get("message", {}).get("content", "")
            queries = [q.strip().strip('"').strip("'") for q in content.strip().split("\n") if q.strip()]
            # Remove any numbered prefixes like "1." or "- "
            queries = [re.sub(r'^[\d]+[.)\s]+|^[-*]\s+', '', q).strip() for q in queries]
            return queries[:num_queries] if queries else [topic]
    except Exception:
        return [topic]


async def _do_web_search(query: str, max_results: int = 5) -> list[dict]:
    """Perform a web search using DuckDuckGo."""
    if not _SEARCH_AVAILABLE:
        return []
    try:
        def _search():
            ddgs = _DDGS()
            return list(ddgs.text(query, max_results=max_results))
        return await asyncio.to_thread(_search)
    except Exception:
        return []


async def _fetch_page_content(url: str, max_chars: int = 4000) -> str:
    """Fetch and extract text content from a URL."""
    if not _BS4_AVAILABLE:
        return ""
    try:
        from bs4 import BeautifulSoup
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            if resp.status_code != 200:
                return ""
        soup = BeautifulSoup(resp.text, "lxml")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
        return text[:max_chars]
    except Exception:
        return ""


async def _extract_findings(topic: str, page_contents: list[str], model: str) -> str:
    """Use LLM to extract key findings from collected source material."""
    if not page_contents:
        return "No source content available to analyze."

    combined = "\n\n---\n\n".join(page_contents[:10])  # Limit to 10 sources
    # Truncate to fit in context
    combined = combined[:24000]

    prompt = f"""Analyze the following source material about "{topic}" and extract the key findings.

Source material:
{combined}

Provide a structured list of key findings, facts, and insights. Be specific and factual. Include relevant data points, dates, and names where available."""

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{OLLAMA}/api/chat", json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.3, "num_predict": 4096, "num_ctx": 32768},
            })
            data = resp.json()
            return data.get("message", {}).get("content", "Unable to extract findings.")
    except Exception as exc:
        return f"Error extracting findings: {exc}"


async def _synthesize_summary(topic: str, findings: str, sources: list[dict], model: str) -> str:
    """Use LLM to write a comprehensive research summary."""
    sources_list = "\n".join(f"- {s.get('title', 'Unknown')}: {s.get('url', '')}" for s in sources[:15])

    prompt = f"""Write a comprehensive research summary about "{topic}" based on the following findings and sources.

Key Findings:
{findings}

Sources consulted:
{sources_list}

Write a well-structured Markdown document with:
1. A title (# heading)
2. An executive summary paragraph
3. Key findings organized by theme (## subheadings)
4. A sources section at the end

Be thorough, factual, and cite sources where relevant."""

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(f"{OLLAMA}/api/chat", json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.4, "num_predict": 8192, "num_ctx": 32768},
            })
            data = resp.json()
            return data.get("message", {}).get("content", "Unable to generate summary.")
    except Exception as exc:
        return f"# Research Summary: {topic}\n\nError generating summary: {exc}\n\n## Findings\n\n{findings}"


def _get_project_knowledge_context(project_id: str, max_chars: int = 8000) -> str:
    """Load project knowledge and format as context for the LLM."""
    try:
        knowledge_file = PROJECTS_DIR / project_id / "knowledge.json"
        if not knowledge_file.exists():
            return ""
        knowledge = json.loads(knowledge_file.read_text(encoding="utf-8"))

        findings = knowledge.get("findings", [])
        sources = knowledge.get("sources", [])

        if not findings and not sources:
            return ""

        parts = []
        parts.append("--- PROJECT KNOWLEDGE BASE ---")
        parts.append(f"Project: {knowledge.get('name', project_id)}")
        parts.append("")

        if findings:
            parts.append("Key Findings:")
            for i, f in enumerate(findings[-10:], 1):  # Last 10 findings
                parts.append(f"{i}. [{f.get('topic', 'Unknown')}] {f.get('summary', '')[:300]}")
            parts.append("")

        if sources:
            parts.append("Available Sources:")
            for s in sources[-15:]:  # Last 15 sources
                parts.append(f"- {s.get('title', 'Unknown')}: {s.get('url', '')}")

        parts.append("---")

        context = "\n".join(parts)
        return context[:max_chars]
    except Exception:
        return ""


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

    # Inject project knowledge if project_id is provided
    project_id = body.pop("project_id", None)
    if project_id:
        knowledge_context = _get_project_knowledge_context(project_id)
        if knowledge_context:
            # Prepend knowledge to messages as a system message
            messages = body.get("messages", [])
            # Find existing system message or create one
            has_system = any(m.get("role") == "system" for m in messages)
            if has_system:
                # Append knowledge to existing system message
                for m in messages:
                    if m.get("role") == "system":
                        m["content"] = m["content"] + "\n\n" + knowledge_context
                        break
            else:
                messages.insert(0, {"role": "system", "content": knowledge_context})
            body["messages"] = messages

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


# ---------------------------------------------------------------------------
# Research Workstation: Web page content fetching
# ---------------------------------------------------------------------------

@app.post("/api/fetch-page")
async def fetch_page(request: Request):
    """Fetch a URL, strip HTML, return clean text."""
    if not _BS4_AVAILABLE:
        return JSONResponse(
            {"error": "beautifulsoup4 is required. Install with: pip install beautifulsoup4 lxml"},
            status_code=501,
        )
    body = await request.json()
    url = (body.get("url") or "").strip()
    if not url:
        return JSONResponse({"error": "No URL provided"}, status_code=400)
    max_chars = int(body.get("max_chars", 8000))

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url)
            resp.raise_for_status()
    except Exception as exc:
        return JSONResponse({"error": f"Failed to fetch URL: {exc}"}, status_code=502)

    soup = BeautifulSoup(resp.text, "lxml")

    # Remove unwanted tags
    for tag in soup.find_all(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()

    title = soup.title.get_text(strip=True) if soup.title else ""
    content = soup.get_text(separator='\n', strip=True)
    content = content[:max_chars]

    return {"url": url, "title": title, "content": content}


# ---------------------------------------------------------------------------
# Research Workstation: Project CRUD
# ---------------------------------------------------------------------------

PROJECTS_DIR = Path.home() / "OfflineAI-Projects"
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


def _slugify(text: str) -> str:
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii')
    text = re.sub(r'[^\w\s-]', '', text.lower())
    return re.sub(r'[-\s]+', '-', text).strip('-')


def _resolve_project_path(project_id: str, *parts: str) -> Path | None:
    """Resolve a path within a project directory, returning None if it escapes."""
    project_dir = PROJECTS_DIR / project_id
    if parts:
        target = (project_dir / Path(*parts)).resolve()
    else:
        target = project_dir.resolve()
    if not str(target).startswith(str(project_dir.resolve())):
        return None
    return target


def _count_files(project_dir: Path) -> int:
    """Count all files in a project directory, excluding knowledge.json."""
    count = 0
    for f in project_dir.rglob("*"):
        if f.is_file() and f.name != "knowledge.json":
            count += 1
    return count


@app.get("/api/projects")
async def list_projects():
    """List all projects."""
    projects = []
    if PROJECTS_DIR.is_dir():
        for entry in sorted(PROJECTS_DIR.iterdir()):
            if entry.is_dir():
                knowledge_file = entry / "knowledge.json"
                if knowledge_file.is_file():
                    try:
                        data = json.loads(knowledge_file.read_text(encoding="utf-8"))
                        projects.append({
                            "id": entry.name,
                            "name": data.get("name", entry.name),
                            "description": data.get("description", ""),
                            "created": data.get("created", ""),
                            "sources_count": len(data.get("sources", [])),
                            "findings_count": len(data.get("findings", [])),
                            "files_count": _count_files(entry),
                        })
                    except (json.JSONDecodeError, OSError):
                        continue
    return {"projects": projects}


@app.post("/api/projects")
async def create_project(request: Request):
    """Create a new project."""
    body = await request.json()
    name = (body.get("name") or "").strip()
    description = (body.get("description") or "").strip()
    if not name:
        return JSONResponse({"error": "Project name is required"}, status_code=400)

    slug = _slugify(name)
    if not slug:
        return JSONResponse({"error": "Invalid project name"}, status_code=400)

    project_dir = PROJECTS_DIR / slug
    if project_dir.exists():
        return JSONResponse({"error": f"Project '{slug}' already exists"}, status_code=409)

    project_dir.mkdir(parents=True)
    (project_dir / "notes").mkdir()
    (project_dir / "sources").mkdir()
    (project_dir / "output").mkdir()

    created = datetime.now(timezone.utc).isoformat()
    knowledge = {
        "name": name,
        "description": description,
        "created": created,
        "sources": [],
        "findings": [],
    }
    (project_dir / "knowledge.json").write_text(json.dumps(knowledge, indent=2), encoding="utf-8")

    return {
        "id": slug,
        "name": name,
        "description": description,
        "created": created,
        "sources_count": 0,
        "findings_count": 0,
        "files_count": 0,
    }


@app.get("/api/projects/{project_id}")
async def get_project(project_id: str):
    """Get a single project's metadata."""
    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    knowledge_file = project_dir / "knowledge.json"
    if not knowledge_file.is_file():
        return JSONResponse({"error": "Project metadata missing"}, status_code=404)

    try:
        data = json.loads(knowledge_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        return JSONResponse({"error": f"Failed to read project: {exc}"}, status_code=500)

    return {
        "id": project_id,
        "name": data.get("name", project_id),
        "description": data.get("description", ""),
        "created": data.get("created", ""),
        "sources_count": len(data.get("sources", [])),
        "findings_count": len(data.get("findings", [])),
        "files_count": _count_files(project_dir),
    }


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    """Delete an entire project."""
    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    shutil.rmtree(project_dir)
    return {"ok": True}


@app.get("/api/projects/{project_id}/files")
async def list_project_files(project_id: str):
    """List all files in a project."""
    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    files = []
    for f in sorted(project_dir.rglob("*")):
        if f.is_file() and f.name != "knowledge.json":
            rel = f.relative_to(project_dir)
            stat = f.stat()
            files.append({
                "path": str(rel),
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
    return {"files": files}


@app.get("/api/projects/{project_id}/files/{file_path:path}")
async def get_project_file(project_id: str, file_path: str):
    """Read a file from a project."""
    target = _resolve_project_path(project_id, file_path)
    if target is None:
        return JSONResponse({"error": "Invalid file path"}, status_code=400)
    if not target.is_file():
        return JSONResponse({"error": "File not found"}, status_code=404)

    size = target.stat().st_size
    # Try reading as text
    try:
        content = target.read_text(encoding="utf-8")
        return {"path": file_path, "content": content, "size": size}
    except (UnicodeDecodeError, ValueError):
        return {"path": file_path, "binary": True, "size": size}


@app.post("/api/projects/{project_id}/files/{file_path:path}")
async def write_project_file(project_id: str, file_path: str, request: Request):
    """Write content to a file in a project."""
    target = _resolve_project_path(project_id, file_path)
    if target is None:
        return JSONResponse({"error": "Invalid file path"}, status_code=400)

    # Ensure the project directory exists
    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    body = await request.json()
    content = body.get("content", "")

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")

    return {"path": file_path, "size": target.stat().st_size}


@app.delete("/api/projects/{project_id}/files/{file_path:path}")
async def delete_project_file(project_id: str, file_path: str):
    """Delete a file from a project."""
    target = _resolve_project_path(project_id, file_path)
    if target is None:
        return JSONResponse({"error": "Invalid file path"}, status_code=400)
    if not target.is_file():
        return JSONResponse({"error": "File not found"}, status_code=404)

    target.unlink()
    return {"ok": True}


@app.get("/api/projects/{project_id}/download/{file_path:path}")
async def download_project_file(project_id: str, file_path: str):
    """Download a file from a project."""
    target = _resolve_project_path(project_id, file_path)
    if target is None:
        return JSONResponse({"error": "Invalid file path"}, status_code=400)
    if not target.is_file():
        return JSONResponse({"error": "File not found"}, status_code=404)

    return FileResponse(
        path=str(target),
        filename=target.name,
        headers={"Content-Disposition": f"attachment; filename=\"{target.name}\""},
    )


# ---------------------------------------------------------------------------
# Research Agent: Autonomous multi-step web research
# ---------------------------------------------------------------------------


@app.get("/api/projects/{project_id}/knowledge")
async def get_project_knowledge(project_id: str):
    """Get project knowledge base summary."""
    project_path = PROJECTS_DIR / project_id
    knowledge_file = project_path / "knowledge.json"
    if not knowledge_file.exists():
        return JSONResponse({"error": "Project not found"}, status_code=404)
    try:
        knowledge = json.loads(knowledge_file.read_text(encoding="utf-8"))
        return {
            "name": knowledge.get("name", project_id),
            "findings": knowledge.get("findings", []),
            "sources": knowledge.get("sources", []),
        }
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.post("/api/projects/{project_id}/research")
async def research_project(project_id: str, request: Request):
    """Autonomous multi-step research agent. Streams SSE progress."""
    body = await request.json()
    topic = (body.get("topic") or "").strip()
    if not topic:
        return JSONResponse({"error": "No topic provided"}, status_code=400)

    depth = body.get("depth", "standard")
    model = body.get("model", FALLBACK_MODEL)
    num_queries = {"quick": 3, "standard": 5, "deep": 8}.get(depth, 5)

    # Validate project exists
    project_path = PROJECTS_DIR / project_id
    if not project_path.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    knowledge_file = project_path / "knowledge.json"
    if not knowledge_file.exists():
        return JSONResponse({"error": "Invalid project"}, status_code=404)

    async def research_stream():
        try:
            # Step 1: Generate search queries using LLM
            yield _sse_event({"type": "status", "message": f"Planning research on: {topic}"})

            queries = await _generate_search_queries(topic, num_queries, model)
            yield _sse_event({"type": "status", "message": f"Generated {len(queries)} search queries"})

            # Step 2: Execute searches and collect results
            all_sources = []
            all_page_content = []

            for i, query in enumerate(queries):
                yield _sse_event({"type": "status", "message": f"Searching ({i+1}/{len(queries)}): {query}"})

                # Search
                search_results = await _do_web_search(query, max_results=5)
                yield _sse_event({"type": "search", "query": query, "results_count": len(search_results)})

                # Fetch top results
                for result in search_results[:2]:
                    url = result.get("href", "")
                    title = result.get("title", "")
                    snippet = result.get("body", "")

                    all_sources.append({
                        "url": url,
                        "title": title,
                        "snippet": snippet,
                        "fetched_at": datetime.now(timezone.utc).isoformat(),
                    })

                    # Try to fetch full page content
                    page_text = await _fetch_page_content(url)
                    if page_text:
                        all_page_content.append(f"Source: {title} ({url})\n{page_text[:5000]}")
                        yield _sse_event({"type": "source", "message": f"Read: {title}"})

            # Step 3: Extract findings using LLM
            yield _sse_event({"type": "status", "message": "Analyzing sources and extracting findings..."})

            findings_text = await _extract_findings(topic, all_page_content, model)
            yield _sse_event({"type": "finding", "text": findings_text[:500]})

            # Step 4: Generate comprehensive summary
            yield _sse_event({"type": "status", "message": "Writing comprehensive summary..."})

            summary = await _synthesize_summary(topic, findings_text, all_sources, model)

            # Step 5: Save to project
            yield _sse_event({"type": "status", "message": "Saving research to project..."})

            # Save summary as a note
            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            topic_slug = _slugify(topic)[:40]
            note_filename = f"{timestamp}-{topic_slug}.md"
            notes_dir = project_path / "notes"
            notes_dir.mkdir(exist_ok=True)
            note_path = notes_dir / note_filename
            note_path.write_text(summary, encoding="utf-8")

            # Update knowledge.json
            knowledge = json.loads(knowledge_file.read_text(encoding="utf-8"))

            # Add sources (deduplicate by URL)
            existing_urls = {s["url"] for s in knowledge.get("sources", [])}
            for src in all_sources:
                if src["url"] not in existing_urls:
                    knowledge.setdefault("sources", []).append(src)
                    existing_urls.add(src["url"])

            # Add finding
            knowledge.setdefault("findings", []).append({
                "topic": topic,
                "summary": findings_text[:2000],
                "sources": [s["url"] for s in all_sources[:10]],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })

            knowledge_file.write_text(json.dumps(knowledge, indent=2, ensure_ascii=False), encoding="utf-8")

            yield _sse_event({
                "type": "done",
                "message": "Research complete!",
                "summary_file": f"notes/{note_filename}",
            })

        except Exception as exc:
            yield _sse_event({"type": "error", "error": str(exc)})

    return StreamingResponse(
        research_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Generation Endpoints: Document, PDF export, Data, Code, Workflow
# ---------------------------------------------------------------------------


def _parse_code_files(content: str) -> list[tuple[str, str]]:
    """Parse multi-file code output using === FILE: path === / === END FILE === markers."""
    files = []
    pattern = re.compile(
        r'===\s*FILE:\s*(.+?)\s*===\n(.*?)\n===\s*END\s*FILE\s*===',
        re.DOTALL,
    )
    for match in pattern.finditer(content):
        file_path = match.group(1).strip()
        file_content = match.group(2)
        if file_path and file_content is not None:
            files.append((file_path, file_content))
    return files


def _parse_workflow_plan(text: str) -> list[dict]:
    """Parse a JSON workflow plan from LLM output."""
    text = text.strip()
    # Try to extract JSON from markdown code fences
    if "```" in text:
        lines = text.split("\n")
        in_fence = False
        json_lines = []
        for line in lines:
            if line.strip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                json_lines.append(line)
        if json_lines:
            text = "\n".join(json_lines)

    # Try to find JSON array
    start = text.find("[")
    end = text.rfind("]")
    if start >= 0 and end > start:
        text = text[start:end + 1]

    try:
        steps = json.loads(text)
        if isinstance(steps, list):
            valid_types = {"research", "document", "code", "data"}
            return [s for s in steps if isinstance(s, dict) and s.get("type") in valid_types]
    except (json.JSONDecodeError, ValueError):
        pass
    return []


@app.post("/api/projects/{project_id}/generate-document")
async def generate_document(project_id: str, request: Request):
    """Generate a Markdown document, optionally using project knowledge. Streams SSE."""
    body = await request.json()
    topic = (body.get("topic") or "").strip()
    if not topic:
        return JSONResponse({"error": "No topic provided"}, status_code=400)

    project_path = PROJECTS_DIR / project_id
    if not project_path.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    doc_type = body.get("type", "report")
    model = body.get("model", FALLBACK_MODEL)
    use_knowledge = body.get("use_knowledge", True)

    async def doc_stream():
        try:
            yield _sse_event({"type": "status", "message": f"Generating {doc_type}: {topic}"})

            # Build context from project knowledge
            context = ""
            if use_knowledge:
                context = _get_project_knowledge_context(project_id, max_chars=6000)

            # Generate document
            prompt = f"""Write a comprehensive {doc_type} about: "{topic}"

{f'Use this research context to inform your writing:{chr(10)}{context}' if context else ''}

Format as a well-structured Markdown document with:
- A clear title (# heading)
- An introduction/executive summary
- Organized sections with ## subheadings
- Bullet points and numbered lists where appropriate
- A conclusion or summary section
- If relevant, include a references/sources section

Be thorough, detailed, and well-organized."""

            yield _sse_event({"type": "status", "message": "Writing document..."})

            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(f"{OLLAMA}/api/chat", json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "options": {"temperature": 0.5, "num_predict": 8192, "num_ctx": 32768},
                })
                data = resp.json()
                content = data.get("message", {}).get("content", "")

            if not content:
                yield _sse_event({"type": "error", "error": "Model returned empty content"})
                return

            # Save to project
            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            topic_slug = _slugify(topic)[:40]
            filename = f"{timestamp}-{topic_slug}.md"
            output_dir = project_path / "output"
            output_dir.mkdir(exist_ok=True)
            file_path = output_dir / filename
            file_path.write_text(content, encoding="utf-8")

            yield _sse_event({"type": "content", "text": content})
            yield _sse_event({"type": "done", "message": "Document generated", "file_path": f"output/{filename}"})

        except Exception as exc:
            yield _sse_event({"type": "error", "error": str(exc)})

    return StreamingResponse(
        doc_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/projects/{project_id}/export-pdf")
async def export_pdf(project_id: str, request: Request):
    """Convert a Markdown file to PDF (via HTML)."""
    body = await request.json()
    file_path = (body.get("file_path") or "").strip()
    if not file_path:
        return JSONResponse({"error": "No file_path provided"}, status_code=400)

    resolved = _resolve_project_path(project_id, file_path)
    if resolved is None or not resolved.exists():
        return JSONResponse({"error": "File not found"}, status_code=404)

    md_content = resolved.read_text(encoding="utf-8")

    # Convert Markdown to HTML
    if _MARKDOWN_AVAILABLE:
        html_body = _markdown_lib.markdown(md_content, extensions=["tables", "fenced_code"])
    else:
        # Basic fallback: wrap in pre tags
        html_body = f"<pre>{md_content}</pre>"

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{file_path}</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; line-height: 1.6; color: #1a1a1a; }}
h1 {{ border-bottom: 2px solid #eee; padding-bottom: 10px; }}
h2 {{ border-bottom: 1px solid #eee; padding-bottom: 6px; margin-top: 30px; }}
code {{ background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }}
pre {{ background: #f4f4f4; padding: 16px; border-radius: 6px; overflow-x: auto; }}
pre code {{ background: none; padding: 0; }}
table {{ border-collapse: collapse; width: 100%; margin: 16px 0; }}
th, td {{ border: 1px solid #ddd; padding: 8px 12px; text-align: left; }}
th {{ background: #f8f8f8; font-weight: 600; }}
blockquote {{ border-left: 4px solid #ddd; margin: 16px 0; padding: 8px 16px; color: #666; }}
</style></head><body>{html_body}</body></html>"""

    # Return HTML file (browsers can Print > Save as PDF)
    return Response(
        content=html.encode("utf-8"),
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="{Path(file_path).stem}.html"'},
    )


@app.post("/api/projects/{project_id}/generate-data")
async def generate_data(project_id: str, request: Request):
    """Generate structured data (CSV or JSON). Streams SSE."""
    body = await request.json()
    topic = (body.get("topic") or "").strip()
    if not topic:
        return JSONResponse({"error": "No topic provided"}, status_code=400)

    project_path = PROJECTS_DIR / project_id
    if not project_path.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    data_format = body.get("format", "csv")
    model = body.get("model", FALLBACK_MODEL)

    async def data_stream():
        try:
            yield _sse_event({"type": "status", "message": f"Generating {data_format.upper()} data: {topic}"})

            if data_format == "csv":
                prompt = f"""Generate a CSV dataset about: "{topic}"

Rules:
- First row must be column headers
- Use commas as delimiters
- Wrap fields containing commas in double quotes
- Include at least 10 rows of meaningful data
- Return ONLY the CSV content, no explanations or markdown formatting"""
            else:
                prompt = f"""Generate a JSON dataset about: "{topic}"

Rules:
- Return a JSON array of objects
- Each object should have consistent keys
- Include at least 10 items with meaningful data
- Return ONLY valid JSON, no explanations or markdown formatting"""

            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(f"{OLLAMA}/api/chat", json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "options": {"temperature": 0.3, "num_predict": 4096, "num_ctx": 32768},
                })
                data = resp.json()
                content = data.get("message", {}).get("content", "")

            if not content:
                yield _sse_event({"type": "error", "error": "Model returned empty content"})
                return

            # Clean up: strip markdown code fences if present
            content = content.strip()
            if content.startswith("```"):
                lines = content.split("\n")
                # Remove first line (```csv or ```json) and last line (```)
                if lines[-1].strip() == "```":
                    lines = lines[1:-1]
                else:
                    lines = lines[1:]
                content = "\n".join(lines)

            # Save to project
            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            topic_slug = _slugify(topic)[:30]
            ext = "csv" if data_format == "csv" else "json"
            filename = f"{timestamp}-{topic_slug}.{ext}"
            data_dir = project_path / "output" / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            file_path = data_dir / filename
            file_path.write_text(content, encoding="utf-8")

            yield _sse_event({"type": "content", "text": content, "format": data_format})
            yield _sse_event({"type": "done", "message": f"{data_format.upper()} generated", "file_path": f"output/data/{filename}"})

        except Exception as exc:
            yield _sse_event({"type": "error", "error": str(exc)})

    return StreamingResponse(
        data_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/projects/{project_id}/generate-code")
async def generate_code(project_id: str, request: Request):
    """Generate a multi-file code project. Streams SSE."""
    body = await request.json()
    description = (body.get("description") or "").strip()
    if not description:
        return JSONResponse({"error": "No description provided"}, status_code=400)

    project_path = PROJECTS_DIR / project_id
    if not project_path.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    model = body.get("model", FALLBACK_MODEL)

    async def code_stream():
        try:
            yield _sse_event({"type": "status", "message": f"Generating code: {description[:80]}"})

            prompt = f"""Generate a complete code project for: "{description}"

IMPORTANT: For EACH file, use this EXACT format:
=== FILE: path/to/filename.ext ===
<file content here>
=== END FILE ===

Rules:
- Generate all necessary files for a working project
- Include a README.md with setup instructions
- Use best practices and proper project structure
- Include basic error handling
- Add comments where helpful
- Make sure the code is complete and runnable"""

            yield _sse_event({"type": "status", "message": "Writing code..."})

            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(f"{OLLAMA}/api/chat", json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "options": {"temperature": 0.3, "num_predict": 8192, "num_ctx": 32768},
                })
                data = resp.json()
                content = data.get("message", {}).get("content", "")

            if not content:
                yield _sse_event({"type": "error", "error": "Model returned empty content"})
                return

            # Parse files from the response
            files = _parse_code_files(content)

            if not files:
                # Fallback: save as a single file
                timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                slug = _slugify(description)[:30]
                filename = f"{timestamp}-{slug}.txt"
                code_dir = project_path / "output" / "code"
                code_dir.mkdir(parents=True, exist_ok=True)
                (code_dir / filename).write_text(content, encoding="utf-8")
                yield _sse_event({"type": "file", "path": f"output/code/{filename}", "size": len(content)})
                yield _sse_event({"type": "done", "message": "Code generated (single file)", "files_count": 1})
                return

            # Save each file
            timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            slug = _slugify(description)[:30]
            code_dir = project_path / "output" / "code" / f"{timestamp}-{slug}"
            code_dir.mkdir(parents=True, exist_ok=True)

            saved_files = []
            for file_path, file_content in files:
                # Security: prevent path traversal
                safe_path = Path(file_path.lstrip("/").replace("..", ""))
                full_path = code_dir / safe_path
                full_path.parent.mkdir(parents=True, exist_ok=True)
                full_path.write_text(file_content, encoding="utf-8")
                rel_path = str(full_path.relative_to(project_path))
                saved_files.append(rel_path)
                yield _sse_event({"type": "file", "path": rel_path, "size": len(file_content)})

            yield _sse_event({"type": "done", "message": f"Generated {len(saved_files)} files", "files_count": len(saved_files)})

        except Exception as exc:
            yield _sse_event({"type": "error", "error": str(exc)})

    return StreamingResponse(
        code_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/projects/{project_id}/workflow")
async def run_workflow(project_id: str, request: Request):
    """Execute a multi-step workflow. Streams SSE progress."""
    body = await request.json()
    user_request = (body.get("request") or "").strip()
    if not user_request:
        return JSONResponse({"error": "No request provided"}, status_code=400)

    project_path = PROJECTS_DIR / project_id
    if not project_path.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    model = body.get("model", FALLBACK_MODEL)

    async def workflow_stream():
        try:
            # Step 1: Plan the workflow using LLM
            yield _sse_event({"type": "status", "message": "Planning workflow..."})

            plan_prompt = f"""Analyze this request and break it into ordered steps. For each step, specify the type.

Request: "{user_request}"

Available step types:
- research: Search the web and gather information on a topic
- document: Write a document/report about a topic
- code: Generate code for a programming task
- data: Generate structured data (CSV/JSON tables)

Return ONLY a JSON array of steps, no explanation. Example:
[{{"type": "research", "description": "Research topic X"}}, {{"type": "document", "description": "Write a report on X"}}]"""

            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(f"{OLLAMA}/api/chat", json={
                    "model": model,
                    "messages": [{"role": "user", "content": plan_prompt}],
                    "stream": False,
                    "options": {"temperature": 0.2, "num_predict": 1024},
                })
                plan_data = resp.json()
                plan_text = plan_data.get("message", {}).get("content", "")

            # Parse the plan
            steps = _parse_workflow_plan(plan_text)
            if not steps:
                # Fallback: treat as a single document generation
                steps = [{"type": "document", "description": user_request}]

            yield _sse_event({"type": "plan", "steps": steps})

            # Step 2: Execute each step
            for i, step in enumerate(steps):
                step_type = step.get("type", "document")
                step_desc = step.get("description", user_request)

                yield _sse_event({
                    "type": "step_start",
                    "step": i + 1,
                    "total": len(steps),
                    "step_type": step_type,
                    "description": step_desc,
                })

                if step_type == "research":
                    # Execute research
                    queries = await _generate_search_queries(step_desc, 3, model)
                    all_sources = []
                    all_content = []
                    for query in queries:
                        results = await _do_web_search(query, max_results=3)
                        for r in results[:2]:
                            all_sources.append(r)
                            page = await _fetch_page_content(r.get("href", ""))
                            if page:
                                all_content.append(page[:2000])

                    if all_content:
                        findings = await _extract_findings(step_desc, all_content, model)
                        # Save findings to knowledge
                        knowledge_file = project_path / "knowledge.json"
                        knowledge = json.loads(knowledge_file.read_text(encoding="utf-8"))
                        knowledge.setdefault("findings", []).append({
                            "topic": step_desc,
                            "summary": findings[:2000],
                            "sources": [s.get("href", "") for s in all_sources[:10]],
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        })
                        knowledge_file.write_text(json.dumps(knowledge, indent=2, ensure_ascii=False), encoding="utf-8")

                    yield _sse_event({"type": "step_done", "step": i + 1, "message": f"Research complete: {len(all_sources)} sources found"})

                elif step_type == "document":
                    # Generate document
                    context = _get_project_knowledge_context(project_id, max_chars=6000)
                    doc_prompt = f"Write a comprehensive document about: {step_desc}\n\n{context if context else ''}"

                    async with httpx.AsyncClient(timeout=120.0) as client:
                        resp = await client.post(f"{OLLAMA}/api/chat", json={
                            "model": model,
                            "messages": [{"role": "user", "content": doc_prompt}],
                            "stream": False,
                            "options": {"temperature": 0.5, "num_predict": 8192, "num_ctx": 32768},
                        })
                        doc_data = resp.json()
                        doc_content = doc_data.get("message", {}).get("content", "")

                    if doc_content:
                        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                        slug = _slugify(step_desc)[:30]
                        output_dir = project_path / "output"
                        output_dir.mkdir(exist_ok=True)
                        (output_dir / f"{timestamp}-{slug}.md").write_text(doc_content, encoding="utf-8")

                    yield _sse_event({"type": "step_done", "step": i + 1, "message": "Document generated"})

                elif step_type == "code":
                    # Generate code
                    code_prompt = f"""Generate a complete code project for: "{step_desc}"

For EACH file use: === FILE: path === ... === END FILE ==="""

                    async with httpx.AsyncClient(timeout=120.0) as client:
                        resp = await client.post(f"{OLLAMA}/api/chat", json={
                            "model": model,
                            "messages": [{"role": "user", "content": code_prompt}],
                            "stream": False,
                            "options": {"temperature": 0.3, "num_predict": 8192, "num_ctx": 32768},
                        })
                        code_data = resp.json()
                        code_content = code_data.get("message", {}).get("content", "")

                    if code_content:
                        files = _parse_code_files(code_content)
                        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                        slug = _slugify(step_desc)[:30]
                        code_dir = project_path / "output" / "code" / f"{timestamp}-{slug}"
                        code_dir.mkdir(parents=True, exist_ok=True)
                        if files:
                            for fp, fc in files:
                                safe = Path(fp.lstrip("/").replace("..", ""))
                                full = code_dir / safe
                                full.parent.mkdir(parents=True, exist_ok=True)
                                full.write_text(fc, encoding="utf-8")
                        else:
                            (code_dir / "output.txt").write_text(code_content, encoding="utf-8")

                    yield _sse_event({"type": "step_done", "step": i + 1, "message": "Code generated"})

                elif step_type == "data":
                    # Generate data
                    data_prompt = f"""Generate a CSV dataset about: "{step_desc}"
Return ONLY CSV content with headers. No explanations."""

                    async with httpx.AsyncClient(timeout=60.0) as client:
                        resp = await client.post(f"{OLLAMA}/api/chat", json={
                            "model": model,
                            "messages": [{"role": "user", "content": data_prompt}],
                            "stream": False,
                            "options": {"temperature": 0.3, "num_predict": 4096, "num_ctx": 32768},
                        })
                        csv_data = resp.json()
                        csv_content = csv_data.get("message", {}).get("content", "")

                    if csv_content:
                        csv_content = csv_content.strip()
                        if csv_content.startswith("```"):
                            lines = csv_content.split("\n")
                            if lines[-1].strip() == "```":
                                lines = lines[1:-1]
                            else:
                                lines = lines[1:]
                            csv_content = "\n".join(lines)

                        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                        slug = _slugify(step_desc)[:30]
                        data_dir = project_path / "output" / "data"
                        data_dir.mkdir(parents=True, exist_ok=True)
                        (data_dir / f"{timestamp}-{slug}.csv").write_text(csv_content, encoding="utf-8")

                    yield _sse_event({"type": "step_done", "step": i + 1, "message": "Data generated"})

                else:
                    yield _sse_event({"type": "step_done", "step": i + 1, "message": f"Skipped unknown step type: {step_type}"})

            yield _sse_event({"type": "done", "message": f"Workflow complete! Executed {len(steps)} steps."})

        except Exception as exc:
            yield _sse_event({"type": "error", "error": str(exc)})

    return StreamingResponse(
        workflow_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
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
