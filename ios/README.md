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
- A home screen widget shows today's total, climbing by the minute while a timer
  runs. The app hands it what the phone knows through the app group; every 30
  minutes or so (iOS decides) it also reads the log itself with the shared
  sign-in, to pick up practice on the website. The larger of the two wins, so
  time removed on the website shows once the app has next opened.
- The look is Liquid Glass on a warm mesh backdrop (`PracticeStyle.swift`):
  glass tiles that fill with colour toward each piece's goal, a ring for the
  day, and a floating bar with Stop while a timer runs.
- `--demo` runs on a made-up day with no sign-in, for the simulator;
  `--demo-running` also starts a timer.

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

## Todos (Mac)

A native to-do app for the Mac, in `Todos/` (scheme `TodosMac`). The to-do list
lives on the Mac in a file, so opening it and every action are instant; the
website stays as it is for the rest of the family. `TodosMac` isn't in the CI
matrix, which builds for the iPhone simulator.

Focus mode (⇧⌘F, or the one toolbar button on Today) is the website's: one Today
to-do at a time, no skip. E completes, S snoozes until tomorrow, the ⌘ When keys
move it, Esc leaves. New to-dos are ⌘N or C; there's no add button.

## Todos (iPhone)

The same list and sync (`Todos/Shared`, `Todos/Sync`) with its own screens in
`Todos/iPhone`, scheme `Todos`. Installed with `scripts/install-on-phone.sh Todos`.
It isn't in the CI matrix yet, which runs each scheme's tests; the shared rules
are tested under `TodosMac`.

No app can take over Siri's "Remind me", so both apps collect from Reminders
instead (`Todos/Sync/RemindersImport.swift`): plain reminders in the default list
move to the Inbox. Anything with a date, a place or a repeat stays, since Todos
doesn't send alerts.

`--feel-test <rows> <results file> [mode]` drives the app with real key and mouse
events (`Mac/FeelTest.swift`), never touching the saved list.

Notes are the website's HTML (`Shared/NotesHTML.swift`), edited natively on both
apps with the rules in `Shared/NoteEditing.swift`. A note outside the tags the
website's editor writes is shown read-only rather than rewritten. Attachments
share the website's table and bucket: files queue on the device and upload once
their to-do has reached the database (`Shared/TodoAttachments.swift`).

## Tuttles

The kids' homework tutor (Sebastian's for now), in `Tuttles/`. Bundle id and
URL scheme `io.mason.tuttles`. It opens on a new chat; earlier ones are a step
back. The tutor's rules are in `src/lib/tuttles/prompt.ts`.

- A turn goes to the website (`/tuttles/api/chat`) with the phone's access
  token; the website holds the model key, streams the reply back as plain text,
  and saves the turn once it's finished. A failed turn saves nothing and comes
  back to the message box to send again. The phone reads its threads and
  messages straight from Supabase (`tutor_threads`, `tutor_messages`).
- Photos go to the private `tuttles` bucket (`{student}/{thread}/{photo}.jpg`)
  before the message that carries them. The camera stays open for as many
  pictures as it takes and closes on Done.
- Replies are Markdown with LaTeX and ```visual blocks of JSON (mapping
  diagrams, graphs, number lines, SVG). `MessageBlocks` splits them, SwiftMath
  typesets the math, and `VisualView` draws the pictures; the website's parent
  view draws the same format, so keep the two in step.
- Archiving tidies a chat out of the list; parents still read every chat at
  family.mason.io/tuttles.
- `--demo` runs on canned chats with no sign-in (`--open <n>` opens one), for
  the simulator. `--website <url>` points the chat at another server.

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
