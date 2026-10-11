# Clips Camera

The native capture companion to Baseball Clips: films an at-bat at 1080p/240fps,
logs each pitch with a tap, builds the finished quick version on the phone.
Plan: `docs/plans/2026-10-11-001-feat-clips-camera-app-plan.md`.

Phase 2: signs in with Google (Supabase, PKCE, `io.mason.clipscamera://auth-callback`
must be in Supabase's allowed redirect URLs), files at-bats under a kid + game,
uploads the finished edit on a background URLSession, then writes the game,
at-bat (`source = 'camera'`) and pitches into Clips. Needs migration 00199 in prod.

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
