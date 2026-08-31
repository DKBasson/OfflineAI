import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import services.config as _svc_config
from services.projects import _resolve_project_path
from services.hooks import (
    load_hooks,
    create_hook,
    get_hook,
    update_hook,
    delete_hook,
    toggle_hook,
    execute_hook,
)

log = logging.getLogger("offlineai")

router = APIRouter()


def _validate_project(project_id: str):
    """Return the resolved project dir or a 404 JSONResponse."""
    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return None, JSONResponse({"error": "Project not found"}, status_code=404)
    return project_dir, None


@router.get("/api/projects/{project_id}/hooks")
async def list_hooks(project_id: str):
    """List all hooks for a project."""
    project_dir, err = _validate_project(project_id)
    if err:
        return err
    hooks = load_hooks(project_id)
    return {"hooks": hooks}


@router.post("/api/projects/{project_id}/hooks")
async def create_hook_endpoint(project_id: str, request: Request):
    """Create a new hook for a project."""
    project_dir, err = _validate_project(project_id)
    if err:
        return err
    body = await request.json()
    name = (body.get("name") or "").strip()
    event_type = (body.get("event_type") or "").strip()
    instructions = (body.get("instructions") or "").strip()
    if not name:
        return JSONResponse({"error": "Hook name is required"}, status_code=400)
    if not event_type:
        return JSONResponse({"error": "Event type is required"}, status_code=400)
    if not instructions:
        return JSONResponse({"error": "Instructions are required"}, status_code=400)
    hook = create_hook(project_id, name=name, event_type=event_type, instructions=instructions)
    return {"ok": True, "hook": hook}


@router.put("/api/projects/{project_id}/hooks/{hook_id}")
async def update_hook_endpoint(project_id: str, hook_id: str, request: Request):
    """Update an existing hook."""
    project_dir, err = _validate_project(project_id)
    if err:
        return err
    body = await request.json()
    hook = get_hook(project_id, hook_id)
    if hook is None:
        return JSONResponse({"error": "Hook not found"}, status_code=404)
    updated = update_hook(project_id, hook_id, body)
    return {"ok": True, "hook": updated}


@router.delete("/api/projects/{project_id}/hooks/{hook_id}")
async def delete_hook_endpoint(project_id: str, hook_id: str):
    """Delete a hook."""
    project_dir, err = _validate_project(project_id)
    if err:
        return err
    hook = get_hook(project_id, hook_id)
    if hook is None:
        return JSONResponse({"error": "Hook not found"}, status_code=404)
    delete_hook(project_id, hook_id)
    return {"ok": True}


@router.post("/api/projects/{project_id}/hooks/{hook_id}/toggle")
async def toggle_hook_endpoint(project_id: str, hook_id: str):
    """Toggle a hook's enabled state."""
    project_dir, err = _validate_project(project_id)
    if err:
        return err
    hook = get_hook(project_id, hook_id)
    if hook is None:
        return JSONResponse({"error": "Hook not found"}, status_code=404)
    toggled = toggle_hook(project_id, hook_id)
    return {"ok": True, "hook": toggled}


@router.post("/api/projects/{project_id}/hooks/{hook_id}/execute")
async def execute_hook_endpoint(project_id: str, hook_id: str, request: Request):
    """Manually execute a hook."""
    project_dir, err = _validate_project(project_id)
    if err:
        return err
    hook = get_hook(project_id, hook_id)
    if hook is None:
        return JSONResponse({"error": "Hook not found"}, status_code=404)
    body = await request.json()
    model = body.get("model", _svc_config.FALLBACK_MODEL)
    context = body.get("context", {})
    result = await execute_hook(project_id, hook_id, model=model, context=context)
    return {"ok": True, "result": result}
