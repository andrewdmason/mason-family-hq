# baseball-clips worker

The ffmpeg half of Baseball Clips (`/clips`). Vercel never runs this — the app
POSTs jobs to it and it calls back when done. CPU only; no GPU.

## Jobs

`POST /process` with the shared `WORKER_SECRET` in the body. Returns
`{"status":"accepted"}` at once; the job POSTs its result to `callbackUrl`
(`/clips/api/callback`).

**prepare** — after an at-bat's original lands in storage:
```json
{ "job": "prepare", "atBatId": "uuid", "sourceUrl": "https://…signed…",
  "playbackUpload": "https://…signed upload…", "playbackPath": "game/ab/playback.mp4",
  "posterUpload": "https://…signed upload…", "posterPath": "game/ab/poster.jpg" }
```
Probes the original (duration, frame rate, size, recorded-at), makes the playback
copy — 1080p H.264, a keyframe every ¼ second and no B-frames so any frame is a
few decodes away (instant scrubbing, frame-stepping, hold-to-play-backward) — and
a poster frame. iPhone HDR is tone-mapped to SDR. A 2¼-minute 4K/30 at-bat took
~13s on an M-series Mac and came out at 111MB (~6.5 Mbps).

**export** — a quick-version render (one at-bat, or a game reel):
```json
{ "job": "export", "exportId": "uuid", "upload": "https://…signed upload…", "path": "exports/uuid.mp4",
  "sources": [{ "card": "AB 1", "url": "https://…signed…",
                "segments": [{ "start": 13.66, "end": 16.66, "rate": 1, "muted": false, "caption": "Pitch 1 · Take" }] }] }
```
The segment list is built by the app (`src/lib/clips/plan.ts`), so the export
matches the player's quick mode. Each segment is rendered with identical encode
settings (1080p, captions drawn with Pillow and overlaid), then concatenated
without re-encoding. Sources are read over HTTP range requests — only the
seconds around each pitch are fetched. Slowed replays are muted.

## Run locally
```bash
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
./run.sh   # prints the URL; set CLIPS_WORKER_URL=http://127.0.0.1:<port>/process in .env.local
```
Without `CLIPS_WORKER_URL` the app still works: at-bats play from the original
(no playback copy, frame rate measured in the browser) and export is unavailable.

## Deploy (Modal)
```bash
./.venv/bin/pip install modal
./.venv/bin/modal deploy modal_app.py
```
Set the printed `process` URL as `CLIPS_WORKER_URL` in Vercel. It reuses the
practice worker's `practice-worker` Modal secret (same `WORKER_SECRET`).
