# Clips Camera

The native capture companion to Baseball Clips: films an at-bat at 1080p/240fps,
logs each pitch with a tap, builds the finished quick version on the phone.
Plan: `docs/plans/2026-10-11-001-feat-clips-camera-app-plan.md`.

Phase 1 (this build) ends at Photos — no Clips upload yet.

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

The simulator has no camera. Launch with `-demo` (or `-demo -demoCountdown`) to
see the recording screen mid-at-bat for layout checks.

## Install on Andrew's phone

`scripts/install-on-phone.sh` builds, signs (team S4AV4J8F99, automatic) and
installs over the cable or Wi-Fi. The phone must be unlocked with Developer Mode on.

## Field test checklist (phase 1 exit)

- A full simulated game: 8+ at-bats over ~2 hours. Watch the thermometer in the
  bottom-left and the battery.
- "Built in Ns" in the at-bats list stays under ~20s.
- Replays look smooth; captions and counts are right; the result card matches.
- Turn on Settings › "Also save full recordings to Photos" for a few at-bats to
  check tap timing against the whole recording.
