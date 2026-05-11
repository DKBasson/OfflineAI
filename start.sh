#!/usr/bin/env zsh
set -e

SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR"

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
python3 "$SCRIPT_DIR/app.py" &
APP_PID=$!

# Wait for the server to be ready (up to 5 s)
for i in {1..10}; do
  sleep 0.5
  curl -s http://127.0.0.1:8080/ > /dev/null 2>&1 && break
done

# Resolve LAN IP (UDP trick — no data sent)
LAN_IP=$(python3 -c "
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.connect(('8.8.8.8', 80))
print(s.getsockname()[0])
s.close()
" 2>/dev/null || echo "127.0.0.1")
echo "✔ App running"
echo "   Local:   http://127.0.0.1:8080"
echo "   Network: http://${LAN_IP}:8080"

open "http://127.0.0.1:8080"

echo "   Press Ctrl+C to stop."

# Keep the script alive so Ctrl+C cleans up
trap "kill $APP_PID 2>/dev/null; echo 'Stopped.'" INT TERM
wait $APP_PID
