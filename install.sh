#!/usr/bin/env zsh
set -e

SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR"

MODEL="gemma4:e4b"

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

# ── 2. Python 3 ────────────────────────────────────────────────────
if ! command -v python3 > /dev/null 2>&1; then
  echo ""
  echo "▶ Installing Python 3..."
  brew install python3
  echo "✔ Python 3 installed"
else
  echo "✔ Python 3 found: $(python3 --version)"
fi

# ── 3. Virtual environment + Python deps ──────────────────────────
if [[ ! -d "$SCRIPT_DIR/.venv" ]]; then
  echo ""
  echo "▶ Creating virtual environment..."
  python3 -m venv "$SCRIPT_DIR/.venv"
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

# ── 4. Ollama ──────────────────────────────────────────────────────
if ! command -v ollama > /dev/null 2>&1; then
  echo ""
  echo "▶ Installing Ollama..."
  brew install ollama
  echo "✔ Ollama installed"
else
  echo "✔ Ollama already installed: $(ollama --version 2>/dev/null || echo 'version unknown')"
fi

# ── 5. Pull the model ──────────────────────────────────────────────
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

# Stop temporary Ollama instance if we started it
if [[ "$OLLAMA_WAS_STOPPED" == "true" ]]; then
  kill "$OLLAMA_PID" 2>/dev/null || true
fi

# ── 6. Vendor front-end assets (for offline use) ───────────────────
STATIC_DIR="$SCRIPT_DIR/static"
mkdir -p "$STATIC_DIR"

echo ""
echo "▶ Vendoring front-end assets..."
[[ ! -f "$STATIC_DIR/marked.min.js" ]]       && curl -fsSL "https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"                                            -o "$STATIC_DIR/marked.min.js"
[[ ! -f "$STATIC_DIR/dompurify.min.js" ]]    && curl -fsSL "https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"                                     -o "$STATIC_DIR/dompurify.min.js"
[[ ! -f "$STATIC_DIR/highlight.min.js" ]]    && curl -fsSL "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"                    -o "$STATIC_DIR/highlight.min.js"
[[ ! -f "$STATIC_DIR/github-dark.min.css" ]] && curl -fsSL "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css"          -o "$STATIC_DIR/github-dark.min.css"
echo "✔ Front-end assets ready"

# ── Done ───────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════"
echo "  ✔ Installation complete!"
echo "  Run the app with:  ./start.sh"
echo "══════════════════════════════════════════"
