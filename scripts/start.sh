#!/usr/bin/env zsh
set -e

SCRIPT_DIR="${0:A:h:h}"
cd "$SCRIPT_DIR"

if [[ ! -f "$SCRIPT_DIR/.venv/bin/activate" ]]; then
  echo "✖ Virtual environment not found. Run ./scripts/install.sh first."
  exit 1
fi

: ${OFFLINEAI_PORT:=8080}
: ${OFFLINEAI_IMAGE_MAX_WIDTH:=1024}
: ${OFFLINEAI_IMAGE_MAX_HEIGHT:=1024}
: ${OFFLINEAI_IMAGE_MAX_STEPS:=16}
: ${OFFLINEAI_IMAGE_DEFAULT_WIDTH:=640}
: ${OFFLINEAI_IMAGE_DEFAULT_HEIGHT:=640}
: ${OFFLINEAI_IMAGE_DEFAULT_STEPS:=6}

# ── Network access prompt ─────────────────────────────────────────
if [[ -z "${OFFLINEAI_HOST:-}" ]]; then
  echo ""
  echo "  Allow network access?"
  echo "  Other devices on your LAN will be able to connect to OfflineAI."
  echo "  A secure token will be generated automatically when enabled."
  printf "  [y/N]: "
  read -r _NETWORK_REPLY
  if [[ "${_NETWORK_REPLY:-}" =~ ^[Yy]$ ]]; then
    OFFLINEAI_HOST="0.0.0.0"
    echo "  ✔ Network access enabled"
  else
    OFFLINEAI_HOST="127.0.0.1"
    echo "  ✔ Local-only access (default)"
  fi
  echo ""
fi

if [[ "$OFFLINEAI_HOST" == "0.0.0.0" || "$OFFLINEAI_HOST" == "::" ]]; then
  : ${OFFLINEAI_TOKEN:=$(python3 -c 'import secrets; print(secrets.token_urlsafe(18))')}
fi
export OFFLINEAI_HOST OFFLINEAI_PORT
export OFFLINEAI_IMAGE_MAX_WIDTH OFFLINEAI_IMAGE_MAX_HEIGHT OFFLINEAI_IMAGE_MAX_STEPS
export OFFLINEAI_IMAGE_DEFAULT_WIDTH OFFLINEAI_IMAGE_DEFAULT_HEIGHT OFFLINEAI_IMAGE_DEFAULT_STEPS
[[ -n "${OFFLINEAI_TOKEN:-}" ]] && export OFFLINEAI_TOKEN
unset _NETWORK_REPLY

# ── Cleanup trap (Ctrl+C / SIGTERM) ──────────────────────────────
_OLLAMA_STARTED=false
_cleanup() {
  echo ""
  echo "▶ Stopping OfflineAI..."
  [[ -n "${APP_PID:-}" ]] && kill "$APP_PID" 2>/dev/null && wait "$APP_PID" 2>/dev/null
  if [[ "$_OLLAMA_STARTED" == true ]]; then
    ollama stop 2>/dev/null || pkill -x ollama 2>/dev/null || true
  fi
  echo "✔ Stopped"
  exit 0
}
trap '_cleanup' INT TERM

# ── Ollama ────────────────────────────────────────────────────────
if ! pgrep -x "ollama" > /dev/null 2>&1; then
  echo "▶ Starting Ollama..."
  ollama serve > /tmp/ollama.log 2>&1 &
  _OLLAMA_STARTED=true
  # Wait up to 5 s for it to be ready
  for i in {1..10}; do
    sleep 0.5
    curl -s http://localhost:11434/ > /dev/null 2>&1 && break
  done
  echo "✔ Ollama running"
else
  echo "✔ Ollama already running"
fi

# ── Build React UI ────────────────────────────────────────────────
if [[ -d "$SCRIPT_DIR/react-app/node_modules" ]]; then
  echo "▶ Building UI..."
  (cd "$SCRIPT_DIR/react-app" && npm run build) && echo "✔ UI built" || echo "⚠ UI build failed — using existing build"
else
  echo "⚠ Skipping UI build (react-app/node_modules missing — run install.sh first)"
fi

# ── FastAPI app ────────────────────────────────────────────────────
echo "▶ Starting OfflineAI..."
source "$SCRIPT_DIR/.venv/bin/activate"
python "$SCRIPT_DIR/app.py" &
APP_PID=$!

# Wait for the server to be ready (up to 5 s)
for i in {1..10}; do
  sleep 0.5
  curl -s "http://127.0.0.1:${OFFLINEAI_PORT}/" > /dev/null 2>&1 && break
done

echo "✔ App running"
echo "   Audio transcription · Word/ODF docs · Code files · Images (vision models)"
LOCAL_URL="http://127.0.0.1:${OFFLINEAI_PORT}"
[[ -n "${OFFLINEAI_TOKEN:-}" ]] && LOCAL_URL="${LOCAL_URL}?token=${OFFLINEAI_TOKEN}"
echo "   Local:   ${LOCAL_URL}"
if [[ "$OFFLINEAI_HOST" == "0.0.0.0" || "$OFFLINEAI_HOST" == "::" ]]; then
  # Resolve LAN IP (UDP trick; no payload is sent)
  LAN_IP=$(python -c "
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.connect(('8.8.8.8', 80))
print(s.getsockname()[0])
s.close()
" 2>/dev/null || echo "127.0.0.1")
  NETWORK_URL="http://${LAN_IP}:${OFFLINEAI_PORT}"
  [[ -n "${OFFLINEAI_TOKEN:-}" ]] && NETWORK_URL="${NETWORK_URL}?token=${OFFLINEAI_TOKEN}"
  echo "   Network: ${NETWORK_URL}"
  [[ -n "${OFFLINEAI_TOKEN:-}" ]] && echo "   Token:   ${OFFLINEAI_TOKEN}"
else
  echo "   Network: disabled (set OFFLINEAI_HOST=0.0.0.0 to expose)"
fi

if command -v open > /dev/null 2>&1; then
  open "$LOCAL_URL"
elif command -v xdg-open > /dev/null 2>&1; then
  xdg-open "$LOCAL_URL" > /dev/null 2>&1 || true
fi

echo "   Press Ctrl+C to stop."
wait $APP_PID
