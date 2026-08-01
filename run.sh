#!/usr/bin/env bash
# Start the API and the UI. Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")"

PY_MIN="3.11"
API_PORT="${API_PORT:-8000}"
UI_PORT="${UI_PORT:-5173}"

have() { command -v "$1" >/dev/null 2>&1; }

# --- Python -----------------------------------------------------------------
if [ ! -d .venv ]; then
  PY=""
  for c in python3.13 python3.12 python3.11 python3; do
    if have "$c" && "$c" -c "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)" 2>/dev/null; then
      PY="$c"; break
    fi
  done
  if [ -z "$PY" ]; then
    echo "Need Python >= $PY_MIN. Install it (brew install python@3.13) and re-run." >&2
    exit 1
  fi
  echo "Creating .venv with $PY…"
  "$PY" -m venv .venv
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet -r requirements.txt
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from the template — add your free Gemini key to it."
fi

# --- Node -------------------------------------------------------------------
if ! have npm; then
  echo "Need Node.js and npm for the UI. Install from https://nodejs.org and re-run." >&2
  exit 1
fi
[ -d frontend/node_modules ] || (echo "Installing UI dependencies…"; cd frontend && npm install --silent)

# --- Run --------------------------------------------------------------------
cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

./.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port "$API_PORT" &
(cd frontend && npm run dev -- --port "$UI_PORT") &

sleep 2
echo
echo "  UI   http://localhost:$UI_PORT"
echo "  API  http://localhost:$API_PORT/docs"
echo
wait
