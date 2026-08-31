import asyncio
import json
import platform
import tempfile
import zipfile as _zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

import services.config as _svc_config
from services.config import (
    PROJECTS_DIR,
    PLUGINS_DIR,
    MEMORY_DIR,
    _TOKEN_STATS_FILE,
)
from services.system import _runtime_control_allowed
from services.tokens import _token_stats, _save_token_stats
from services.memory import _load_memories, _save_memories
from services.tools import _load_tool_registry, _save_tool_registry

router = APIRouter()


def _add_dir_to_zip(zf: _zipfile.ZipFile, directory: Path, archive_prefix: str) -> int:
    """Recursively add a directory to a zip file. Returns number of files added."""
    count = 0
    if not directory.is_dir():
        return count
    for fp in sorted(directory.rglob("*")):
        if fp.is_file():
            arcname = f"{archive_prefix}/{fp.relative_to(directory)}"
            zf.write(fp, arcname)
            count += 1
    return count


@router.get("/api/export-archive")
async def export_archive(request: Request):
    """Create a ZIP archive of all user data for portability."""
    if not _runtime_control_allowed(request):
        return JSONResponse(
            {"error": "Export requires localhost access or a valid LAN token."},
            status_code=403,
        )

    def _build_archive() -> str:
        tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        tmp.close()
        with _zipfile.ZipFile(tmp.name, "w", _zipfile.ZIP_DEFLATED) as zf:
            # Projects
            projects_count = _add_dir_to_zip(zf, _svc_config.PROJECTS_DIR, "projects")

            # Plugins
            plugins_count = _add_dir_to_zip(zf, _svc_config.PLUGINS_DIR, "plugins")

            # Memory
            memory_count = _add_dir_to_zip(zf, _svc_config.MEMORY_DIR, "memory")

            # Token stats
            token_stats_count = 0
            if _svc_config._TOKEN_STATS_FILE.exists():
                zf.write(_svc_config._TOKEN_STATS_FILE, "token_stats.json")
                token_stats_count = 1

            # Manifest
            manifest = {
                "version": "1.0",
                "app": "OfflineAI",
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "platform": platform.system(),
                "contents": {
                    "projects_files": projects_count,
                    "plugins_files": plugins_count,
                    "memory_files": memory_count,
                    "token_stats": token_stats_count > 0,
                },
            }
            zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        return tmp.name

    zip_path = await asyncio.to_thread(_build_archive)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"OfflineAI-backup-{timestamp}.zip"

    async def _stream_and_cleanup():
        try:
            with open(zip_path, "rb") as f:
                while True:
                    chunk = f.read(65536)
                    if not chunk:
                        break
                    yield chunk
        finally:
            Path(zip_path).unlink(missing_ok=True)

    return StreamingResponse(
        _stream_and_cleanup(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/api/import-archive")
async def import_archive(request: Request, file: UploadFile = File(...)):
    """Import a ZIP archive, merging data without overwriting existing entries."""
    if not _runtime_control_allowed(request):
        return JSONResponse(
            {"error": "Import requires localhost access or a valid LAN token."},
            status_code=403,
        )

    content = await file.read()
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp.write(content)
    tmp.close()

    def _do_import() -> dict:
        summary: dict = {
            "projects_imported": 0,
            "projects_skipped": 0,
            "plugins_imported": 0,
            "memory_merged": 0,
            "token_stats_merged": False,
            "errors": [],
        }
        try:
            with _zipfile.ZipFile(tmp.name, "r") as zf:
                # Validate manifest
                if "manifest.json" not in zf.namelist():
                    summary["errors"].append("Missing manifest.json — not a valid OfflineAI archive.")
                    return summary
                try:
                    manifest = json.loads(zf.read("manifest.json"))
                    if manifest.get("app") != "OfflineAI":
                        summary["errors"].append("Archive is not from OfflineAI.")
                        return summary
                except (json.JSONDecodeError, KeyError) as exc:
                    summary["errors"].append(f"Invalid manifest: {exc}")
                    return summary

                names = zf.namelist()

                # Import projects (merge, don't overwrite)
                skipped_projects: set = set()
                for name in names:
                    if name.startswith("projects/") and not name.endswith("/"):
                        rel = name[len("projects/"):]
                        target = _svc_config.PROJECTS_DIR / rel
                        # Security: prevent path traversal
                        try:
                            target.resolve().relative_to(_svc_config.PROJECTS_DIR.resolve())
                        except ValueError:
                            continue
                        if target.exists():
                            # Check if this is a new project directory
                            parts = Path(rel).parts
                            if len(parts) >= 1:
                                project_dir = _svc_config.PROJECTS_DIR / parts[0]
                                if project_dir.exists():
                                    skipped_projects.add(parts[0])
                                    continue
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(zf.read(name))
                        summary["projects_imported"] += 1
                summary["projects_skipped"] = len(skipped_projects)

                # Import plugins (merge registry)
                for name in names:
                    if name.startswith("plugins/") and not name.endswith("/"):
                        rel = name[len("plugins/"):]
                        target = _svc_config.PLUGINS_DIR / rel
                        try:
                            target.resolve().relative_to(_svc_config.PLUGINS_DIR.resolve())
                        except ValueError:
                            continue
                        if rel == "registry.json":
                            # Merge registries
                            try:
                                incoming_reg = json.loads(zf.read(name))
                                existing_reg = _load_tool_registry()
                                existing_names = {t["name"] for t in existing_reg}
                                added = 0
                                for tool in incoming_reg:
                                    if tool.get("name") and tool["name"] not in existing_names:
                                        existing_reg.append(tool)
                                        added += 1
                                _save_tool_registry(existing_reg)
                                summary["plugins_imported"] += added
                            except Exception as exc:
                                summary["errors"].append(f"Plugin registry merge error: {exc}")
                        else:
                            # Copy tool module files if not existing
                            if not target.exists():
                                target.parent.mkdir(parents=True, exist_ok=True)
                                target.write_bytes(zf.read(name))

                # Import memory (merge)
                for name in names:
                    if name.startswith("memory/") and not name.endswith("/"):
                        rel = name[len("memory/"):]
                        if rel == "preferences.json":
                            try:
                                incoming_mems = json.loads(zf.read(name))
                                existing_mems = _load_memories()
                                existing_set = set(existing_mems)
                                added = 0
                                for m in incoming_mems:
                                    if isinstance(m, str) and m.strip() and m not in existing_set:
                                        existing_mems.append(m)
                                        existing_set.add(m)
                                        added += 1
                                _save_memories(existing_mems)
                                summary["memory_merged"] = added
                            except Exception as exc:
                                summary["errors"].append(f"Memory merge error: {exc}")
                        else:
                            target = _svc_config.MEMORY_DIR / rel
                            try:
                                target.resolve().relative_to(_svc_config.MEMORY_DIR.resolve())
                            except ValueError:
                                continue
                            if not target.exists():
                                target.parent.mkdir(parents=True, exist_ok=True)
                                target.write_bytes(zf.read(name))

                # Import token stats (merge)
                if "token_stats.json" in names:
                    try:
                        incoming_stats = json.loads(zf.read("token_stats.json"))
                        for model_key, counts in incoming_stats.items():
                            if isinstance(counts, list) and len(counts) == 2:
                                if model_key in _token_stats:
                                    _token_stats[model_key][0] += counts[0]
                                    _token_stats[model_key][1] += counts[1]
                                else:
                                    _token_stats[model_key] = list(counts)
                        _save_token_stats()
                        summary["token_stats_merged"] = True
                    except Exception as exc:
                        summary["errors"].append(f"Token stats merge error: {exc}")
        finally:
            Path(tmp.name).unlink(missing_ok=True)

        return summary

    result = await asyncio.to_thread(_do_import)
    has_errors = bool(result.get("errors"))
    return JSONResponse(result, status_code=207 if has_errors else 200)
