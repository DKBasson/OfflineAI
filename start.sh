#!/usr/bin/env zsh
set -e

SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR"

if [[ ! -f "$SCRIPT_DIR/.venv/bin/activate" ]]; then
  echo "✖ Virtual environment not found. Run ./install.sh first."
  exit 1
fi

: ${OFFLINEAI_HOST:=127.0.0.1}
: ${OFFLINEAI_PORT:=8080}
if [[ "$OFFLINEAI_HOST" == "0.0.0.0" || "$OFFLINEAI_HOST" == "::" ]]; then
  : ${OFFLINEAI_TOKEN:=$(python3 -c 'import secrets; print(secrets.token_urlsafe(18))')}
fi
export OFFLINEAI_HOST OFFLINEAI_PORT
[[ -n "${OFFLINEAI_TOKEN:-}" ]] && export OFFLINEAI_TOKEN

# ── Ollama ────────────────────────────────────────────────────────
if ! pgrep -x "ollama" > /dev/null 2>&1; then
  echo "▶ Starting Ollama..."
  ollama serve > /tmp/ollama.log 2>&1 &
  # Wait up to 5 s for it to be ready
  for i in {1..10}; do
    sleep 0.5
    curl -s http://localhost:11434/ > /dev/null 2>&1 && break
  done
  echo "✔ Ollama running"
else
  echo "✔ Ollama already running"
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

# Keep the script alive so Ctrl+C cleans up
trap "kill $APP_PID 2>/dev/null; echo 'Stopped.'" INT TERM
wait $APP_PID
