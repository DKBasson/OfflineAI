"""
Code import and analysis routes for OfflineAI.

Handles importing existing code folders, generating project understanding
documents, and creating change plans with clarifying questions.
"""

import asyncio
import json
import logging
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
import httpx

import services.config as _svc_config
from services.system import _sse_event
from services.queue import queued_sse_stream
from services.projects import _resolve_project_path

log = logging.getLogger("offlineai")

router = APIRouter()

# ── Folder scanning constants ─────────────────────────────────────────

_SKIP_DIRS = frozenset({
    'node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv',
    'env', 'dist', 'build', 'out', '.cache', 'target', '.next',
    '.nuxt', '.output', 'vendor', 'Pods', '.gradle', '.idea', '.vscode',
    'coverage', '.nyc_output', '.pytest_cache', '.tox',
})

_CODE_EXT = frozenset({
    '.py', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.scss', '.less',
    '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
    '.md', '.txt', '.rst', '.sh', '.bash',
    '.java', '.kt', '.scala', '.c', '.cpp', '.h', '.hpp', '.cs', '.go',
    '.rs', '.swift', '.rb', '.php', '.lua', '.r', '.sql', '.graphql',
    '.vue', '.svelte', '.astro', '.xml', '.proto', '.dockerfile', '.tf',
})

_CONFIG_NAMES = frozenset({
    'makefile', 'dockerfile', 'procfile', 'gemfile', 'requirements.txt',
    'package.json', 'tsconfig.json', 'cargo.toml', 'go.mod', 'pom.xml',
    'build.gradle', '.eslintrc', '.prettierrc', 'jest.config.js',
})

_MAX_FILE_SIZE = 100_000
_MAX_FILES = 200
_MAX_CONTENT = 6000


def _scan_folder(folder: Path) -> list[dict]:
    """Recursively scan a folder for code files."""
    files: list[dict] = []
    if not folder.is_dir():
        return files
    for item in sorted(folder.rglob("*")):
        if len(files) >= _MAX_FILES:
            break
        if any(p in _SKIP_DIRS for p in item.parts):
            continue
        if not item.is_file():
            continue
        if item.suffix.lower() not in _CODE_EXT and item.name.lower() not in _CONFIG_NAMES:
            continue
        try:
            sz = item.stat().st_size
            if sz > _MAX_FILE_SIZE or sz == 0:
                continue
        except OSError:
            continue
        try:
            body = item.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        files.append({
            "path": str(item.relative_to(folder)),
            "size": sz,
            "content": body[:_MAX_CONTENT],
        })
    return files


# ── Import endpoint ───────────────────────────────────────────────────

@router.post("/api/projects/{project_id}/code/import")
async def code_import(project_id: str, request: Request):
    """Import an existing code folder and generate a project understanding document.

    Accepts ``{folder_path, model}``. Scans the folder, copies files into the
    project, then streams a comprehensive Markdown analysis of the codebase.
    Creates an active code session so the user can request edits via chat.
    """
    from services.code_session import (
        create_session, update_session, add_conversation_message,
    )

    body = await request.json()
    folder_path = (body.get("folder_path") or "").strip()
    if not folder_path:
        return JSONResponse({"error": "No folder_path provided"}, status_code=400)

    folder = Path(folder_path).expanduser().resolve()
    if not folder.is_dir():
        return JSONResponse({"error": f"Folder not found: {folder_path}"}, status_code=404)

    project_path = _resolve_project_path(project_id)
    if project_path is None or not project_path.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    model = body.get("model", _svc_config.FALLBACK_MODEL)

    async def stream():
        try:
            # ── Phase 1: Scan ────────────────────────────────────────
            yield _sse_event({"type": "status", "message": f"Scanning {folder.name}\u2026"})

            scanned = await asyncio.to_thread(_scan_folder, folder)
            total_bytes = sum(f["size"] for f in scanned)
            yield _sse_event({
                "type": "scan",
                "files_count": len(scanned),
                "total_size": total_bytes,
                "message": f"Found {len(scanned)} code files ({total_bytes // 1024} KB)",
            })

            if not scanned:
                yield _sse_event({"type": "error", "error": "No code files found in the folder"})
                return

            # ── Phase 2: Copy files into project ─────────────────────
            yield _sse_event({"type": "status", "message": "Copying files to project\u2026"})

            imp_dir = project_path / "output" / "code" / f"imported-{folder.name}"
            imp_dir.mkdir(parents=True, exist_ok=True)

            registered: list[str] = []
            for f in scanned:
                tgt = imp_dir / f["path"]
                tgt.parent.mkdir(parents=True, exist_ok=True)
                try:
                    tgt.write_bytes((folder / f["path"]).read_bytes())
                except Exception:
                    continue
                registered.append(str(tgt.relative_to(project_path)))

            # Create session
            session = create_session(project_id, f"Imported: {folder.name}")
            update_session(project_id, generated_files=registered, status="analyzing")

            # ── Phase 3: Generate understanding document ─────────────
            yield _sse_event({"type": "status", "message": "Analyzing project\u2026"})

            tree = "\n".join(f"  {f['path']} ({f['size']} B)" for f in scanned)

            blocks: list[str] = []
            chars = 0
            for f in scanned:
                blk = f"=== FILE: {f['path']} ===\n{f['content']}\n=== END FILE ==="
                if chars + len(blk) > 60_000:
                    blocks.append(f"=== FILE: {f['path']} ===\n[truncated for context]\n=== END FILE ===")
                    continue
                blocks.append(blk)
                chars += len(blk)

            prompt = (
                "You are a senior software architect analyzing an existing codebase.\n\n"
                f"PROJECT: {folder.name}\n"
                f"FILE TREE ({len(scanned)} files):\n{tree}\n\n"
                "FILE CONTENTS:\n" + "\n\n".join(blocks) + "\n\n"
                "Generate a comprehensive project understanding document in Markdown:\n\n"
                f"# Project: {folder.name}\n\n"
                "## Overview\nWhat this project does, its purpose, main functionality.\n\n"
                "## Architecture\nHow the codebase is organized \u2014 layers, modules, patterns, entry points.\n\n"
                "## Technology Stack\nLanguages, frameworks, libraries (with versions from config files).\n\n"
                "## Key Components\nFor each major module: name, purpose, key files and functions.\n\n"
                "## File Map\nBrief description of each important file or directory.\n\n"
                "## Dependencies\nExternal dependencies and their purposes.\n\n"
                "## Potential Improvements\nTech debt, issues, or opportunities you notice.\n\n"
                "Be specific \u2014 reference actual file names, function names, and code patterns."
            )

            md = ""
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=5.0, read=None, write=120.0, pool=5.0)
            ) as client:
                async with client.stream("POST", f"{_svc_config.OLLAMA}/api/chat", json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": True,
                    "options": {"temperature": 0.3, "num_predict": 8192, "num_ctx": 32768},
                }) as resp:
                    async for ln in resp.aiter_lines():
                        ln = ln.strip()
                        if not ln:
                            continue
                        try:
                            d = json.loads(ln)
                            tok = d.get("message", {}).get("content", "")
                            if tok:
                                md += tok
                                yield _sse_event({"type": "token", "text": tok})
                            if d.get("done"):
                                break
                        except json.JSONDecodeError:
                            continue

            # Save the understanding document
            (project_path / ".code_memory.md").write_text(md, encoding="utf-8")
            (project_path / "output").mkdir(exist_ok=True)
            (project_path / "output" / f"{folder.name}-analysis.md").write_text(
                md, encoding="utf-8"
            )

            update_session(project_id, status="active", plan_md=md)
            add_conversation_message(
                project_id, "assistant",
                f"Project analysis complete for {folder.name}.",
            )
            add_conversation_message(project_id, "system", md[:3000])

            yield _sse_event({"type": "understanding", "content": md})
            # Auto-generate steering from scan results
            try:
                yield _sse_event({"type": "status", "message": "Generating steering documents\u2026"})
                from services.steering import generate_steering_doc, STEERING_DOCS
                for doc_name in STEERING_DOCS:
                    doc_content = ""
                    async for _tok in generate_steering_doc(project_id, doc_name, model, scanned):
                        doc_content += _tok
                    yield _sse_event({"type": "status", "message": f"Generated {doc_name}"})
            except Exception as _exc:
                log.warning("Steering generation during import failed: %s", _exc)

            yield _sse_event({
                "type": "done",
                "session_id": session["id"],
                "message": f"Imported {len(registered)} files from {folder.name}",
                "files_count": len(registered),
            })

        except Exception as exc:
            yield _sse_event({"type": "error", "error": str(exc)})

    return StreamingResponse(
        queued_sse_stream(stream()),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Analyze / change-plan endpoint ───────────────────────────────────

@router.post("/api/projects/{project_id}/code/analyze")
async def code_analyze(project_id: str, request: Request):
    """Analyze imported code and generate a change plan.

    Phase 1 \u2014 asks 1\u20133 clarifying questions.
    Phase 2 \u2014 generates a Markdown change plan.
    After the plan, the user sends regular messages which route through
    ``/code/edit`` to apply changes.
    """
    from services.code_session import (
        get_session, update_session, add_conversation_message,
        get_session_files_content,
    )

    body = await request.json()
    change_request = (body.get("request") or "").strip()
    if not change_request:
        return JSONResponse({"error": "No change request provided"}, status_code=400)

    session = get_session(project_id)
    if not session or session.get("status") not in ("active", "analyzing"):
        return JSONResponse({"error": "No active code session"}, status_code=404)

    project_path = _resolve_project_path(project_id)
    if project_path is None or not project_path.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    model = body.get("model", _svc_config.FALLBACK_MODEL)

    # Load understanding context
    mem = project_path / ".code_memory.md"
    understanding = ""
    if mem.exists():
        try:
            understanding = mem.read_text(encoding="utf-8")[:8000]
        except Exception:
            pass

    files_ctx = get_session_files_content(project_id, max_chars_per_file=3000)
    add_conversation_message(project_id, "user", change_request)

    async def stream():
        try:
            # ── Phase 1: Clarifying questions ────────────────────────
            yield _sse_event({"type": "status", "message": "Analyzing change request\u2026"})

            q_prompt = (
                "You are a senior developer working on an existing codebase.\n\n"
                f"PROJECT UNDERSTANDING:\n{understanding[:4000]}\n\n"
                f"CHANGE REQUEST: \"{change_request}\"\n\n"
                "Ask 1\u20133 specific clarifying questions about scope, behaviour, "
                "or constraints. Return ONLY the questions, one per line, numbered."
            )

            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(f"{_svc_config.OLLAMA}/api/chat", json={
                    "model": model,
                    "messages": [{"role": "user", "content": q_prompt}],
                    "stream": False,
                    "options": {"temperature": 0.5, "num_predict": 512},
                })
                raw_q = resp.json().get("message", {}).get("content", "")

            questions = [
                ln.strip()
                for ln in raw_q.strip().split("\n")
                if ln.strip() and len(ln.strip()) > 10
            ][:3]
            for q in questions:
                yield _sse_event({"type": "question", "text": q})

            # ── Phase 2: Change plan ─────────────────────────────────
            yield _sse_event({"type": "status", "message": "Creating change plan\u2026"})

            plan_prompt = (
                "You are a senior developer creating a change plan.\n\n"
                f"PROJECT UNDERSTANDING:\n{understanding[:4000]}\n\n"
                f"CURRENT CODE (abbreviated):\n{files_ctx[:20000]}\n\n"
                f"CHANGE REQUEST: \"{change_request}\"\n\n"
                "Create a Markdown plan with these sections:\n"
                f"# Change Plan: {change_request[:60]}\n"
                "## Summary \u2014 what and why\n"
                "## Files to Modify \u2014 specific files and changes needed\n"
                "## Files to Create \u2014 new files if any\n"
                "## Implementation Steps \u2014 ordered, testable steps\n"
                "## Risk Assessment \u2014 what could break\n\n"
                "Reference actual file names and functions from the codebase."
            )

            plan_md = ""
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=5.0, read=None, write=120.0, pool=5.0)
            ) as client:
                async with client.stream("POST", f"{_svc_config.OLLAMA}/api/chat", json={
                    "model": model,
                    "messages": [{"role": "user", "content": plan_prompt}],
                    "stream": True,
                    "options": {"temperature": 0.3, "num_predict": 4096, "num_ctx": 32768},
                }) as resp:
                    async for ln in resp.aiter_lines():
                        ln = ln.strip()
                        if not ln:
                            continue
                        try:
                            d = json.loads(ln)
                            tok = d.get("message", {}).get("content", "")
                            if tok:
                                plan_md += tok
                                yield _sse_event({"type": "token", "text": tok})
                            if d.get("done"):
                                break
                        except json.JSONDecodeError:
                            continue

            if plan_md:
                update_session(project_id, plan_md=plan_md)
                add_conversation_message(project_id, "assistant", plan_md)
                yield _sse_event({"type": "plan", "plan_md": plan_md})

            yield _sse_event({
                "type": "done",
                "message": "Change plan ready. Send a message to apply changes.",
            })

        except Exception as exc:
            yield _sse_event({"type": "error", "error": str(exc)})

    return StreamingResponse(
        queued_sse_stream(stream()),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Spec phase management ─────────────────────────────────────────────

@router.post("/api/projects/{project_id}/code/spec/approve")
async def spec_approve(project_id: str, request: Request):
    """Approve current spec phase and advance to next."""
    from services.code_session import get_session, approve_phase

    session = get_session(project_id)
    if not session:
        return JSONResponse({"error": "No active code session"}, status_code=404)

    result = approve_phase(project_id)
    if not result:
        return JSONResponse({"error": "Cannot advance phase from current state"}, status_code=400)

    return {
        "ok": True,
        "spec_phase": result.get("spec_phase"),
        "status": result.get("status"),
        "session_id": result.get("id"),
    }


@router.get("/api/projects/{project_id}/code/spec")
async def get_spec(project_id: str):
    """Get all spec documents for the current session."""
    from services.code_session import get_session

    session = get_session(project_id)
    if not session:
        return JSONResponse({"error": "No active code session"}, status_code=404)

    return {
        "spec_phase": session.get("spec_phase", "requirements"),
        "requirements_md": session.get("requirements_md", ""),
        "design_md": session.get("design_md", ""),
        "tasks_md": session.get("tasks_md", ""),
        "tasks_completed": session.get("tasks_completed", []),
        "status": session.get("status"),
    }


@router.post("/api/projects/{project_id}/code/spec/generate")
async def spec_generate_next(project_id: str, request: Request):
    """Generate the next spec document (design or tasks) based on current phase."""
    from services.code_session import (
        get_session, update_session, add_conversation_message, save_spec_file,
    )
    from services.steering import get_steering_context
    from services.system import _sse_event
    from services.queue import queued_sse_stream

    session = get_session(project_id)
    if not session:
        return JSONResponse({"error": "No active code session"}, status_code=404)

    phase = session.get("spec_phase")
    if phase not in ("design", "tasks"):
        return JSONResponse({"error": f"Cannot generate for phase: {phase}"}, status_code=400)

    project_path = _resolve_project_path(project_id)
    if project_path is None or not project_path.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    body = await request.json()
    model = body.get("model", _svc_config.FALLBACK_MODEL)
    steering_ctx = get_steering_context(project_id)
    requirements_md = session.get("requirements_md", "")
    design_md = session.get("design_md", "")
    description = session.get("description", "")

    async def stream():
        try:
            if phase == "design":
                yield _sse_event({"type": "status", "message": "Generating technical design..."})
                prompt = (
                    "You are a senior software architect creating a technical design document.\n\n"
                    f"{f'STEERING CONTEXT:\n{steering_ctx[:4000]}\n\n' if steering_ctx else ''}"
                    f"APPROVED REQUIREMENTS:\n{requirements_md}\n\n"
                    f"PROJECT: {description}\n\n"
                    "Generate a comprehensive design.md with these sections:\n"
                    "# Technical Design\n\n"
                    "## Architecture Overview\n"
                    "High-level architecture with component relationships.\n\n"
                    "## Technology Stack\n"
                    "| Layer | Technology | Purpose |\n|-------|-----------|---------|\n(fill in)\n\n"
                    "## Components & Interfaces\n"
                    "For each component: Purpose, Responsibilities, Interfaces (Input/Output/Dependencies), Implementation Notes.\n\n"
                    "## Data Models\n"
                    "TypeScript/Python interfaces for key entities with validation rules.\n\n"
                    "## API Design\n"
                    "Endpoints with Method, Path, Request/Response schemas, Error responses.\n\n"
                    "## Security Considerations\n"
                    "Authentication, authorization, input validation.\n\n"
                    "## Error Handling\n"
                    "Error categories, response format, logging strategy.\n\n"
                    "Reference actual requirements from the approved requirements doc. "
                    "Be specific and actionable."
                )
            else:  # tasks
                yield _sse_event({"type": "status", "message": "Generating implementation tasks..."})
                prompt = (
                    "You are a senior developer creating an implementation task list.\n\n"
                    f"{f'STEERING CONTEXT:\n{steering_ctx[:3000]}\n\n' if steering_ctx else ''}"
                    f"APPROVED REQUIREMENTS:\n{requirements_md[:4000]}\n\n"
                    f"APPROVED DESIGN:\n{design_md[:4000]}\n\n"
                    f"PROJECT: {description}\n\n"
                    "Generate a tasks.md with phased implementation plan.\n\n"
                    "Use this format for EACH task:\n"
                    "- [ ] X. Task title\n"
                    "  - Subtask description 1\n"
                    "  - Subtask description 2\n"
                    "  - Write tests for this task\n"
                    "  - _Requirements: [X.X]_\n\n"
                    "Organize into phases:\n"
                    "### Phase 1: Foundation & Setup\n"
                    "### Phase 2: Core Business Logic\n"
                    "### Phase 3: API Layer\n"
                    "### Phase 4: UI Components\n"
                    "### Phase 5: Integration & Testing\n"
                    "### Phase 6: Documentation & Deployment\n\n"
                    "Each task should be completable independently. "
                    "Link each task back to specific requirements with _Requirements: [X.X]_.\n"
                    "Include testing subtasks in every task."
                )

            content = ""
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=5.0, read=None, write=120.0, pool=5.0)
            ) as client:
                async with client.stream("POST", f"{_svc_config.OLLAMA}/api/chat", json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": True,
                    "options": {"temperature": 0.3, "num_predict": 4096, "num_ctx": 32768},
                }) as resp:
                    async for ln in resp.aiter_lines():
                        ln = ln.strip()
                        if not ln:
                            continue
                        try:
                            d = json.loads(ln)
                            tok = d.get("message", {}).get("content", "")
                            if tok:
                                content += tok
                                yield _sse_event({"type": "token", "text": tok})
                            if d.get("done"):
                                break
                        except json.JSONDecodeError:
                            continue

            new_phase = phase  # fallback
            if content:
                if phase == "design":
                    new_phase = "design_review"
                    update_session(project_id, design_md=content, spec_phase=new_phase, status=new_phase)
                    save_spec_file(project_id, "design.md", content)
                    add_conversation_message(project_id, "assistant", "Design document generated.")
                else:
                    new_phase = "tasks_review"
                    update_session(project_id, tasks_md=content, spec_phase=new_phase, status=new_phase)
                    save_spec_file(project_id, "tasks.md", content)
                    add_conversation_message(project_id, "assistant", "Tasks document generated.")

                yield _sse_event({"type": "spec_content", "content": content, "doc_type": phase})

            yield _sse_event({
                "type": "done",
                "spec_phase": new_phase,
                "message": f"{phase.title()} document generated",
            })

        except Exception as exc:
            yield _sse_event({"type": "error", "error": str(exc)})

    return StreamingResponse(
        queued_sse_stream(stream()),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Task-by-task execution ────────────────────────────────────────────

@router.post("/api/projects/{project_id}/code/task/execute")
async def execute_task(project_id: str, request: Request):
    """Execute a single task from the tasks.md spec."""
    from services.code_session import (
        get_session, update_session, get_session_files_content,
        mark_task_completed, get_spec_context,
    )
    from services.steering import get_steering_context
    from services.versions import save_version
    from services.system import _sse_event
    from services.queue import queued_sse_stream
    from services.projects import _parse_code_files

    body = await request.json()
    task_id = (body.get("task_id") or "").strip()
    if not task_id:
        return JSONResponse({"error": "No task_id provided"}, status_code=400)

    session = get_session(project_id)
    if not session or session.get("status") not in ("ready", "executing", "active"):
        return JSONResponse({"error": "No ready code session"}, status_code=404)

    project_path = _resolve_project_path(project_id)
    if project_path is None or not project_path.is_dir():
        return JSONResponse({"error": "Project not found"}, status_code=404)

    model = body.get("model", _svc_config.FALLBACK_MODEL)
    steering_ctx = get_steering_context(project_id)
    spec_ctx = get_spec_context(project_id)
    files_ctx = get_session_files_content(project_id)

    update_session(project_id, status="executing")

    async def stream():
        try:
            yield _sse_event({"type": "status", "message": f"Executing task {task_id}..."})

            ctx_parts = []
            if steering_ctx:
                ctx_parts.append(f"STEERING CONTEXT:\n{steering_ctx[:4000]}")
            if spec_ctx:
                ctx_parts.append(f"SPEC CONTEXT:\n{spec_ctx[:8000]}")
            if files_ctx:
                ctx_parts.append(f"EXISTING FILES:\n{files_ctx[:15000]}")

            prompt = (
                "You are implementing a specific task from a development plan.\n\n"
                + "\n\n".join(ctx_parts) + "\n\n"
                f"TASK TO IMPLEMENT: {task_id}\n\n"
                f"From the tasks spec, find task {task_id} and implement it completely.\n"
                "For EACH file you create or modify, use this EXACT format:\n"
                "=== FILE: path/to/file.ext ===\n<content>\n=== END FILE ===\n\n"
                "Include complete file content. Follow the design spec precisely."
            )

            content = ""
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=5.0, read=None, write=120.0, pool=5.0)
            ) as client:
                async with client.stream("POST", f"{_svc_config.OLLAMA}/api/chat", json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": True,
                    "options": {"temperature": 0.2, "num_predict": 8192, "num_ctx": 32768},
                }) as resp:
                    async for ln in resp.aiter_lines():
                        ln = ln.strip()
                        if not ln:
                            continue
                        try:
                            d = json.loads(ln)
                            tok = d.get("message", {}).get("content", "")
                            if tok:
                                content += tok
                                yield _sse_event({"type": "token", "text": tok})
                            if d.get("done"):
                                break
                        except json.JSONDecodeError:
                            continue

            files = _parse_code_files(content)
            generated_files = list(session.get("generated_files", []))

            for file_rel, file_content in files:
                if generated_files:
                    base_dir = str(Path(generated_files[0]).parent)
                    matched_path = f"{base_dir}/{file_rel}"
                else:
                    matched_path = f"output/code/{file_rel}"

                full_path = project_path / matched_path
                if full_path.exists():
                    try:
                        save_version(project_id, matched_path)
                    except Exception:
                        pass

                full_path.parent.mkdir(parents=True, exist_ok=True)
                full_path.write_text(file_content, encoding="utf-8")
                yield _sse_event({"type": "file", "path": matched_path, "size": len(file_content)})

                if matched_path not in generated_files:
                    generated_files.append(matched_path)

            update_session(project_id, generated_files=generated_files, status="active")
            mark_task_completed(project_id, task_id)

            yield _sse_event({"type": "task_complete", "task_id": task_id})
            yield _sse_event({"type": "done", "message": f"Task {task_id} completed", "files_count": len(files)})

        except Exception as exc:
            yield _sse_event({"type": "error", "error": str(exc)})

    return StreamingResponse(
        queued_sse_stream(stream()),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
