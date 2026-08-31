import json
import os
import platform
import re
import subprocess
from pathlib import Path

from fastapi import Request

from services.config import (
    LOOPBACK_HOSTS,
    AUTH_TOKEN,
    IMAGE_GEN_MAX_WIDTH,
    IMAGE_GEN_MAX_HEIGHT,
    IMAGE_GEN_MAX_STEPS,
    IMAGE_GEN_DEFAULT_WIDTH,
    IMAGE_GEN_DEFAULT_HEIGHT,
    IMAGE_GEN_DEFAULT_STEPS,
)


def _get_system_memory() -> tuple[float, float]:
    """Return (total_gb, available_gb) using OS-native methods. No psutil needed."""
    total_gb = 0.0
    avail_gb = 0.0
    system = platform.system()
    try:
        if system == "Darwin":
            raw = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True).strip()
            total_bytes = int(raw)
            total_gb = round(total_bytes / (1024 ** 3), 1)
            vm = subprocess.check_output(["vm_stat"], text=True)
            page_size = 4096
            ps_match = re.search(r"page size of (\d+) bytes", vm)
            if ps_match:
                page_size = int(ps_match.group(1))
            free = int(re.search(r"Pages free:\s+(\d+)", vm).group(1)) if re.search(r"Pages free:\s+(\d+)", vm) else 0
            inactive = int(re.search(r"Pages inactive:\s+(\d+)", vm).group(1)) if re.search(r"Pages inactive:\s+(\d+)", vm) else 0
            avail_gb = round((free + inactive) * page_size / (1024 ** 3), 1)
        elif system == "Linux":
            with open("/proc/meminfo") as f:
                meminfo = f.read()
            mt = re.search(r"MemTotal:\s+(\d+)\s+kB", meminfo)
            ma = re.search(r"MemAvailable:\s+(\d+)\s+kB", meminfo)
            if mt:
                total_gb = round(int(mt.group(1)) / (1024 ** 2), 1)
            if ma:
                avail_gb = round(int(ma.group(1)) / (1024 ** 2), 1)
        else:
            total_gb = round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / (1024 ** 3), 1) if hasattr(os, "sysconf") else 0
    except Exception:
        pass
    return total_gb, avail_gb


def _dir_size_mb(path: Path) -> float:
    """Return directory size in MB."""
    total = 0
    try:
        for f in path.rglob("*"):
            if f.is_file():
                total += f.stat().st_size
    except Exception:
        pass
    return round(total / (1024 * 1024), 1)


def _is_loopback_request(request: Request) -> bool:
    client_host = request.client.host if request.client else ""
    return client_host in LOOPBACK_HOSTS or client_host == "::ffff:127.0.0.1"


def _runtime_control_allowed(request: Request) -> bool:
    if _is_loopback_request(request):
        return True
    supplied = request.headers.get("x-offlineai-token") or request.query_params.get("token")
    return bool(AUTH_TOKEN and supplied == AUTH_TOKEN)


def _clamp_int(value, minimum: int, maximum: int, fallback: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = fallback
    return max(minimum, min(maximum, n))


def _apply_image_generation_caps(body: dict) -> dict:
    capped = dict(body or {})
    capped["width"] = _clamp_int(capped.get("width"), 256, IMAGE_GEN_MAX_WIDTH, IMAGE_GEN_DEFAULT_WIDTH)
    capped["height"] = _clamp_int(capped.get("height"), 256, IMAGE_GEN_MAX_HEIGHT, IMAGE_GEN_DEFAULT_HEIGHT)
    capped["steps"] = _clamp_int(capped.get("steps"), 2, IMAGE_GEN_MAX_STEPS, IMAGE_GEN_DEFAULT_STEPS)
    return capped


# ── Shared CSS for PDF and HTML exports ──────────────────────────────

_PDF_CSS = """
@page { size: A4; margin: 2.5cm; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif; font-size: 11pt; line-height: 1.7; color: #1a1a1a; }
h1 { font-size: 22pt; border-bottom: 2px solid #333; padding-bottom: 8px; margin-top: 0; margin-bottom: 16px; }
h2 { font-size: 16pt; border-bottom: 1px solid #ccc; padding-bottom: 6px; margin-top: 28px; color: #2c3e50; }
h3 { font-size: 13pt; margin-top: 20px; color: #34495e; }
p { margin: 8px 0; text-align: justify; }
ul, ol { margin: 8px 0; padding-left: 24px; }
li { margin: 4px 0; }
code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; font-size: 0.88em; font-family: 'SF Mono', 'Fira Code', Menlo, monospace; }
pre { background: #f8f8f8; padding: 14px 18px; border-radius: 6px; overflow-x: auto; border: 1px solid #e8e8e8; font-size: 0.85em; line-height: 1.5; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 0.92em; }
th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
th { background: #f0f0f0; font-weight: 600; }
tr:nth-child(even) { background: #fafafa; }
blockquote { border-left: 4px solid #3498db; margin: 14px 0; padding: 10px 18px; color: #555; background: #f9fbfd; border-radius: 0 4px 4px 0; }
a { color: #2980b9; text-decoration: none; }
hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
""".strip()


def _sse_event(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _ndjson_error(message: str) -> bytes:
    return (json.dumps({"error": message}) + "\n").encode()
