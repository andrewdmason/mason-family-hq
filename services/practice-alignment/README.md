# practice-alignment worker (plan U6)

The DSP half of "listen and auto-log practice". Vercel never runs this — it calls
this service over HTTP. Given a recording + the active reference MIDIs, it returns
per-piece segments (piece, region, hands-separate, confidence).

## Contract

`POST /align`
```json
{ "recordingUrl": "https://…signed…", "references": [{ "pieceId": "uuid", "midiUrl": "https://…signed…" }] }
```
→
```json
{ "confidence": 0.81,
  "segments": [
    { "kind": "piece", "pieceId": "uuid", "region": "the coda",
      "tempoBpm": null, "handsSeparate": false, "repetitionCount": null,
      "startSec": 18.0, "endSec": 167.0, "confidence": 0.79 },
    { "kind": "free", "pieceId": null, "region": null, "startSec": 0, "endSec": 18, "confidence": 0.73 }
  ] }
```

## How it works
Windowed chroma + subsequence-DTW: the recording is cut into overlapping windows,
each matched against every reference (both-hands + per-hand templates); per-window
labels are smoothed and stitched into segments. Region comes from the most-confident
window's position in the reference. Lenient MIDI parsing (`midi.py`) because strict
parsers reject some real files.

## Validated (2026-06-18, against 5 real recordings)
Piece ID 4/4 correct incl. hands-separate + heavy repetition; scale → no-match (free);
loop → "the coda", chopin → "an early section", bach → "the opening". Region accurate.

## Known v1 limitations (deferred refinements)
- `tempoBpm` and `repetitionCount` are always null — the naive ref-span ratios were
  unreliable (relTempo up to 24×). Sound versions (local DTW-path slope; tight ref-
  center clustering) are TODO. The narrative leans on region + hands-separate, which
  are reliable.
- Scale/arpeggio segments are reported as generic `free` (no key/scale id yet) — that
  needs light monophonic pitch tracking (pyin), a follow-up.
- Synchronous request/response. Fine for short practice clips; for long sessions on
  Modal, switch to async + webhook callback.

## Run locally
```
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
brew install ffmpeg   # if not present
PORT=$(node ../../scripts/free-port.js)
./.venv/bin/uvicorn server:app --port "$PORT"
```

## Deploy (Modal, recommended)
CPU-only, scale-to-zero. Wrap `app` as a Modal ASGI app; set `WORKER_SECRET`. The
orchestration route calls the deployed URL with that secret.
