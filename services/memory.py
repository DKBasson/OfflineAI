import json
import logging

from services.config import MEMORY_DIR

log = logging.getLogger("offlineai")

_MEMORY_FILE = MEMORY_DIR / "preferences.json"
if not _MEMORY_FILE.exists():
    _MEMORY_FILE.write_text("[]", encoding="utf-8")


def _load_memories() -> list[str]:
    try:
        data = json.loads(_MEMORY_FILE.read_text(encoding="utf-8"))
        return [str(m) for m in data if isinstance(m, str)]
    except Exception:
        return []


def _save_memories(memories: list[str]) -> None:
    _MEMORY_FILE.write_text(json.dumps(memories, indent=2, ensure_ascii=False), encoding="utf-8")


def _add_memory(text: str) -> None:
    memories = _load_memories()
    text = text.strip()
    if text and text not in memories:
        memories.append(text)
        _save_memories(memories)
        log.info("Memory added: %s", text[:80])


def _remove_memory(index: int) -> bool:
    memories = _load_memories()
    if 0 <= index < len(memories):
        removed = memories.pop(index)
        _save_memories(memories)
        log.info("Memory removed: %s", removed[:80])
        return True
    return False


def _get_memory_context() -> str:
    memories = _load_memories()
    if not memories:
        return ""
    lines = ["--- USER PREFERENCES (always follow these) ---"]
    for m in memories:
        lines.append(f"- {m}")
    lines.append("---")
    return "\n".join(lines)
