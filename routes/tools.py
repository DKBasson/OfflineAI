import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import services.config as _svc_config
from services.config import FALLBACK_MODEL, PLUGINS_DIR
from services.tools import (
    _load_tool_registry,
    _save_tool_registry,
    _execute_tool,
    _build_tool,
    _build_tool_preview,
)

router = APIRouter()


@router.get("/api/tools")
async def list_tools():
    return {"tools": _load_tool_registry()}


@router.get("/api/tools/{tool_name}")
async def get_tool(tool_name: str):
    registry = _load_tool_registry()
    tool = next((t for t in registry if t["name"] == tool_name), None)
    if not tool:
        return JSONResponse({"error": "Tool not found"}, status_code=404)
    module_path = _svc_config.PLUGINS_DIR / tool["module"]
    code = module_path.read_text(encoding="utf-8") if module_path.exists() else ""
    return {**tool, "code": code}


@router.post("/api/tools/{tool_name}/execute")
async def execute_tool_endpoint(tool_name: str, request: Request):
    body = await request.json()
    params = body.get("params", {})
    result = await asyncio.to_thread(_execute_tool, tool_name, params)
    return result


@router.delete("/api/tools/{tool_name}")
async def delete_tool(tool_name: str):
    registry = _load_tool_registry()
    tool = next((t for t in registry if t["name"] == tool_name), None)
    if not tool:
        return JSONResponse({"error": "Tool not found"}, status_code=404)
    module_path = _svc_config.PLUGINS_DIR / tool["module"]
    if module_path.exists():
        module_path.unlink()
    registry = [t for t in registry if t["name"] != tool_name]
    _save_tool_registry(registry)
    return {"ok": True}


@router.post("/api/tools/{tool_name}/toggle")
async def toggle_tool(tool_name: str):
    registry = _load_tool_registry()
    for t in registry:
        if t["name"] == tool_name:
            t["enabled"] = not t.get("enabled", True)
            _save_tool_registry(registry)
            return {"ok": True, "enabled": t["enabled"]}
    return JSONResponse({"error": "Tool not found"}, status_code=404)


@router.post("/api/tools/{tool_name}/preview")
async def preview_tool(tool_name: str):
    """Return tool source, parameters, and sample invocation without executing."""
    registry = _load_tool_registry()
    tool = next((t for t in registry if t["name"] == tool_name), None)
    if not tool:
        return JSONResponse({"error": "Tool not found"}, status_code=404)
    module_path = _svc_config.PLUGINS_DIR / tool["module"]
    code = module_path.read_text(encoding="utf-8") if module_path.exists() else ""
    sample_params = {}
    for k, v in tool.get("parameters", {}).items():
        if v.get("type") == "number":
            sample_params[k] = 0
        elif v.get("type") == "boolean":
            sample_params[k] = True
        else:
            sample_params[k] = f"<{v.get('description', k)}>"
    return {
        "name": tool["name"],
        "description": tool.get("description", ""),
        "parameters": tool.get("parameters", {}),
        "code": code,
        "enabled": tool.get("enabled", True),
        "sample_invocation": {
            "endpoint": f"/api/tools/{tool_name}/execute",
            "method": "POST",
            "body": {"params": sample_params},
        },
    }


@router.post("/api/tools/build")
async def build_tool_endpoint(request: Request):
    body = await request.json()
    description = (body.get("description") or "").strip()
    model = body.get("model", _svc_config.FALLBACK_MODEL)
    preview = body.get("preview", False)
    if not description:
        return JSONResponse({"error": "No description provided"}, status_code=400)
    if preview:
        result = await _build_tool_preview(description, model)
    else:
        result = await _build_tool(description, model)
    return result
