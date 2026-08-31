import os
import time
from pathlib import Path

# ── Ollama & Network ──────────────────────────────────────────────────

OLLAMA = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
HOST = os.environ.get("OFFLINEAI_HOST", "127.0.0.1")
PORT = int(os.environ.get("OFFLINEAI_PORT", "8080"))
AUTH_TOKEN = os.environ.get("OFFLINEAI_TOKEN", "").strip()
LAN_MODE = HOST in {"0.0.0.0", "::"}
AUTH_REQUIRED = LAN_MODE and bool(AUTH_TOKEN)
LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}
MAX_BODY = 50 * 1024 * 1024
FALLBACK_MODEL = "gemma4:e4b"

# ── Paths ─────────────────────────────────────────────────────────────

_BASE = Path(__file__).resolve().parent.parent
STATIC_DIR = _BASE / "static"
_REACT_DIST = _BASE / "react-dist"
_REACT_MODE = _REACT_DIST.is_dir() and (_REACT_DIST / "index.html").is_file()

# ── Image generation caps ─────────────────────────────────────────────

IMAGE_GEN_MAX_WIDTH = int(os.environ.get("OFFLINEAI_IMAGE_MAX_WIDTH", "1024"))
IMAGE_GEN_MAX_HEIGHT = int(os.environ.get("OFFLINEAI_IMAGE_MAX_HEIGHT", "1024"))
IMAGE_GEN_MAX_STEPS = int(os.environ.get("OFFLINEAI_IMAGE_MAX_STEPS", "16"))
IMAGE_GEN_DEFAULT_WIDTH = int(os.environ.get("OFFLINEAI_IMAGE_DEFAULT_WIDTH", "640"))
IMAGE_GEN_DEFAULT_HEIGHT = int(os.environ.get("OFFLINEAI_IMAGE_DEFAULT_HEIGHT", "640"))
IMAGE_GEN_DEFAULT_STEPS = int(os.environ.get("OFFLINEAI_IMAGE_DEFAULT_STEPS", "6"))

# ── Token stats ───────────────────────────────────────────────────────

_TOKEN_STATS_FILE = _BASE / "token_stats.json"
_MAX_TOKEN_STATS_ENTRIES = int(os.environ.get("OFFLINEAI_MAX_TOKEN_ENTRIES", "500"))

# ── Data directories ──────────────────────────────────────────────────

PROJECTS_DIR = Path.home() / "OfflineAI-Projects"
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

PLUGINS_DIR = Path.home() / "OfflineAI-Plugins"
PLUGINS_DIR.mkdir(parents=True, exist_ok=True)
(PLUGINS_DIR / "tools").mkdir(exist_ok=True)
(PLUGINS_DIR / "logs").mkdir(exist_ok=True)

MEMORY_DIR = Path.home() / "OfflineAI-Memory"
MEMORY_DIR.mkdir(parents=True, exist_ok=True)

# ── Server start time ────────────────────────────────────────────────

_SERVER_START_TIME = time.time()
