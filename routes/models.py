import asyncio
import platform
import shutil
import time
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
import httpx

import services.config as _svc_config
from services.config import (
    OLLAMA,
    HOST,
    PORT,
    AUTH_REQUIRED,
    FALLBACK_MODEL,
    PROJECTS_DIR,
    PLUGINS_DIR,
    _SERVER_START_TIME,
)
from services.system import _get_system_memory, _dir_size_mb, _runtime_control_allowed
from services.media import (
    _WHISPER_AVAILABLE,
    _WHISPER_MODEL_SIZE,
    _DOCX_AVAILABLE,
    _WEASYPRINT_AVAILABLE,
)
from services.memory import _load_memories
from services.tools import _load_tool_registry
from services.ollama import (
    _ollama_json_request as _ollama_json_request_impl,
    stream_ollama_response,
    _restart_ollama_process,
    _wait_for_ollama_ready,
)

router = APIRouter()


async def _ollama_json_request(method: str, path: str, *, body: dict | None = None, timeout: float = 5.0) -> dict:
    """Thin wrapper that ensures the current config.OLLAMA is used (testability)."""
    return await _ollama_json_request_impl(method, path, body=body, timeout=timeout)


@router.get("/api/models")
async def get_models():
    try:
        return await _ollama_json_request("GET", "/api/tags", timeout=3.0)
    except Exception as exc:
        return {"models": [{"name": _svc_config.FALLBACK_MODEL}], "offline": True, "error": str(exc)}


@router.get("/api/status")
async def status():
    try:
        data = await _ollama_json_request("GET", "/api/tags", timeout=2.0)
        return {
            "ollama": True,
            "models_count": len(data.get("models", [])),
            "lan": _svc_config.HOST in {"0.0.0.0", "::"},
            "auth_required": _svc_config.AUTH_REQUIRED,
            "host": _svc_config.HOST,
            "port": _svc_config.PORT,
        }
    except Exception as exc:
        return JSONResponse(
            {
                "ollama": False,
                "error": str(exc),
                "lan": _svc_config.HOST in {"0.0.0.0", "::"},
                "auth_required": _svc_config.AUTH_REQUIRED,
                "host": _svc_config.HOST,
                "port": _svc_config.PORT,
            },
            status_code=503,
        )


@router.get("/api/health")
async def health_check():
    """Comprehensive health/diagnostics endpoint."""
    # --- Ollama ---
    ollama_info: dict = {"status": "offline", "version": None, "models_count": 0}
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            ver_resp = await client.get(f"{_svc_config.OLLAMA}/api/version")
            if ver_resp.status_code == 200:
                ver_data = ver_resp.json()
                ollama_info["version"] = ver_data.get("version")
            tags_resp = await client.get(f"{_svc_config.OLLAMA}/api/tags")
            if tags_resp.status_code == 200:
                ollama_info["status"] = "online"
                ollama_info["models_count"] = len(tags_resp.json().get("models", []))
    except Exception:
        pass

    # --- System ---
    ram_total, ram_avail = await asyncio.to_thread(_get_system_memory)
    try:
        disk = shutil.disk_usage(Path.home())
        disk_free_gb = round(disk.free / (1024 ** 3), 1)
    except Exception:
        disk_free_gb = 0

    system_info = {
        "platform": platform.system().lower(),
        "python": platform.python_version(),
        "ram_total_gb": ram_total,
        "ram_available_gb": ram_avail,
        "disk_free_gb": disk_free_gb,
    }

    # --- Services ---
    services: dict = {}

    # Whisper
    if _WHISPER_AVAILABLE:
        services["whisper"] = {"available": True, "model": _WHISPER_MODEL_SIZE}
    else:
        services["whisper"] = {"available": False, "reason": "faster-whisper not installed"}

    # WeasyPrint
    if _WEASYPRINT_AVAILABLE:
        services["weasyprint"] = {"available": True}
    else:
        services["weasyprint"] = {"available": False, "reason": "weasyprint not installed"}

    # Diffusers / image generation — check if torch is importable
    try:
        import torch  # noqa: F401
        services["diffusers"] = {"available": True}
    except ImportError:
        services["diffusers"] = {"available": False, "reason": "torch not installed"}

    # Document parsing
    if _DOCX_AVAILABLE:
        services["docx"] = {"available": True}
    else:
        services["docx"] = {"available": False, "reason": "python-docx not installed"}

    # --- Projects ---
    project_count = 0
    if _svc_config.PROJECTS_DIR.is_dir():
        project_count = sum(1 for d in _svc_config.PROJECTS_DIR.iterdir() if d.is_dir() and (d / "knowledge.json").is_file())
    projects_disk = await asyncio.to_thread(_dir_size_mb, _svc_config.PROJECTS_DIR) if _svc_config.PROJECTS_DIR.is_dir() else 0

    # --- Tools ---
    registry = _load_tool_registry()
    tools_enabled = sum(1 for t in registry if t.get("enabled", True))
    tools_disabled = len(registry) - tools_enabled

    # --- Memory ---
    memories = _load_memories()

    # --- Uptime ---
    uptime = round(time.time() - _svc_config._SERVER_START_TIME)

    return {
        "ollama": ollama_info,
        "system": system_info,
        "services": services,
        "projects": {"count": project_count, "disk_usage_mb": projects_disk},
        "tools": {"count": len(registry), "enabled": tools_enabled, "disabled": tools_disabled},
        "memory": {"count": len(memories)},
        "uptime_seconds": uptime,
    }


@router.post("/api/ollama/restart")
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


@router.post("/api/show")
async def show_model(request: Request):
    body = await request.json()
    try:
        return await _ollama_json_request("POST", "/api/show", body=body, timeout=5.0)
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=502)


@router.post("/api/pull")
async def pull_model(request: Request):
    body = await request.json()
    return StreamingResponse(
        stream_ollama_response("/api/pull", body, write_timeout=30.0),
        media_type="application/x-ndjson",
    )


@router.get("/api/queue/status")
async def queue_status():
    """Return the current operation queue status."""
    from services.queue import get_status
    return await get_status()
