"""
Event-driven automation hooks for OfflineAI projects.

Hooks are automations that trigger on project events (file saves, creation,
deletion, task completion) or on manual invocation.  Each hook carries a
natural-language instruction that is compiled into an optimised system prompt
via the LLM.  When a matching event fires, the hook executes a non-streaming
LLM call with its system prompt and the trigger context as the user message.
"""

import json
import logging
import uuid
import fnmatch
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

from services.config import PROJECTS_DIR, OLLAMA, FALLBACK_MODEL

# ── Constants ─────────────────────────────────────────────────────────

HOOKS_FILE = ".hooks/hooks.json"

EVENT_TYPES = [
    "file_saved",
    "file_created",
    "file_deleted",
    "task_completed",
    "manual",
]

log = logging.getLogger(__name__)

# ── Path helper ───────────────────────────────────────────────────────


def _hooks_path(project_id: str) -> Path:
    """Return the path to a project's hooks JSON file."""
    return PROJECTS_DIR / project_id / HOOKS_FILE


# ── Persistence ───────────────────────────────────────────────────────


def load_hooks(project_id: str) -> list[dict]:
    """Load all hooks for a project.  Returns [] if the file is missing."""
    path = _hooks_path(project_id)
    if not path.is_file():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        log.warning("Failed to load hooks for project %s: %s", project_id, exc)
        return []


def save_hooks(project_id: str, hooks: list[dict]) -> None:
    """Persist hooks to disk, creating parent directories as needed."""
    path = _hooks_path(project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(hooks, indent=2, ensure_ascii=False), encoding="utf-8")


# ── CRUD ──────────────────────────────────────────────────────────────


async def create_hook(
    project_id: str,
    name: str,
    event_type: str,
    file_pattern: str,
    instructions: str,
    model: str | None = None,
) -> dict:
    """Create a new hook, generate its system prompt via the LLM, and save."""
    model = model or FALLBACK_MODEL
    system_prompt = await generate_system_prompt(instructions, model)

    hook: dict = {
        "id": uuid.uuid4().hex[:8],
        "name": name,
        "event_type": event_type,
        "file_pattern": file_pattern,
        "instructions": instructions,
        "system_prompt": system_prompt,
        "enabled": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "runs": [],
    }

    hooks = load_hooks(project_id)
    hooks.append(hook)
    save_hooks(project_id, hooks)
    return hook


def get_hook(project_id: str, hook_id: str) -> Optional[dict]:
    """Return a single hook by ID, or None."""
    for hook in load_hooks(project_id):
        if hook["id"] == hook_id:
            return hook
    return None


def update_hook(project_id: str, hook_id: str, **updates) -> Optional[dict]:
    """Update fields on an existing hook.  Returns the updated hook or None."""
    hooks = load_hooks(project_id)
    for hook in hooks:
        if hook["id"] == hook_id:
            hook.update(updates)
            save_hooks(project_id, hooks)
            return hook
    return None


def delete_hook(project_id: str, hook_id: str) -> bool:
    """Delete a hook by ID.  Returns True if found and removed."""
    hooks = load_hooks(project_id)
    original_len = len(hooks)
    hooks = [h for h in hooks if h["id"] != hook_id]
    if len(hooks) == original_len:
        return False
    save_hooks(project_id, hooks)
    return True


def toggle_hook(project_id: str, hook_id: str) -> Optional[dict]:
    """Flip a hook's enabled flag.  Returns the updated hook or None."""
    hooks = load_hooks(project_id)
    for hook in hooks:
        if hook["id"] == hook_id:
            hook["enabled"] = not hook["enabled"]
            save_hooks(project_id, hooks)
            return hook
    return None


# ── Evaluation ────────────────────────────────────────────────────────


def evaluate_hooks(
    project_id: str,
    event_type: str,
    file_path: str | None = None,
) -> list[dict]:
    """Return enabled hooks whose event_type matches.

    For file-related events (file_saved, file_created, file_deleted), only
    hooks whose ``file_pattern`` matches the given *file_path* via
    :func:`fnmatch.fnmatch` are returned.
    """
    file_events = {"file_saved", "file_created", "file_deleted"}
    matched: list[dict] = []

    for hook in load_hooks(project_id):
        if not hook.get("enabled", True):
            continue
        if hook["event_type"] != event_type:
            continue
        if event_type in file_events and file_path:
            if not fnmatch.fnmatch(file_path, hook.get("file_pattern", "*")):
                continue
        matched.append(hook)

    return matched


# ── Execution ─────────────────────────────────────────────────────────


async def execute_hook(
    project_id: str,
    hook_id: str,
    trigger_context: str,
    model: str | None = None,
) -> dict:
    """Execute a hook against the LLM and record the run.

    Returns ``{success: bool, result: str, duration_ms: int}``.
    """
    hook = get_hook(project_id, hook_id)
    if hook is None:
        return {"success": False, "result": "Hook not found", "duration_ms": 0}

    model = model or FALLBACK_MODEL
    start = time.perf_counter()

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(f"{OLLAMA}/api/chat", json={
                "model": model,
                "messages": [
                    {"role": "system", "content": hook["system_prompt"]},
                    {"role": "user", "content": trigger_context},
                ],
                "stream": False,
            })
            data = resp.json()
            result = data.get("message", {}).get("content", "")
            success = True
    except Exception as exc:
        log.error("Hook %s execution failed: %s", hook_id, exc)
        result = str(exc)
        success = False

    duration_ms = int((time.perf_counter() - start) * 1000)

    # Record run (keep last 10)
    run_record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "trigger": trigger_context[:200],
        "success": success,
        "duration_ms": duration_ms,
    }

    hooks = load_hooks(project_id)
    for h in hooks:
        if h["id"] == hook_id:
            h.setdefault("runs", []).append(run_record)
            h["runs"] = h["runs"][-10:]
            break
    save_hooks(project_id, hooks)

    return {"success": success, "result": result, "duration_ms": duration_ms}


# ── Prompt generation ─────────────────────────────────────────────────


async def generate_system_prompt(instructions: str, model: str) -> str:
    """Ask the LLM to convert natural-language instructions into a focused
    system prompt suitable for an automation hook.

    Falls back to the raw instructions if the LLM call fails.
    """
    meta_prompt = (
        "You are an expert prompt engineer.  The user will give you a natural-language "
        "description of what an automation hook should do.  Convert it into a concise, "
        "focused system prompt that an LLM can follow precisely.  Return ONLY the system "
        "prompt text — no explanation, no markdown fences, no preamble."
    )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{OLLAMA}/api/chat", json={
                "model": model,
                "messages": [
                    {"role": "system", "content": meta_prompt},
                    {"role": "user", "content": instructions},
                ],
                "stream": False,
                "options": {"temperature": 0.4, "num_predict": 1024},
            })
            data = resp.json()
            prompt = data.get("message", {}).get("content", "").strip()
            return prompt or instructions
    except Exception as exc:
        log.warning("System-prompt generation failed, using raw instructions: %s", exc)
        return instructions
