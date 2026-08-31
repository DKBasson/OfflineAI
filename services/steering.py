"""Steering document service.

Steering docs (product.md, tech.md, structure.md) provide persistent,
high-level project context that the AI can reference across every
conversation.  They live in ``<project>/.steering/`` and capture the
product vision, technology decisions, and codebase structure so the
model always has grounding context without re-scanning the project.
"""

import json
import logging
from pathlib import Path
from typing import Optional

import httpx

from services.config import PROJECTS_DIR, OLLAMA, FALLBACK_MODEL

log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────

STEERING_DIR = ".steering"
STEERING_DOCS = ["product.md", "tech.md", "structure.md"]

# ── Prompt templates ──────────────────────────────────────────────────

_PRODUCT_PROMPT = """\
You are a technical writer analysing a software project.  Using ONLY the
project context below, generate a **product.md** steering document.

{context}

Write the document with these sections (use Markdown headings):

## Product Overview
What the project does, who it is for, and its core value proposition.

## Key Features
Bullet list of the main features and capabilities.

## User Workflows
Describe the primary user workflows / use-cases (numbered list).

## Constraints
Known limitations, platform requirements, or design constraints.

Keep the document **under 500 words**.  Be concrete and specific —
reference actual file names, endpoints, and technologies from the
context.  Do NOT invent features that are not evidenced in the context.
Output ONLY the Markdown document, no preamble."""

_TECH_PROMPT = """\
You are a senior engineer documenting a software project.  Using ONLY
the project context below, generate a **tech.md** steering document.

{context}

Write the document with these sections (use Markdown headings):

## Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
(fill from context; leave Version blank if unknown)

## Patterns & Conventions
Describe the architectural patterns, naming conventions, and code
organisation used in the project.

## Development Standards
Build tools, test frameworks, linting, formatting, and CI practices.

## Dependencies
Key third-party libraries and why they are used.

Keep the document **under 500 words**.  Be concrete — reference actual
packages, config files, and directory names from the context.  Do NOT
invent technologies that are not evidenced in the context.
Output ONLY the Markdown document, no preamble."""

_STRUCTURE_PROMPT = """\
You are a software architect documenting a codebase.  Using ONLY the
project context below, generate a **structure.md** steering document.

{context}

Write the document with these sections (use Markdown headings):

## Architecture Overview
High-level description of the system architecture (e.g. client-server,
monolith, microservices) and how components interact.

## Directory Structure
A tree diagram showing the top-level directories and key files.

## Key Components
For each major component list:
- **Name** — what it is
- **Purpose** — what it does
- **Key files** — the most important source files

## Entry Points
How the application starts (scripts, main files, commands).

## Data Storage
Where and how data is persisted (databases, files, browser storage).

Keep the document **under 600 words**.  Be concrete — reference actual
paths and file names from the context.  Do NOT invent structure that is
not evidenced in the context.
Output ONLY the Markdown document, no preamble."""

_PROMPTS = {
    "product.md": _PRODUCT_PROMPT,
    "tech.md": _TECH_PROMPT,
    "structure.md": _STRUCTURE_PROMPT,
}

# ── Helpers ───────────────────────────────────────────────────────────


def _steering_dir(project_id: str) -> Path:
    """Return the .steering directory path for *project_id*."""
    return PROJECTS_DIR / project_id / STEERING_DIR


def list_steering_docs(project_id: str) -> list[dict]:
    """Return metadata for each ``.md`` file in the project's .steering/ dir.

    Each entry contains ``name``, ``size`` (bytes), and ``modified``
    (ISO-8601 timestamp).
    """
    sdir = _steering_dir(project_id)
    if not sdir.is_dir():
        return []
    results: list[dict] = []
    for p in sorted(sdir.glob("*.md")):
        stat = p.stat()
        results.append({
            "name": p.name,
            "size": stat.st_size,
            "modified": stat.st_mtime,
        })
    return results


def get_steering_doc(project_id: str, doc_name: str) -> Optional[str]:
    """Read and return the content of a steering document, or ``None``."""
    if doc_name not in STEERING_DOCS:
        return None
    path = _steering_dir(project_id) / doc_name
    if not path.is_file():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        log.exception("Failed to read steering doc %s/%s", project_id, doc_name)
        return None


def update_steering_doc(project_id: str, doc_name: str, content: str) -> bool:
    """Write *content* to a steering document, creating the directory if needed.

    Returns ``True`` on success, ``False`` on failure.
    """
    if doc_name not in STEERING_DOCS:
        return False
    sdir = _steering_dir(project_id)
    try:
        sdir.mkdir(parents=True, exist_ok=True)
        (sdir / doc_name).write_text(content, encoding="utf-8")
        return True
    except OSError:
        log.exception("Failed to write steering doc %s/%s", project_id, doc_name)
        return False


def get_steering_context(project_id: str, max_chars: int = 12000) -> str:
    """Concatenate all steering docs into a single context string.

    The output is prefixed with a ``--- PROJECT STEERING CONTEXT ---``
    header.  Content is truncated to *max_chars* (soft limit — never
    cuts mid-document, but stops adding documents once the budget is
    exceeded).
    """
    sdir = _steering_dir(project_id)
    if not sdir.is_dir():
        return ""

    parts: list[str] = ["--- PROJECT STEERING CONTEXT ---", ""]
    current_len = sum(len(p) for p in parts)

    for doc_name in STEERING_DOCS:
        path = sdir / doc_name
        if not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except OSError:
            continue
        section = f"### {doc_name}\n\n{content}\n"
        if current_len + len(section) > max_chars:
            # Truncate this section to fit within the budget
            remaining = max_chars - current_len
            if remaining > 100:  # Only include if meaningful space remains
                parts.append(section[:remaining] + "\n…(truncated)")
            break
        parts.append(section)
        current_len += len(section)

    # Return empty string if we only have the header
    if len(parts) <= 2:
        return ""
    return "\n".join(parts)


def has_steering(project_id: str) -> bool:
    """Return ``True`` if any of the three steering docs exist."""
    sdir = _steering_dir(project_id)
    if not sdir.is_dir():
        return False
    return any((sdir / name).is_file() for name in STEERING_DOCS)


def _build_project_context(
    project_id: str,
    scanned_files: list[dict] | None = None,
) -> str:
    """Build a context string from the project's knowledge and source files.

    If *scanned_files* is provided (list of dicts with ``path`` and
    ``content`` keys), those are used directly instead of scanning disk.
    Otherwise the function reads ``knowledge.json`` for the project name
    and description, then scans ``output/code/`` for source files (up to
    50 files, 2 000 chars each).
    """
    parts: list[str] = []

    # ── Project metadata from knowledge.json ──────────────────────────
    knowledge_file = PROJECTS_DIR / project_id / "knowledge.json"
    if knowledge_file.is_file():
        try:
            knowledge = json.loads(knowledge_file.read_text(encoding="utf-8"))
            name = knowledge.get("name", project_id)
            desc = knowledge.get("description", "")
            parts.append(f"Project: {name}")
            if desc:
                parts.append(f"Description: {desc}")
            parts.append("")
        except (OSError, json.JSONDecodeError):
            pass

    # ── Source files ──────────────────────────────────────────────────
    if scanned_files is not None:
        for entry in scanned_files[:50]:
            path = entry.get("path", "unknown")
            content = entry.get("content", "")[:2000]
            parts.append(f"--- {path} ---")
            parts.append(content)
            parts.append("")
    else:
        # Scan output/code directories for source files
        project_dir = PROJECTS_DIR / project_id
        scan_dirs = [
            project_dir / "output" / "code",
            project_dir / "output",
        ]
        seen: set[Path] = set()
        file_count = 0
        max_files = 50
        max_content = 2000

        # Common source extensions
        source_exts = {
            ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css",
            ".json", ".yaml", ".yml", ".toml", ".md", ".txt",
            ".sh", ".bat", ".sql", ".rs", ".go", ".java", ".c",
            ".cpp", ".h", ".hpp", ".rb", ".php", ".swift", ".kt",
        }

        for scan_dir in scan_dirs:
            if not scan_dir.is_dir():
                continue
            for p in sorted(scan_dir.rglob("*")):
                if file_count >= max_files:
                    break
                if not p.is_file():
                    continue
                if p in seen:
                    continue
                if p.suffix.lower() not in source_exts:
                    continue
                seen.add(p)
                try:
                    content = p.read_text(encoding="utf-8", errors="replace")[:max_content]
                    rel = p.relative_to(project_dir)
                    parts.append(f"--- {rel} ---")
                    parts.append(content)
                    parts.append("")
                    file_count += 1
                except OSError:
                    continue
            if file_count >= max_files:
                break

    return "\n".join(parts)


async def generate_steering_doc(
    project_id: str,
    doc_name: str,
    model: str = FALLBACK_MODEL,
    scanned_files: list[dict] | None = None,
):
    """Async generator that streams a steering document from Ollama.

    Yields string tokens as they arrive.  After the stream completes the
    full document is saved to ``.steering/<doc_name>``.
    """
    if doc_name not in _PROMPTS:
        raise ValueError(f"Unknown steering doc: {doc_name!r} (expected one of {STEERING_DOCS})")

    context = _build_project_context(project_id, scanned_files=scanned_files)
    prompt_template = _PROMPTS[doc_name]
    prompt = prompt_template.format(context=context)

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
        "options": {
            "temperature": 0.3,
            "num_predict": 2048,
            "num_ctx": 32768,
        },
    }

    collected: list[str] = []

    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
        async with client.stream("POST", f"{OLLAMA}/api/chat", json=payload) as resp:
            resp.raise_for_status()
            async for raw_line in resp.aiter_lines():
                if not raw_line.strip():
                    continue
                try:
                    chunk = json.loads(raw_line)
                except json.JSONDecodeError:
                    continue
                token = chunk.get("message", {}).get("content", "")
                if token:
                    collected.append(token)
                    yield token
                if chunk.get("done"):
                    break

    # Save the completed document
    full_content = "".join(collected)
    if full_content.strip():
        update_steering_doc(project_id, doc_name, full_content)
        log.info("Saved steering doc %s/%s (%d chars)", project_id, doc_name, len(full_content))
