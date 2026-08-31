"""Artifact version history for project files.

Stores up to 5 historical versions of each file under a hidden
``.versions/`` directory within the project folder.
"""

import logging
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from services.config import PROJECTS_DIR
from services.projects import _resolve_project_path

log = logging.getLogger("offlineai")

MAX_VERSIONS = 5


def _versions_dir(project_id: str, file_path: str) -> Path | None:
    """Return the ``.versions/`` sub-directory for *file_path*, or ``None``
    if the path escapes the project root."""
    project_dir = _resolve_project_path(project_id)
    if project_dir is None:
        return None
    return project_dir / ".versions" / file_path


def _version_pattern(versions_dir: Path) -> list[tuple[int, Path]]:
    """Return sorted list of ``(version_number, path)`` for existing versions."""
    if not versions_dir.is_dir():
        return []
    results: list[tuple[int, Path]] = []
    for entry in versions_dir.iterdir():
        m = re.match(r"^\.v(\d+)$", entry.suffix)
        if m and entry.is_file():
            # File is like  <original_name>.v3
            results.append((int(m.group(1)), entry))
            continue
        # Also handle names stored as  <stem>.v<N>  (no extra extension)
        m2 = re.search(r"\.v(\d+)$", entry.name)
        if m2 and entry.is_file():
            results.append((int(m2.group(1)), entry))
    # deduplicate by version number, keep first
    seen: set[int] = set()
    unique: list[tuple[int, Path]] = []
    for ver, p in sorted(results):
        if ver not in seen:
            seen.add(ver)
            unique.append((ver, p))
    return unique


def _next_version(existing: list[tuple[int, Path]]) -> int:
    if not existing:
        return 1
    return existing[-1][0] + 1


def save_version(project_id: str, file_path: str) -> int | None:
    """Save the current content of *file_path* as a new version.

    Returns the version number created, or ``None`` if the source file
    does not exist.
    """
    source = _resolve_project_path(project_id, file_path)
    if source is None or not source.is_file():
        return None

    ver_dir = _versions_dir(project_id, file_path)
    if ver_dir is None:
        return None
    ver_dir.mkdir(parents=True, exist_ok=True)

    existing = _version_pattern(ver_dir)
    version = _next_version(existing)

    # The version file name is  <original_filename>.v<N>
    dest = ver_dir / f"{Path(file_path).name}.v{version}"
    shutil.copy2(str(source), str(dest))

    # Prune oldest if over limit
    existing.append((version, dest))
    while len(existing) > MAX_VERSIONS:
        _, oldest_path = existing.pop(0)
        try:
            oldest_path.unlink(missing_ok=True)
        except OSError:
            pass

    log.info("Saved version %d for %s in project %s", version, file_path, project_id)
    return version


def list_versions(project_id: str, file_path: str) -> list[dict]:
    """Return metadata for all stored versions of *file_path*."""
    ver_dir = _versions_dir(project_id, file_path)
    if ver_dir is None:
        return []
    existing = _version_pattern(ver_dir)
    result = []
    for ver, path in existing:
        stat = path.stat()
        result.append({
            "version": ver,
            "size": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        })
    return result


def get_version(project_id: str, file_path: str, version: int) -> str | None:
    """Return the text content of version *version*, or ``None``."""
    ver_dir = _versions_dir(project_id, file_path)
    if ver_dir is None:
        return None
    existing = _version_pattern(ver_dir)
    for ver, path in existing:
        if ver == version:
            try:
                return path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                return None
    return None


def restore_version(project_id: str, file_path: str, version: int) -> bool:
    """Restore version *version* to the main file path.

    The current file content is saved as a new version first so no data
    is lost. Returns ``True`` on success.
    """
    content = get_version(project_id, file_path, version)
    if content is None:
        return False

    target = _resolve_project_path(project_id, file_path)
    if target is None:
        return False

    # Save current content as a new version before overwriting
    if target.is_file():
        save_version(project_id, file_path)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    log.info("Restored version %d for %s in project %s", version, file_path, project_id)
    return True
