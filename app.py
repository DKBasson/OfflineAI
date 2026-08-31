"""OfflineAI — thin FastAPI composition root.

All route handlers live in the ``routes/`` package. Business logic lives in
``services/``. This module wires everything together: creates the app, mounts
static files, registers middleware, and includes routers.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

# ── Services (config values used by middleware & startup) ─────────────
import services.config as _svc_config
from services.config import (
    OLLAMA,
    HOST,
    PORT,
    AUTH_TOKEN,
    AUTH_REQUIRED,
    LOOPBACK_HOSTS,
    MAX_BODY,
    FALLBACK_MODEL,
    STATIC_DIR,
    _REACT_DIST,
    _REACT_MODE,
)

# ── Re-exports for backward compatibility with tests ─────────────────
# Tests that ``monkeypatch.setattr(app, "OLLAMA", ...)`` still work because
# the names below become attributes of this module. The middleware reads from
# ``services.config`` via ``_svc_config``, so we also keep the config module
# reference for the middleware closures to read live-patched values.

from services.ollama import (          # noqa: F401
    _restart_ollama_process,
    _wait_for_ollama_ready,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("offlineai")

# ── Route modules ─────────────────────────────────────────────────────
from routes.ui import router as ui_router
from routes.models import router as models_router
from routes.chat import router as chat_router
from routes.tokens import router as tokens_router
from routes.media import router as media_router
from routes.projects import router as projects_router
from routes.generation import router as generation_router
from routes.tools import router as tools_router
from routes.memory import router as memory_router
from routes.portability import router as portability_router
from routes.code import router as code_router
from routes.hooks import router as hooks_router

# ── App creation ──────────────────────────────────────────────────────

app = FastAPI(title="OfflineAI")

# Static file mounts
if _svc_config.STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(_svc_config.STATIC_DIR)), name="static")

if _svc_config._REACT_MODE:
    _react_assets = _svc_config._REACT_DIST / "assets"
    if _react_assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_react_assets)), name="react-assets")


# ── Middleware ─────────────────────────────────────────────────────────

@app.middleware("http")
async def require_lan_token(request: Request, call_next):
    client_host = request.client.host if request.client else ""
    is_loopback = client_host in _svc_config.LOOPBACK_HOSTS
    if _svc_config.AUTH_REQUIRED and not is_loopback and request.url.path.startswith("/api/"):
        supplied = request.headers.get("x-offlineai-token") or request.query_params.get("token")
        if supplied != _svc_config.AUTH_TOKEN:
            log.warning("Auth rejected for %s on %s", client_host, request.url.path)
            return JSONResponse({"error": "Authentication required"}, status_code=401)
    return await call_next(request)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    try:
        body_size = int(content_length) if content_length else 0
    except ValueError:
        return JSONResponse({"error": "Invalid Content-Length header"}, status_code=400)
    if body_size > _svc_config.MAX_BODY:
        log.warning("Request too large: %s bytes", body_size)
        return JSONResponse({"error": "Request body too large (max 50 MB)"}, status_code=413)
    return await call_next(request)


# ── Register routers ──────────────────────────────────────────────────

app.include_router(ui_router)
app.include_router(models_router)
app.include_router(chat_router)
app.include_router(tokens_router)
app.include_router(media_router)
app.include_router(projects_router)
app.include_router(generation_router)
app.include_router(tools_router)
app.include_router(memory_router)
app.include_router(portability_router)
app.include_router(code_router)
app.include_router(hooks_router)


# ── Main ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import socket
    import uvicorn

    host = _svc_config.HOST
    port = _svc_config.PORT

    lan_ip = None
    if host in {"0.0.0.0", "::"}:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            lan_ip = s.getsockname()[0]
            s.close()
        except Exception:
            lan_ip = "127.0.0.1"

    log.info("══════════════════════════════════════════")
    log.info("  OfflineAI")
    log.info(f"  Local:    http://127.0.0.1:{port}")
    if lan_ip:
        log.info(f"  Network:  http://{lan_ip}:{port}")
        if _svc_config.AUTH_REQUIRED:
            log.info(f"  Token:    {_svc_config.AUTH_TOKEN}")
    else:
        log.info("  Network:  disabled (set OFFLINEAI_HOST=0.0.0.0 to expose)")
    log.info("══════════════════════════════════════════")
    log.info("Make sure Ollama is running: ollama serve")
    log.info(f"Make sure model is available: ollama pull {_svc_config.FALLBACK_MODEL}")
    uvicorn.run(app, host=host, port=port)
