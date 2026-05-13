import asyncio
import json
import os
import platform
import shlex
import shutil
import subprocess
import time
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import httpx

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
MAX_BODY   = 50 * 1024 * 1024  # 50 MB
FALLBACK_MODEL = "gemma4:e4b"

# Cache static files at startup
_BASE = Path(__file__).parent
_INDEX_HTML = (_BASE / "index.html").read_text(encoding="utf-8")
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
    return HTMLResponse(_INDEX_HTML)


@app.get("/styles.css")
async def styles():
    from fastapi.responses import Response
    return Response(_STYLES_CSS, media_type="text/css")


@app.get("/api/models")
async def get_models():
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{OLLAMA}/api/tags")
            r.raise_for_status()
            return r.json()
    except Exception as exc:
        return {"models": [{"name": FALLBACK_MODEL}], "offline": True, "error": str(exc)}


@app.get("/api/status")
async def status():
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{OLLAMA}/api/tags")
            r.raise_for_status()
            data = r.json()
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
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(f"{OLLAMA}/api/show", json=body)
            r.raise_for_status()
            return r.json()
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)


def _ndjson_error(message: str) -> bytes:
    return (json.dumps({"error": message}) + "\n").encode()


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


@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    return StreamingResponse(
        stream_ollama_response("/api/chat", body, write_timeout=120.0),
        media_type="application/x-ndjson",
    )


@app.post("/api/pull")
async def pull_model(request: Request):
    body = await request.json()
    return StreamingResponse(
        stream_ollama_response("/api/pull", body, write_timeout=30.0),
        media_type="application/x-ndjson",
    )


if __name__ == "__main__":
    import socket
    import uvicorn

    host = HOST
    port = PORT

    lan_ip = None
    if host in {"0.0.0.0", "::"}:
        # Resolve the LAN IP for display (UDP trick; no payload is sent)
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
