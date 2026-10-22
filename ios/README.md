# Family apps for iOS

The family apps, native. One app per job, the way the website installs as
separate home-screen apps: **Practice** now, Calendar and others later. They
all come from one XcodeGen project (`project.yml`) and share
`Packages/MasonKit`:

- `Config`: the family Supabase, the website, and each app's sign-in redirect
  (`<bundle id>://auth-callback`).
- `Session`: one Google sign-in, the same account as family.mason.io. It's kept
  in the keychain group every app shares (`io.mason.shared`), so signing in to
  one app signs in to all of them.
- `Theme` and `SignInView`: the house look and the first screen.

Plan: `docs/plans/2026-10-15-001-feat-ios-practice-app-plan.md`.

## Practice

Andrew's alone, as on the website (`family_members.role = 'owner'`). It opens
straight into the website's quick log (`src/lib/practice/quick-log.ts`): a card
per active piece, tap to start timing it, tap again to stop, tap another piece
to switch. The rules are ported in `Practice/App/QuickLog.swift`; keep the two
in step. Everything else about practice is set up on the website.

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

## Music Minus One

Andrew's play-along app: a song's instruments are separate, time-aligned audio
tracks (the clarinet, cello and piano of a trio); mute your part and play along.
Installed straight to his phone (`scripts/install-on-phone.sh MusicMinusOne`),
no TestFlight. Bundle id and URL scheme `io.mason.music-minus-one`.

- The phone is the source of truth and works offline: the library is a JSON
  file with the audio beside it. Changes go to `music_songs` (one row per song,
  tracks and markers as JSON, last write wins) and the audio to the private
  `music-minus-one` bucket whenever there's signal; another phone pulls both.
- Playback is one player per track into a submix (track volume and pan), then a
  time-pitch unit (speed in 5% steps, pitch kept), all started at one shared
  instant so the parts stay locked together.
- Songs can be grouped into an album or work (a trio's movements), listed
  together in movement order; previous/next on a song moves within it.
- Slowing down has a test switch (the label between the times above the
  waveform) cycling three engines: Apple's time-pitch on the mix, Apple's on
  each part at its finest setting, and Signalsmith Stretch (vendored, MIT) fed
  by a background thread into a short buffer. One will win and the switch go.
- Markers carry a measure number, entered as they're dropped. Tapping one plays
  from there (auto-play), optionally after a count-in: the recording starts that
  many beats early (at the song's one tempo) under a big countdown.

## Adding an app

A new folder beside `Practice/` and a target in `project.yml` that depends on
MasonKit, with:

- bundle id `io.mason.<app>` and that as its URL scheme, for the sign-in
  redirect;
- `keychain-access-groups: [$(AppIdentifierPrefix)io.mason.shared]`, so it
  opens signed in;
- its scheme in the CI matrix (`.github/workflows/ios.yml`).

Then add its redirect URL in Supabase and its record in App Store Connect
(below).

## One-time setup per app

- `io.mason.<app>://auth-callback` in Supabase › Authentication › URL
  Configuration › Redirect URLs (Google sign-in returns there).
- The app's record in App Store Connect (bundle id `io.mason.<app>`) before its
  first TestFlight upload.

## Build & test

```sh
cd ios
xcodegen generate                      # project is generated, not committed
xcodebuild -project MasonApps.xcodeproj -scheme Practice \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' -derivedDataPath build/dd test
```

CI runs the same for every app on every change under `ios/`
(`.github/workflows/ios.yml`).

## Install

- `scripts/install-on-phone.sh [App]`: builds, signs (team S4AV4J8F99,
  automatic) and installs on Andrew's iPhone over the cable or Wi-Fi.
- `scripts/release.sh [App]`: uploads a build to TestFlight.
