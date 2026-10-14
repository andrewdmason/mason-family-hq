# Clips Camera ball trail

A flame/neon/vapor trail that follows a batted ball through the GameChanger
"field view" of a Clips Camera at-bat, from contact to where it lands — drawn
live in the phone's player and burned into phone shares. Phone only: the
website neither draws nor exports trails.

Prototype + test notes: `prototypes/ball-trail/` (Python/OpenCV). Sample
trails in the format below: `prototypes/ball-trail/fixtures/{cardinals,falcon}.json`
(source clips: `~/Desktop/Sebastian double Cardinals Game 1.mov`,
`~/Downloads/Double @ Falcon Prospects 13U.mp4`).

## Pipeline

1. The phone attaches a field view (existing `attachFieldView` / `finalize`),
   then calls `POST /clips/api/trace` with the user's Supabase access token.
2. That route marks the at-bat `ball_trail_status = 'pending'`, signs a download
   URL for `field_view_path`, and posts a `trace` job to the baseball-clips worker.
3. The worker finds contact and the ball, follows it while visible, calibrates
   the camera from the field (home plate, bases, rubber, foul lines), fits a 3D
   gravity+drag flight to the visible part and integrates it to the ground. It
   calls back with the trail JSON, or `needs_tap` when it isn't confident.
4. The callback writes `ball_trail` / `ball_trail_status`. The phone reads them
   with the rest of the at-bat on its next refresh (and polls briefly while
   `pending` if the at-bat is open).
5. "Fix the ball": the phone calls the same route with a `tap` (the ball on one
   frame); the worker re-runs anchored to it.

## Database (`clip_at_bats`)

| column | type | meaning |
|---|---|---|
| `ball_trail` | jsonb, null | the trail (below) — null until traced |
| `ball_trail_status` | text, null | `pending` · `ready` · `needs_tap` · `failed` · null (never traced) |
| `ball_trail_tap` | jsonb, null | last tap `{t, x, y}` (clip seconds, normalized) — kept so re-traces stay anchored |

## Trace route

`POST /clips/api/trace` — `Authorization: Bearer <supabase access token>`
(signed-in users only; watch-only viewers can't trace).

```json
{ "atBatId": "uuid", "tap": { "t": 5.47, "x": 0.474, "y": 0.474 } }   // tap optional
```
→ `202 {"status":"pending"}`. A tap is in **clip time** (seconds into the
untrimmed GameChanger file) and **frame-normalized** coordinates (0–1 of that
frame's width/height, origin top-left).

## Worker job

```json
{ "job": "trace", "atBatId": "uuid", "sourceUrl": "https://…signed…",
  "trimStart": 3.1, "trimEnd": 14.8, "tap": null }
```
Callback: `{ "job":"trace", "atBatId", "status":"ready"|"needs_tap"|"failed", "trail": {…}|null, "error"?: "…" }`.

## Trail JSON (version 1)

```json
{
  "version": 1,
  "source": "auto",                     // "auto" | "tap"
  "clip": { "fps": 29.797, "width": 1280, "height": 720 },
  "contactS": 5.336,                    // clip seconds
  "landS": 6.846,                       // clip seconds the ball reaches the ground (or leaves the picture)
  "landed": true,                       // false: ball left the frame / ends in the air — draw to the end and fade
  "confidence": 0.9,                    // 0–1
  "points": [[t, x, y], …],             // ball position, one per source frame, contact → land.
                                        // x,y in REFERENCE-normalized coords (see frames)
  "frames": [[t, h11, h12, h13, h21, h22, h23, h31, h32, h33], …],
                                        // one per source frame from contact to land + 1s: a homography
                                        // mapping reference-normalized → that frame's normalized coords
  "stats": { "exitMph": 67, "launchDeg": 14, "carryFt": 132 }   // optional
}
```

Why a reference frame: GameChanger cameras pan to follow runners, so the
trail's tail (where the ball *was*) must be re-projected into the *current*
frame each frame. Points live in one fixed reference frame; to draw at clip time
`t`, take the `frames` entry nearest `t` (or interpolate), map every trail point
through that homography, and draw in the frame's normalized space (then scale to
the video's displayed rect). Outside the `frames` range, use the nearest entry.

All times are **untrimmed clip time**. The player/renderer converts from its own
timeline using the field view's `field_view_start_s` (as it already does for
playback).

## Drawing (phone)

- The head is the ball's position at `t` (interpolate `points`; clamp to `landS`).
- The tail covers the last ~0.5 s / a style-specific screen length behind the head.
- After `landS` the tail drains into the landing spot over ~0.4 s, then nothing.
- Before `contactS`: nothing.
- One drawing path serves both the live player (overlay on the field view's
  player layer, driven by its current time) and share export (the field-view
  compositor's per-frame overlay), so what you watch is what you post.

### Styles (v1: Neon, Vapor, Broadcast)

Reference renders: `prototypes/ball-trail/styles.py` (`draw_neon`,
`draw_contrail`, `draw_broadcast`). All lengths below are at 1280 px wide —
scale by displayed width / 1280.

- **Neon** — electric-blue streak: tail ~150 px or 15 frames, width tapering
  from ~10 px at the head to ~2 px, color (BGR 255,200,40 → fading 75% toward
  the tail), white-hot core on the front 55%, plus a soft glow (two blurs, σ≈4
  and ≈14 px, added on top).
- **Vapor** — white contrail: puffs emitted 3 per frame along the path, each
  growing (radius 2.5 + 0.75·age px), drifting up slightly and fading out over
  ~24 frames; blurred (σ≈2.5 px) and alpha-composited in near-white (≈248).
- **Broadcast** — crisp TV tracer: ~4.5 px red line (BGR 40,40,225) with a thin
  white core, alpha fading toward the tail (tail ~220 px or 16 frames), and a
  white ring (r≈8 px) around the ball while in flight. No glow.

Later styles (Lightning, Strobe, Smoke, Shockwave, Ribbon, Ice, Speed lines)
are also in `styles.py`.

## Product decisions (Andrew, 2026-10-14)

- Trail appears automatically; no extra step at import.
- Player: a trail button next to Share opens a panel — style picker (live
  preview), trail on/off, "Fix the ball".
- When tracing isn't confident: a "Tap the ball to add a trail" banner over the
  field view and a badge on the at-bat card; one tap → the fix screen (field view
  paused near contact, "Tap the ball").
- Share: one more switch, **Ball trail** (on by default), in the share options
  sheet — shown only when the at-bat has a ready trail and the chosen content
  includes the GameChanger part.
- No long-press card menu entry.
- Signature style per kid (Settings) comes later; v1 remembers the last style
  chosen on the phone.
