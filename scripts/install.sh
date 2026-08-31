#!/usr/bin/env zsh
set -e

SCRIPT_DIR="${0:A:h:h}"
cd "$SCRIPT_DIR"

MODEL="gemma4:e4b"
IMAGE_MODEL="x/z-image-turbo"  # Legacy Ollama model; image generation now uses Diffusers (stabilityai/stable-diffusion-xl-turbo) — this pull is kept for backwards compatibility

echo "══════════════════════════════════════════"
echo "  OfflineAI — Installer"
echo "══════════════════════════════════════════"

# ── 1. Homebrew (needed for Python fallback) ───────────────────────
if ! command -v brew > /dev/null 2>&1; then
  echo ""
  echo "▶ Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for Apple Silicon
  [[ -f /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
  echo "✔ Homebrew installed"
else
  echo "✔ Homebrew already installed"
fi

# ── 2. Python 3.10+ ────────────────────────────────────────────────
pick_python() {
  for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" > /dev/null 2>&1 && "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' > /dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

if ! PYTHON_BIN="$(pick_python)"; then
  echo ""
  echo "▶ Installing Python 3.10+..."
  brew install python3
  if ! PYTHON_BIN="$(pick_python)"; then
    echo "✖ Python 3.10+ is required but was not found after install."
    exit 1
  fi
fi
echo "✔ Python found: $("$PYTHON_BIN" --version) ($PYTHON_BIN)"

# ── 3. Virtual environment + Python deps ──────────────────────────
if [[ ! -d "$SCRIPT_DIR/.venv" ]]; then
  echo ""
  echo "▶ Creating virtual environment..."
  "$PYTHON_BIN" -m venv "$SCRIPT_DIR/.venv"
  echo "✔ Virtual environment created"
else
  echo "✔ Virtual environment already exists"
fi

echo ""
echo "▶ Installing Python dependencies..."
source "$SCRIPT_DIR/.venv/bin/activate"
pip install -q --upgrade pip
pip install -q -r "$SCRIPT_DIR/requirements.txt"
echo "✔ Python dependencies installed"

# ── 4. Pre-download Whisper model (audio transcription) ────────────
echo ""
echo "▶ Pre-downloading Whisper 'tiny' model for audio transcription (~75 MB)..."
python -c "
try:
    from faster_whisper import WhisperModel
    WhisperModel('tiny', device='cpu', compute_type='int8')
    print('✔ Whisper model ready')
except Exception as e:
    print('  Skipped — will download automatically on first audio upload (' + str(e) + ')')
"

# ── 5. Ollama ──────────────────────────────────────────────────────
if ! command -v ollama > /dev/null 2>&1; then
  echo ""
  echo "▶ Installing Ollama..."
  brew install ollama
  echo "✔ Ollama installed"
else
  echo "✔ Ollama already installed: $(ollama --version 2>/dev/null || echo 'version unknown')"
fi

# ── 6. Pull the model ──────────────────────────────────────────────
echo ""
echo "▶ Checking for model: $MODEL"

# Ollama must be running to query models — start it temporarily if needed
OLLAMA_WAS_STOPPED=false
if ! pgrep -x "ollama" > /dev/null 2>&1; then
  ollama serve > /tmp/ollama_install.log 2>&1 &
  OLLAMA_PID=$!
  OLLAMA_WAS_STOPPED=true
  # Wait for Ollama to be ready
  for i in {1..20}; do
    sleep 0.5
    curl -s http://localhost:11434/ > /dev/null 2>&1 && break
  done
fi

if ollama list 2>/dev/null | grep -q "^${MODEL}"; then
  echo "✔ Model '$MODEL' already downloaded"
else
  echo "  Downloading '$MODEL' — this may take a few minutes..."
  ollama pull "$MODEL"
  echo "✔ Model '$MODEL' ready"
fi

# ── 7. Pull the image generation model ───────────────────────────
echo ""
echo "▶ Checking for image generation model: $IMAGE_MODEL"
echo "  (~5 GB download — press Ctrl+C to skip, then pull later with: ollama pull $IMAGE_MODEL)"

if ollama list 2>/dev/null | grep -q "^${IMAGE_MODEL}"; then
  echo "✔ Model '$IMAGE_MODEL' already downloaded"
else
  if ollama pull "$IMAGE_MODEL"; then
    echo "✔ Model '$IMAGE_MODEL' ready"
  else
    echo "  Skipped — run 'ollama pull $IMAGE_MODEL' later to enable image generation"
  fi
fi

# Stop temporary Ollama instance if we started it
if [[ "$OLLAMA_WAS_STOPPED" == "true" ]]; then
  kill "$OLLAMA_PID" 2>/dev/null || true
fi

# ── 8. Vendor front-end assets (for offline use) ───────────────────
STATIC_DIR="$SCRIPT_DIR/static"
mkdir -p "$STATIC_DIR"

echo ""
echo "▶ Vendoring front-end assets..."

download_asset() {
  local file="$1"
  local url="$2"
  local expected="$3"
  [[ -f "$file" ]] || curl -fsSL "$url" -o "$file"
  local actual
  actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    rm -f "$file"
    echo "✖ Checksum mismatch for $(basename "$file")"
    echo "  Expected: $expected"
    echo "  Actual:   $actual"
    exit 1
  fi
}

download_asset "$STATIC_DIR/marked.min.js"       "https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"                                   "15fabce5b65898b32b03f5ed25e9f891a729ad4c0d6d877110a7744aa847a894"
download_asset "$STATIC_DIR/dompurify.min.js"    "https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"                            "ef9a98b5b21aac33c73e316ef21f5cf06f68eff003a40ac953022129112cff3c"
download_asset "$STATIC_DIR/highlight.min.js"    "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"           "837a6fa5b0c736b52bbde2b2b6190f305da3fc9ed41681db5321507057b5c846"
download_asset "$STATIC_DIR/github-dark.min.css" "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" "9f208d022102b1d0c7aebfecd8e42ca7997d5de636649d2b31ea63093d809019"
echo "✔ Front-end assets ready"

# ── Done ───────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  ✔ Installation complete!"
echo "  Run the app with:  ./scripts/start.sh"
echo ""
echo "  Features enabled:"
echo "    • Chat with local AI models via Ollama"
echo "    • Image generation (ask to draw/generate an image)"
echo "    • Audio transcription (.mp3 .wav .opus .m4a …)"
echo "    • Document reading (.docx .odt .ods .odp)"
echo "    • Code & text file attachments"
echo ""
echo "  On first start you will be asked whether to allow"
echo "  network access (LAN). You can also pre-set it by"
echo "  running:  OFFLINEAI_HOST=0.0.0.0 ./scripts/start.sh"
echo "══════════════════════════════════════════"
