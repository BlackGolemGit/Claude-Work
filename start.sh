#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "════════════════════════════════════════"
echo "  Offline LLM Server"
echo "════════════════════════════════════════"

# 1. Check .env
if [ ! -f .env ]; then
  echo ""
  echo "ERROR: .env file not found."
  echo "  cp .env.example .env && nano .env"
  echo "  (Set SECRET_KEY and ADMIN_PASSWORD at minimum)"
  exit 1
fi

source .env

# 2. Check Ollama binary
if ! command -v ollama &>/dev/null; then
  echo ""
  echo "ERROR: 'ollama' not found. Install it with:"
  echo "  curl -fsSL https://ollama.com/install.sh | sh"
  exit 1
fi

# 3. Start Ollama if not running
if ! curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
  echo "Starting Ollama server..."
  ollama serve &
  OLLAMA_PID=$!
  echo "  PID: $OLLAMA_PID"
  # Wait for Ollama to be ready
  for i in {1..15}; do
    if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
      echo "  Ollama ready."
      break
    fi
    sleep 1
  done
fi

# 4. Pull default model if missing
MODEL="${DEFAULT_MODEL:-llama3.2:3b-instruct-q4_K_M}"
if ! ollama list 2>/dev/null | grep -q "^${MODEL}"; then
  echo ""
  echo "Pulling model: $MODEL"
  echo "  (this may take several minutes on first run)"
  ollama pull "$MODEL"
fi

# 5. Create data directories
mkdir -p data/uploads data/vectordb

# 6. Start server
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
echo ""
echo "Starting server..."
echo "  Client UI:  http://${HOST}:${PORT}/"
echo "  Admin UI:   http://${HOST}:${PORT}/admin/"
echo "  API docs:   http://${HOST}:${PORT}/docs"
echo ""
echo "  LAN address: http://$(hostname -I | awk '{print $1}'):${PORT}/"
echo ""

exec python3 -m uvicorn backend.main:app \
  --host "$HOST" \
  --port "$PORT" \
  --workers 1 \
  --loop uvloop \
  --log-level info
