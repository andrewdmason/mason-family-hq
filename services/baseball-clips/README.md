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

A Clips Camera pitch reel exports the same way: its source is the reel (HEVC,
up to 240fps, so ¼-speed replays use every captured frame), and its GameChanger
field view follows as another source with no card and one segment whose
caption is empty — an empty caption draws nothing over the picture.

**trace** — a ball trail through an at-bat's GameChanger field view
(contract: `docs/clips-ball-trail.md`):
```json
{ "job": "trace", "atBatId": "uuid", "sourceUrl": "https://…signed…",
  "trimStart": 3.1, "trimEnd": 14.8, "tap": null }
```
Calls back `{status: "ready"|"needs_tap"|"failed", trail, tap}`. The vision is in
`balltrail/` (OpenCV + SciPy, CPU): skim the kept stretch for swings at home
plate (found where the foul lines meet), find and follow the ball after each
swing, calibrate the camera from the foul lines and far grass edge, fit a 3D
gravity+drag flight and fly it to the ground. ~10–30 s per clip on an M-series
Mac (most of it the skim; trimmed clips are faster).

Check it against the test clips on this Mac (nothing is uploaded):
```bash
./.venv/bin/python -m unittest tests/test_balltrail.py        # synthetic geometry, no video
./.venv/bin/python tests/trace_scorecard.py --out /tmp/trails  # scorecard + verification sheets
```

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
