import json
import re
import unicodedata
from pathlib import Path

from services.config import PROJECTS_DIR


def _slugify(text: str) -> str:
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii')
    text = re.sub(r'[^\w\s-]', '', text.lower())
    return re.sub(r'[-\s]+', '-', text).strip('-')


def _resolve_project_path(project_id: str, *parts: str) -> Path | None:
    """Resolve a path within a project directory, returning None if it escapes."""
    project_dir = PROJECTS_DIR / project_id
    if parts:
        target = (project_dir / Path(*parts)).resolve()
    else:
        target = project_dir.resolve()
    if not str(target).startswith(str(project_dir.resolve())):
        return None
    return target


def _get_project_knowledge_context(project_id: str, max_chars: int = 8000, query: str = "") -> str:
    """Load project knowledge and format as context for the LLM.
    
    If *query* is provided, uses FTS5 retrieval to find the most relevant
    knowledge. Falls back to the legacy truncation approach if the FTS
    index doesn't exist or the query is empty.
    """
    # Try FTS5 retrieval first (if query provided)
    if query:
        try:
            from services.knowledge_store import search, format_search_results
            results = search(project_id, query, limit=10)
            if results:
                return format_search_results(results, max_chars)
        except Exception:
            pass  # Fall through to legacy approach

    # Legacy approach: truncated dump from knowledge.json
    try:
        knowledge_file = PROJECTS_DIR / project_id / "knowledge.json"
        if not knowledge_file.exists():
            return ""
        knowledge = json.loads(knowledge_file.read_text(encoding="utf-8"))

        findings = knowledge.get("findings", [])
        sources = knowledge.get("sources", [])

        if not findings and not sources:
            return ""

        parts = []
        parts.append("--- PROJECT KNOWLEDGE BASE ---")
        parts.append(f"Project: {knowledge.get('name', project_id)}")
        parts.append("")

        if findings:
            parts.append("Key Findings:")
            for i, f in enumerate(findings[-10:], 1):
                parts.append(f"{i}. [{f.get('topic', 'Unknown')}] {f.get('summary', '')[:300]}")
            parts.append("")

        if sources:
            parts.append("Available Sources (use [N] to cite inline):")
            for i, s in enumerate(sources[-15:], 1):
                parts.append(f"[{i}] {s.get('title', 'Unknown')}: {s.get('url', '')}")

        parts.append("---")

        context = "\n".join(parts)
        return context[:max_chars]
    except Exception:
        return ""


def _parse_code_files(content: str) -> list[tuple[str, str]]:
    """Parse multi-file code output using === FILE: path === / === END FILE === markers."""
    files = []
    pattern = re.compile(
        r'===\s*FILE:\s*(.+?)\s*===\n(.*?)\n===\s*END\s*FILE\s*===',
        re.DOTALL,
    )
    for match in pattern.finditer(content):
        file_path = match.group(1).strip()
        file_content = match.group(2)
        if file_path and file_content is not None:
            files.append((file_path, file_content))
    return files


def _parse_workflow_plan(text: str) -> list[dict]:
    """Parse a JSON workflow plan from LLM output."""
    text = text.strip()
    if "```" in text:
        lines = text.split("\n")
        in_fence = False
        json_lines = []
        for line in lines:
            if line.strip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                json_lines.append(line)
        if json_lines:
            text = "\n".join(json_lines)

    start = text.find("[")
    end = text.rfind("]")
    if start >= 0 and end > start:
        text = text[start:end + 1]

    try:
        steps = json.loads(text)
        if isinstance(steps, list):
            valid_types = {"research", "document", "code", "data"}
            return [s for s in steps if isinstance(s, dict) and s.get("type") in valid_types]
    except (json.JSONDecodeError, ValueError):
        pass
    return []
