import io
import json
import logging
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

import services.config as _svc_config
from services.config import PROJECTS_DIR
from services.projects import _resolve_project_path, _slugify
from services.versions import save_version, list_versions, get_version, restore_version

log = logging.getLogger("offlineai")

router = APIRouter()


def _count_files(project_dir: Path) -> int:
    """Count all files in a project directory, excluding knowledge.json."""
    count = 0
    for f in project_dir.rglob("*"):
        if f.is_file() and f.name != "knowledge.json":
            count += 1
    return count


@router.get("/api/projects")
async def list_projects():
    """List all projects."""
    projects = []
    if _svc_config.PROJECTS_DIR.is_dir():
        for entry in sorted(_svc_config.PROJECTS_DIR.iterdir()):
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


@router.post("/api/projects")
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

    project_dir = _svc_config.PROJECTS_DIR / slug
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

    log.info("Project created: %s (%s)", name, slug)
    return {
        "id": slug,
        "name": name,
        "description": description,
        "created": created,
        "sources_count": 0,
        "findings_count": 0,
        "files_count": 0,
    }


@router.get("/api/projects/{project_id}")
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


@router.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    """Delete an entire project."""
    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    shutil.rmtree(project_dir)
    log.info("Project deleted: %s", project_id)
    return {"ok": True}


@router.get("/api/projects/{project_id}/files")
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


# ── Directory ZIP download ────────────────────────────────────────────


@router.get("/api/projects/{project_id}/download-zip/{dir_path:path}")
async def download_directory_as_zip(project_id: str, dir_path: str):
    """Download a project subdirectory as a ZIP file."""
    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    target_dir = _resolve_project_path(project_id, dir_path)
    if target_dir is None:
        return JSONResponse({"error": "Invalid directory path"}, status_code=400)
    if not target_dir.is_dir():
        return JSONResponse({"error": "Directory not found"}, status_code=404)

    # Build ZIP in memory
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(target_dir.rglob("*")):
            if f.is_file():
                arcname = str(f.relative_to(target_dir))
                zf.write(f, arcname)

    buf.seek(0)
    zip_name = dir_path.rstrip("/").split("/")[-1] or project_id
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}.zip"'},
    )


# ── File move (must be registered before {file_path:path} routes) ────

@router.post("/api/projects/{project_id}/files/move")
async def move_project_file(project_id: str, request: Request):
    """Move or rename a file within a project."""
    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    body = await request.json()
    from_path = (body.get("from_path") or "").strip()
    to_path = (body.get("to_path") or "").strip()

    if not from_path or not to_path:
        return JSONResponse({"error": "Both from_path and to_path are required"}, status_code=400)

    source = _resolve_project_path(project_id, from_path)
    target = _resolve_project_path(project_id, to_path)

    if source is None or target is None:
        return JSONResponse({"error": "Invalid file path"}, status_code=400)
    if not source.is_file():
        return JSONResponse({"error": "Source file not found"}, status_code=404)
    if target.exists():
        return JSONResponse({"error": "Target already exists"}, status_code=409)

    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(target))
    log.info("File moved: %s -> %s in project %s", from_path, to_path, project_id)

    return {"from_path": from_path, "to_path": to_path, "size": target.stat().st_size}


# ── File CRUD with path parameter ────────────────────────────────────

@router.get("/api/projects/{project_id}/files/{file_path:path}")
async def get_project_file(project_id: str, file_path: str):
    """Read a file from a project."""
    target = _resolve_project_path(project_id, file_path)
    if target is None:
        return JSONResponse({"error": "Invalid file path"}, status_code=400)
    if not target.is_file():
        return JSONResponse({"error": "File not found"}, status_code=404)

    size = target.stat().st_size
    try:
        content = target.read_text(encoding="utf-8")
        return {"path": file_path, "content": content, "size": size}
    except (UnicodeDecodeError, ValueError):
        return {"path": file_path, "binary": True, "size": size}


@router.post("/api/projects/{project_id}/files/{file_path:path}")
async def write_project_file(project_id: str, file_path: str, request: Request):
    """Write content to a file in a project."""
    target = _resolve_project_path(project_id, file_path)
    if target is None:
        return JSONResponse({"error": "Invalid file path"}, status_code=400)

    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    body = await request.json()
    content = body.get("content", "")

    # Save existing content as a version before overwriting
    if target.is_file():
        save_version(project_id, file_path)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")

    return {"path": file_path, "size": target.stat().st_size}


@router.delete("/api/projects/{project_id}/files/{file_path:path}")
async def delete_project_file(project_id: str, file_path: str):
    """Delete a file from a project."""
    target = _resolve_project_path(project_id, file_path)
    if target is None:
        return JSONResponse({"error": "Invalid file path"}, status_code=400)
    if not target.is_file():
        return JSONResponse({"error": "File not found"}, status_code=404)

    target.unlink()
    return {"ok": True}


@router.get("/api/projects/{project_id}/download/{file_path:path}")
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


@router.get("/api/projects/{project_id}/view/{file_path:path}")
async def view_project_file(project_id: str, file_path: str):
    """Serve a file inline (opens in browser instead of downloading). Useful for PDFs."""
    target = _resolve_project_path(project_id, file_path)
    if target is None:
        return JSONResponse({"error": "Invalid file path"}, status_code=400)
    if not target.is_file():
        return JSONResponse({"error": "File not found"}, status_code=404)

    ext = target.suffix.lower()
    mime_types = {
        ".pdf": "application/pdf",
        ".html": "text/html",
        ".htm": "text/html",
        ".md": "text/markdown",
        ".txt": "text/plain",
        ".json": "application/json",
        ".csv": "text/csv",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
    }
    media_type = mime_types.get(ext, "application/octet-stream")

    return FileResponse(
        path=str(target),
        filename=target.name,
        media_type=media_type,
        headers={"Content-Disposition": f"inline; filename=\"{target.name}\""},
    )


@router.get("/api/projects/{project_id}/knowledge")
async def get_project_knowledge(project_id: str):
    """Get project knowledge base summary."""
    project_path = _resolve_project_path(project_id)
    if project_path is None or not project_path.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)
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


# ── Project editing (Task 25) ────────────────────────────────────────


@router.put("/api/projects/{project_id}")
async def update_project(project_id: str, request: Request):
    """Update a project's name and/or description. Renames the directory if the name changes."""
    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    knowledge_file = project_dir / "knowledge.json"
    if not knowledge_file.is_file():
        return JSONResponse({"error": "Project metadata missing"}, status_code=404)

    body = await request.json()
    new_name = (body.get("name") or "").strip()
    new_description = body.get("description")

    if not new_name:
        return JSONResponse({"error": "Project name is required"}, status_code=400)

    new_slug = _slugify(new_name)
    if not new_slug:
        return JSONResponse({"error": "Invalid project name"}, status_code=400)

    try:
        knowledge = json.loads(knowledge_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        return JSONResponse({"error": f"Failed to read project: {exc}"}, status_code=500)

    # Update knowledge metadata
    knowledge["name"] = new_name
    if new_description is not None:
        knowledge["description"] = new_description.strip()

    # Rename directory if slug changed
    final_dir = project_dir
    final_id = project_id
    if new_slug != project_id:
        new_dir = _svc_config.PROJECTS_DIR / new_slug
        if new_dir.exists():
            return JSONResponse({"error": f"Project '{new_slug}' already exists"}, status_code=409)
        project_dir.rename(new_dir)
        final_dir = new_dir
        final_id = new_slug
        knowledge_file = final_dir / "knowledge.json"

    knowledge_file.write_text(json.dumps(knowledge, indent=2, ensure_ascii=False), encoding="utf-8")
    log.info("Project updated: %s -> %s", project_id, final_id)

    return {
        "id": final_id,
        "name": knowledge.get("name", final_id),
        "description": knowledge.get("description", ""),
        "created": knowledge.get("created", ""),
        "sources_count": len(knowledge.get("sources", [])),
        "findings_count": len(knowledge.get("findings", [])),
        "files_count": _count_files(final_dir),
    }


# ── Version history (Task 26) ────────────────────────────────────────


@router.get("/api/projects/{project_id}/files/{file_path:path}/versions")
async def list_file_versions(project_id: str, file_path: str):
    """List all stored versions of a project file."""
    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    versions = list_versions(project_id, file_path)
    return {"file_path": file_path, "versions": versions}


@router.get("/api/projects/{project_id}/files/{file_path:path}/versions/{version}")
async def get_file_version(project_id: str, file_path: str, version: int):
    """Get the content of a specific version of a project file."""
    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    content = get_version(project_id, file_path, version)
    if content is None:
        return JSONResponse({"error": "Version not found"}, status_code=404)

    return {"file_path": file_path, "version": version, "content": content}


@router.post("/api/projects/{project_id}/files/{file_path:path}/restore/{version}")
async def restore_file_version(project_id: str, file_path: str, version: int):
    """Restore a specific version of a file, saving the current content as a new version."""
    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    success = restore_version(project_id, file_path, version)
    if not success:
        return JSONResponse({"error": "Version not found or restore failed"}, status_code=404)

    return {"file_path": file_path, "restored_version": version, "ok": True}


# ── Steering documents ────────────────────────────────────────────────


@router.post("/api/projects/{project_id}/steering/generate")
async def generate_steering(project_id: str, request: Request):
    """Generate steering documents for a project. Streams SSE progress."""
    from services.steering import generate_steering_doc, STEERING_DOCS
    from services.system import _sse_event
    from services.queue import queued_sse_stream

    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    body = await request.json()
    model = body.get("model", _svc_config.FALLBACK_MODEL)

    async def stream():
        try:
            for doc_name in STEERING_DOCS:
                label = doc_name.replace('.md', '').title()
                yield _sse_event({"type": "status", "message": f"Generating {label}..."})
                yield _sse_event({"type": "doc_start", "doc_name": doc_name})
                async for token in generate_steering_doc(project_id, doc_name, model):
                    yield _sse_event({"type": "token", "text": token, "doc_name": doc_name})
                yield _sse_event({"type": "doc_done", "doc_name": doc_name})
            yield _sse_event({"type": "done", "message": "Steering documents generated"})
        except Exception as exc:
            yield _sse_event({"type": "error", "error": str(exc)})

    return StreamingResponse(
        queued_sse_stream(stream()),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/projects/{project_id}/steering")
async def list_steering(project_id: str):
    """List all steering documents for a project."""
    from services.steering import list_steering_docs

    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    docs = list_steering_docs(project_id)
    return {"docs": docs}


@router.get("/api/projects/{project_id}/steering/{doc_name}")
async def read_steering(project_id: str, doc_name: str):
    """Read a single steering document."""
    from services.steering import get_steering_doc

    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    content = get_steering_doc(project_id, doc_name)
    if content is None:
        return JSONResponse({"error": "Steering document not found"}, status_code=404)

    return {"name": doc_name, "content": content}


@router.put("/api/projects/{project_id}/steering/{doc_name}")
async def update_steering(project_id: str, doc_name: str, request: Request):
    """Update a steering document."""
    from services.steering import update_steering_doc

    project_dir = _resolve_project_path(project_id)
    if project_dir is None or not project_dir.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    body = await request.json()
    content = body.get("content", "")

    success = update_steering_doc(project_id, doc_name, content)
    if not success:
        return JSONResponse({"error": "Failed to update steering document"}, status_code=400)

    return {"name": doc_name, "ok": True}
