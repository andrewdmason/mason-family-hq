# Clips Camera

The native capture companion to Baseball Clips: films an at-bat at 1080p/240fps,
logs each pitch with a tap, builds the finished quick version on the phone.
Plan: `docs/plans/2026-10-11-001-feat-clips-camera-app-plan.md`.

Phase 2: signs in with Google (Supabase, PKCE, `io.mason.clipscamera://auth-callback`
must be in Supabase's allowed redirect URLs), files at-bats under a kid + game,
uploads the finished edit on a background URLSession, then writes the game,
at-bat (`source = 'camera'`) and pitches into Clips. Needs migration 00199 in prod.

## Watch-only (no sign-in)

Released builds open without a sign-in: anyone not signed in (a coach on
TestFlight) sees the kids' at-bats and can play and share them, but can't film,
start games, relabel, add field views or delete. Those reads go through
family.mason.io/clips/api/viewer, authorized by a viewer key generated in the
database (migration 00203, never in the repo); `scripts/release.sh` reads it
with the service role and builds it in as `CLIPS_VIEWER_KEY`. Family members
tap "Sign in" for everything else. Builds without the key (Xcode, the install
script) still show the sign-in screen. To cut off watch-only, give the row a
new key and release: `UPDATE clips_viewer_keys SET key = DEFAULT`. Simulator
against a local server: build with `CLIPS_VIEWER_KEY=<local key>` and launch
with `-viewerAPI http://localhost:PORT/clips/api/viewer`.

## GameChanger field view

A GameChanger clip (the wide stream camera's look at the whole play) can go on
the end of an at-bat, or be an at-bat on its own (title card + clip, outcome
only). It comes in through the share sheet ("Baseball Clips", the `ClipsShare`
extension, which drops the file in the `group.io.mason.clipscamera` Inbox and
opens `io.mason.clipscamera://import`), the + menu (Photos), or an at-bat's
press-and-hold menu. Trim → pick the at-bat → the phone renders one finished
video (close-up, ½s cross-dissolve, field view at real speed with its sound)
and uploads it with the untrimmed clip and the close-up, so "Trim field view"
works any time. Columns: migration 00201 (`field_view_*`, `closeup_path`).

Simulator check: `-demoHome -demoImport /path/clip.mp4` opens the trimmer on a
clip; add `-demoPick` for the at-bat picker.
`-demoHome -demoReel /path/video.mp4` opens the live at-bat player on that video
(cut into three made-up pitch windows); add `-demoLandscape` to turn it sideways.

## Title cards

A shared video opens on a card in the kid's look: their full name big, the
result (or a badge per at-bat on a highlight reel) and the opponent and date
beneath, their headshot cut out with a white outline, over the swing playing at
¼ speed through contact (the ball in play, else the last foul; a walk gets a
graphic). Each kid picks one of 8 themes (two colors and a typeface, bundled in
`ClipsCamera/Fonts`, all SIL OFL) and a headshot in Settings › Title cards; the
phone cuts the person out (Vision). Both are kept in Clips at
`kids/{kid id}/card.json` and `kids/{kid id}/headshot-*.png` in the clips
bucket, so every family phone makes the same card; watch-only phones get the
default. When the at-bat has no vertical framing, the batter is found as what
moves most over the swing. Snapshot every theme with
`TitleCardTests` (`CARD_HEADSHOT`, `CARD_SWING`, `CARD_REEL` + `CARD_TAP` draw
real ones; pass them as `TEST_RUNNER_…`).

## Build & test (agents)

```sh
cd ios/ClipsCamera
xcodegen generate                      # project is generated, not committed
xcodebuild -project ClipsCamera.xcodeproj -scheme ClipsCamera \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/dd test
```

The renderer test builds a real edit from a generated 240fps clip (about a
minute on the simulator). Create `/tmp/clipscamera-snapshots` first to get PNGs
of a caption frame, a replay frame and the result card.

The simulator has no camera or sign-in. Launch with `-demoHome` to see the home
screen with made-up games, or `-demo` (`-demo -demoCountdown`) with the camera
open for the recording screen mid-at-bat.

## Install on Andrew's phone

`scripts/install-on-phone.sh` builds, signs (team S4AV4J8F99, automatic) and
installs over the cable or Wi-Fi. The phone must be unlocked with Developer Mode on.

## Releasing

`scripts/release.sh` archives one Release build (build number = release time)
and ships it two ways:

- **TestFlight** (Andrew): uploaded to App Store Connect, app "Baseball Clips".
- **Install link** (Sebastian — under 13, so no TestFlight): an ad hoc export
  published to the public `app-builds` bucket with an install manifest;
  family.mason.io/clips/install links to the latest. Ad hoc builds install only
  on iPhones registered on the developer account — plug a new phone in and
  build for it once (`scripts/install-on-phone.sh` with `PHONE=<udid>`) to
  register it, then release again so the ad hoc profile includes it.

`--adhoc-only` skips TestFlight. The icon is drawn by `scripts/make-icon.swift`.

## Field test checklist (phase 1 exit)

- A full simulated game: 8+ at-bats over ~2 hours. Watch the thermometer in the
  bottom-left and the battery.
- "Built in Ns" in the at-bats list stays under ~20s.
- Replays look smooth; captions and counts are right; the result card matches.
- Turn on Settings › "Also save full recordings to Photos" for a few at-bats to
  check tap timing against the whole recording.
