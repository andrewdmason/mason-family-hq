# MasonOS

The family apps, native. One app with a sidebar for switching between them
(swipe in from the left edge, or the menu button), like the website on a phone.
Plan: `docs/plans/2026-10-15-001-feat-masonos-ios-app-plan.md`.

v1 is Andrew's only: a placeholder **Home** and the **Practice Log** quick
logger. Everything else about practice is set up on the website.

## Practice Log

The website's quick log (`src/lib/practice/quick-log.ts`): a card per active
piece, tap to start timing it, tap again to stop, tap another piece to switch.
The rules are ported in `MasonOS/Practice/QuickLog.swift`; keep the two in step.

- The timer runs on the phone and writes what the website writes to
  `practice_tasks` (`started_at` on start, `timer_remaining_seconds` and
  `ended_at` on stop). The website doesn't see a timer running on the phone
  until it stops.
- Writes queue on disk and go when there's signal, oldest first.
- A Live Activity shows the run and today's total on the Lock Screen and in the
  Dynamic Island, with a Stop button (`StopPracticeIntent`, run in the app's
  process).
- A timer stops itself an hour after the last interaction (a tap, or opening
  the app), logged as stopping at that hour. The Live Activity's clocks stop
  there too; the stop is written the next time the app runs.

Practice shows only for the owner (`family_members.role = 'owner'`), as on the
website.

## One-time setup

- `io.mason.masonos://auth-callback` in Supabase › Authentication › URL
  Configuration › Redirect URLs (Google sign-in returns there).
- The MasonOS app record in App Store Connect (bundle id `io.mason.masonos`)
  before the first TestFlight upload.

## Build & test

```sh
cd ios/MasonOS
xcodegen generate                      # project is generated, not committed
xcodebuild -project MasonOS.xcodeproj -scheme MasonOS \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/dd test
```

CI runs the same on every change under `ios/MasonOS`
(`.github/workflows/ios-masonos.yml`).

## Install

- `scripts/install-on-phone.sh`: builds, signs (team S4AV4J8F99, automatic) and
  installs on Andrew's iPhone over the cable or Wi-Fi.
- `scripts/release.sh`: uploads a build to TestFlight.
