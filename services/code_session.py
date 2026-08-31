"""
Code session service for OfflineAI.

Manages interactive coding workflows:
  1. Plan phase: AI asks clarifying questions, optionally searches the web,
     then generates a Markdown plan document.
  2. Generate phase: AI generates multi-file code from the plan.
  3. Edit phase: User requests changes in the main chat; AI modifies files
     and returns a change summary.

Sessions are persisted to the project directory as `.code_session.json`
so they survive server restarts.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from services.config import PROJECTS_DIR

log = logging.getLogger("offlineai.code_session")

SESSION_FILE = ".code_session.json"


def _session_path(project_id: str) -> Path:
    return PROJECTS_DIR / project_id / SESSION_FILE


def get_session(project_id: str) -> Optional[dict]:
    """Load the active code session for a project, or None."""
    path = _session_path(project_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def create_session(project_id: str, description: str) -> dict:
    """Create a new code session for a project."""
    session = {
        "id": str(uuid.uuid4())[:8],
        "project_id": project_id,
        "description": description,
        "status": "planning",  # planning | requirements | requirements_review | design | design_review | tasks | tasks_review | ready | executing | generating | active | closed
        "plan_md": "",
        "clarification_questions": [],
        "clarification_answers": [],
        "generated_files": [],
        "edit_history": [],
        "conversation": [],  # [{role, content}] for context continuity
        "spec_phase": "requirements",  # requirements | requirements_review | design | design_review | tasks | tasks_review | ready | executing
        "requirements_md": "",
        "design_md": "",
        "tasks_md": "",
        "tasks_completed": [],
        "hooks": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_session(project_id, session)
    log.info("Code session created: %s for project %s", session["id"], project_id)
    return session


def update_session(project_id: str, **updates) -> Optional[dict]:
    """Update fields on the active session."""
    session = get_session(project_id)
    if not session:
        return None
    session.update(updates)
    session["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_session(project_id, session)
    return session


def add_conversation_message(project_id: str, role: str, content: str) -> None:
    """Append a message to the session's conversation history."""
    session = get_session(project_id)
    if not session:
        return
    session.setdefault("conversation", []).append({
        "role": role,
        "content": content,
    })
    # Keep last 20 messages to avoid context overflow
    if len(session["conversation"]) > 20:
        log.warning("Code session conversation truncated to 20 messages for project %s (was %d)", project_id, len(session["conversation"]))
        session["conversation"] = session["conversation"][-20:]
    session["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_session(project_id, session)


def add_edit_record(project_id: str, instruction: str, changes: list[dict], summary: str) -> None:
    """Record an edit operation in the session history."""
    session = get_session(project_id)
    if not session:
        return
    session.setdefault("edit_history", []).append({
        "instruction": instruction,
        "changes": changes,  # [{file, action: "modified"|"created"|"deleted"}]
        "summary": summary,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    session["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_session(project_id, session)


def close_session(project_id: str) -> None:
    """Mark the session as closed."""
    update_session(project_id, status="closed")


def get_current_spec_phase(project_id: str) -> Optional[str]:
    """Return the current spec phase, or None if no session."""
    session = get_session(project_id)
    return session.get('spec_phase') if session else None


def approve_phase(project_id: str) -> Optional[dict]:
    """Advance to the next spec phase after user approval."""
    session = get_session(project_id)
    if not session:
        return None
    transitions = {
        'requirements_review': ('design', 'design'),
        'design_review': ('tasks', 'tasks'),
        'tasks_review': ('ready', 'ready'),
    }
    current = session.get('spec_phase', '')
    if current not in transitions:
        return None
    next_phase, next_status = transitions[current]
    return update_session(project_id, spec_phase=next_phase, status=next_status)


def get_spec_context(project_id: str) -> str:
    """Return all approved spec documents concatenated as context."""
    session = get_session(project_id)
    if not session:
        return ''
    parts = []
    if session.get('requirements_md'):
        parts.append(f'--- REQUIREMENTS ---\n{session["requirements_md"]}')
    if session.get('design_md'):
        parts.append(f'--- DESIGN ---\n{session["design_md"]}')
    if session.get('tasks_md'):
        parts.append(f'--- TASKS ---\n{session["tasks_md"]}')
    return '\n\n'.join(parts)


def mark_task_completed(project_id: str, task_id: str) -> None:
    """Mark a task as completed in the session."""
    session = get_session(project_id)
    if not session:
        return
    completed = session.get('tasks_completed', [])
    if task_id not in completed:
        completed.append(task_id)
        update_session(project_id, tasks_completed=completed)
        log.info('Task %s marked completed in project %s', task_id, project_id)


def save_spec_file(project_id: str, doc_name: str, content: str) -> None:
    """Save a spec document to the specs directory."""
    session = get_session(project_id)
    if not session:
        return
    spec_dir = PROJECTS_DIR / project_id / 'specs' / session['id']
    spec_dir.mkdir(parents=True, exist_ok=True)
    (spec_dir / doc_name).write_text(content, encoding='utf-8')
    log.info('Spec file saved: %s/%s/%s', project_id, session['id'], doc_name)


def delete_session(project_id: str) -> None:
    """Delete the session file."""
    path = _session_path(project_id)
    path.unlink(missing_ok=True)


def get_session_files_content(project_id: str, max_chars_per_file: int = 4000) -> str:
    """Read all generated files and format them as context for the LLM."""
    session = get_session(project_id)
    if not session or not session.get("generated_files"):
        return ""

    parts = []
    for file_path in session["generated_files"]:
        full_path = PROJECTS_DIR / project_id / file_path
        if full_path.is_file():
            try:
                content = full_path.read_text(encoding="utf-8")[:max_chars_per_file]
                parts.append(f"=== FILE: {file_path} ===\n{content}\n=== END FILE ===")
            except Exception:
                continue

    return "\n\n".join(parts)


def _save_session(project_id: str, session: dict) -> None:
    """Write the session to disk."""
    path = _session_path(project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(session, indent=2, ensure_ascii=False), encoding="utf-8")
