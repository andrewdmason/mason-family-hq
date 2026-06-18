#!/usr/bin/env bash
# Run the practice-alignment worker locally. The dev server reaches it via
# PRACTICE_WORKER_URL (see .env.development.local). Port defaults to 8000.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8000}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found on PATH — needed to decode m4a/webm. Install: brew install ffmpeg" >&2
  exit 1
fi
if [ ! -x ".venv/bin/uvicorn" ]; then
  echo "venv missing. Run: python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

echo "practice-alignment worker → http://127.0.0.1:$PORT  (Ctrl-C to stop)"
exec ./.venv/bin/uvicorn server:app --host 127.0.0.1 --port "$PORT"
