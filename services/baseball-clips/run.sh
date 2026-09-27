#!/usr/bin/env bash
# Run the baseball clips worker locally. The dev server reaches it via
# CLIPS_WORKER_URL=http://127.0.0.1:<port>/process. Never port 3000.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-$(node ../../scripts/free-port.js)}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found on PATH. Install: brew install ffmpeg" >&2
  exit 1
fi
if [ ! -x ".venv/bin/uvicorn" ]; then
  echo "venv missing. Run: python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

echo "baseball-clips worker → http://127.0.0.1:$PORT/process  (Ctrl-C to stop)"
exec ./.venv/bin/uvicorn server:app --host 127.0.0.1 --port "$PORT"
