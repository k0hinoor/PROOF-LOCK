#!/usr/bin/env bash
# ProofLock launcher for macOS and Linux. Same steps as start-windows.bat.
set -euo pipefail
cd "$(dirname "$0")"

echo
echo " ==============================================="
echo "  ProofLock - local machine console"
echo " ==============================================="
echo

if [ ! -x ".venv/bin/python" ]; then
  echo "[1/4] Creating the Python environment (one time only)..."
  python3 -m venv .venv
  echo "[2/4] Installing backend packages..."
  .venv/bin/python -m pip install --upgrade pip >/dev/null
  .venv/bin/python -m pip install -r backend/requirements.txt
else
  echo "[1/4] Python environment found."
  echo "[2/4] Backend packages already installed."
fi

command -v npm >/dev/null 2>&1 || {
  echo "ERROR: Node.js 22 was not found. Install it from https://nodejs.org/"
  exit 1
}

if [ ! -d "frontend/node_modules" ]; then
  echo "[3/4] Installing frontend packages (one time only, may take a minute)..."
  npm --prefix frontend ci
else
  echo "[3/4] Frontend packages found."
fi

echo "[4/4] Building the console..."
npm --prefix frontend run build

if [ ! -f "config/operators.json" ]; then
  cp config/operators.example.json config/operators.json
  echo
  echo " NOTE: config/operators.json was created from the example file."
  echo "       Edit it to match the OP-nn references in your Arduino sketch."
fi

echo
echo " ==============================================="
echo "  Starting on http://127.0.0.1:8000"
echo "  Press Ctrl+C to stop."
echo " ==============================================="
echo

# Open the browser only when one is available and a desktop session exists.
if command -v xdg-open >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  (sleep 2 && xdg-open http://127.0.0.1:8000 >/dev/null 2>&1) &
elif command -v open >/dev/null 2>&1; then
  (sleep 2 && open http://127.0.0.1:8000 >/dev/null 2>&1) &
fi

# One worker only: the serial port and the session live in this process.
exec .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
