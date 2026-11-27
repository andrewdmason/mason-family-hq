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

The kids' homework tutor, in `Tuttles/`: an iPhone app (`Tuttles/iPhone`, scheme
`Tuttles`) and a Mac app (`Tuttles/Mac`, scheme `TuttlesMac`, below) on the
same code (`Tuttles/Shared`). Bundle id and URL scheme `io.mason.tuttles` for
both. It opens on a new chat; earlier ones are a step back. The tutor's rules
are in `src/lib/tuttles/prompt.ts`.

- `Shared/` is everything that isn't the shape of the device: the store, the
  rules of a chat (`ChatSession`: sending, quizzes, a test run's clock), how a
  reply is drawn, and the study, class and parent screens. `Platform.swift`
  names what differs (images, colours, a card, a page of sections) so the rest
  reads the same on both. A change there is a change to both apps; CI builds
  both.

- Sebastian is under 13, so no TestFlight. `scripts/release.sh Tuttles` also
  publishes an ad hoc build to family.mason.io/install/tuttles (installs only
  on iPhones registered on the developer account; plugging one into Xcode
  registers it). Copies installed from there show a banner when a newer build
  is published (`MasonKit/AppUpdate.swift`); tapping it updates in place.
  `--adhoc-only` skips TestFlight.

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
- **Vocab** (in the menu beside Classes and Study) is the website's ISEE
  Verbal Reasoning practice (`src/lib/words`, /words), native: a day is ten
  minutes of answering (a ring on the home card), over as many 25-question
  sessions as that takes, each with reviews and new words mixed.
  The words, the schedule and the grading stay on the website; the phone goes
  through `/tuttles/api/vocab` (`src/lib/tuttles/vocab.ts`) and never holds a
  question's answer before it's given. It follows the account picker: a kid,
  or a parent's phone used as one, plays that kid's own session at their
  level (unlike /words, where a parent's answers are saved as the parent's);
  the parent view shows both kids and each one's words, read-only.
  `Shared/Vocab.swift` has the shapes and a session's rules,
  `VocabViews.swift` and `VocabSessionView.swift` the screens. `--demo --vocab`
  opens on it (the demo's sessions are 8 questions, to play through quickly),
  `--vocab-late` starts a session two questions from its end,
  `--vocab-slow` makes every answer take two seconds to save,
  `--vocab-second` has one session done and a second under way (with
  `--vocab-late`, finishing it fills the day's ten minutes), and
  `--vocab-sort` opens on sorting out the words known already
  (`VocabSortView.swift`).
  An ordinary session played on the phone opens on the stage's boss with
  something to say (`VocabBosses.swift` has each boss's lines, in order) and
  ends on its chest, full screen (`VocabChest.swift`: wood, silver or gold by
  how the session went): tapped, it bursts open and its coins pour out and are
  counted, and then the session's numbers follow. Its sounds are made in code
  (`VocabChestSound.swift`), ambient like Math's: quiet when the phone is on silent.
  Chests and which line comes next are kept only on the phone, with the rest
  of what it keeps for Vocab. `--vocab-offline` is the way to see both
  (with `--vocab-late`, one question from the chest).
  The map of stages is drawn on a landscape (`VocabLandscape.swift`): each
  stage's ground and scenery in code, moving a little, with the stages still
  ahead under a haze. `--vocab-path --vocab-climb` shows all twenty.
- A parent's account menu picks who the phone is being used as: one of the
  kids, or the parent themselves ("Andrew", `ChatStore.Viewer.parent`). As
  themselves a parent has one menu with two groups. The first is about the
  kids, the **Parent Dashboard** (This week, both kids' Vocab and Math, the
  houses), opening on a page of its own (`Shared/ParentDashboard.swift`,
  `/tuttles/api/parent/dashboard`): for each kid, the words to practice with
  them today and their last four weeks by day and by week. The second,
  "Yours", is the parent's own Vocab, Math and house (`Route.myVocab`,
  `.myMath`, `.myHouse`), kept apart from the kids' and played at Sebastian's
  level (Middle). The shell tells the store which group the open place is in
  (`ChatStore.play(own:)`), and Vocab's, Math's and the house's requests
  then name the parent's own id in `X-Tuttles-Kid` (`authorize(mine:)`);
  the website sets them up the first time (`parentSelf` in
  `src/lib/tuttles/tutoring-as.ts`, `PARENT_LEVEL` in `src/lib/tuttles/vocab.ts`).
  A parent's chat list is their own: their briefings and the chats they've
  started (`ChatStore.parentChats`; the plain ones from before 26 November
  2026 were made for the kids and stay out). A chat they start is theirs,
  typed or spoken: it names the parent's own id too, and the tutor talks to
  them as an adult (`parentInstructions` in `src/lib/tuttles/prompt.ts`); a
  briefing stays about the kid. Parents never appear on the street,
  the Math board or the summaries, which list only the kids.
  `--demo --dashboard -tuttles.viewer.demo parent` opens on the dashboard;
  `--vocab --mine` (or `--math`, `--house`) on the parent's own.
- `--demo` runs on canned chats with no sign-in (`--open <n>` opens one). The
  simulator is the demo without the flag, so tapping its icon there opens
  straight in; `--live` is the real app there, sign-in and all, and so is
  `--website <url>`, which points the chat at another server.

### Math (iPhone only)

`Tuttles/iPhone/Math`: ISEE math practice as an endless runner in the manner of
Subway Surfers. The kid runs through the school, a teacher behind throwing math
problems into the way; anything hit means a question against the clock, right
to break free, wrong and the run is over with the worked answer shown.

- Dodging gets harder over each wave's thirty seconds or so and resets on a
  right answer (`MathGame.swift`, top comment); the pace it resets to and the
  questions' difficulty step up each time. Each right answer moves the run on
  to the next of eleven zones (`MathZones.swift`), five ordinary and six wrong.
- It's SceneKit. Characters and a few props are Kenney's public-domain kits in
  `.glb` (`Math/MathAssets/models`, read by `MathGLB.swift`); the school itself
  is built in code. Sounds are in `Math/MathAssets/audio`, rebuilt by
  `scripts/math-audio`. Both folders have a `CREDITS.txt`.
- Questions ship in the app (`Math/MathAssets/bank`), written by
  `scripts/math/import.mts` from Andrew's sheet of questions (a copy, the
  fixes found by checking every answer, and the figures are in
  `scripts/math/source`), so it plays
  with no connection. Runs, answers and how the kid looks are kept on the phone
  (`MathStore.swift`) and go to `/tuttles/api/math/sync` when there's signal;
  the parents' view reads `/tuttles/api/math/summary`.
- What it pays goes into the house's purse as coins (below). Everyone runs as
  themselves; their look is free to change ("Look" on Math's first screen).
- For the simulator, with `--demo --math`: `--math-run` starts running,
  `--math-auto` plays by itself, `--math-god` can't be caught, `--math-level 6`
  starts in the sixth zone, `--math-shop` opens the look editor,
  `--math-lower` uses the Lower Level bank, and
  `--math-figures middle 12` shows six of that level's figures from the 13th.

`Tuttles/iPhone/House`: what Vocab and Math are played for. Each kid has a
house on a street the two share: rooms bought with coins (two with gems), and
in each room fixed spots, each with its own things to choose between.

- One purse for both games (`HouseStore.swift`). What each game pays, and why
  those amounts, is `Shared/HousePay.swift` (the economy of 2026-11-26, about
  300 coins for a good day of both): Vocab pays by the chest at the end of a
  session and for bosses, and Math by a run's stars, its only score, 10 to a
  coin; a gem for a boss beaten, and for a day's 20 Math questions with 15
  right. Vocab's winnings wait in its own store until the day's ten minutes
  are done (a chest not banked by midnight is lost, a boss waits), each under
  a key so nothing is paid twice. A house kept under the first economy
  (`HouseState.economy` 1, with back pay) starts again empty.
- Vocab and Math have the same button at the top right (`HouseStatusButton`
  in `HouseViews.swift`): today's Vocab time against the ten minutes (a ring,
  then a tick), the coins and the gems. Tapping it slides the house up over
  the game, with an X at the top left to put it away. Vocab's
  first screen opens the purse too, so its winnings are in as soon as the ten
  minutes are done. (The Mac, with no house, keeps the streak there.)
- Math's end screen has a stars top 10 of runs, today's and of all time
  (`top` from `/tuttles/api/math/sync`, `topRuns` in `src/lib/tuttles/math.ts`):
  the kids' runs since stars were the score, and a parent's own when they play.
- Rooms, spots, things and prices are all in `HouseCatalog.swift`; the prices
  are checked against a day's pay in `Tests/HouseTests.swift`.
- Each kid puts each room where they like and can move it later, free
  (`HouseLayout.swift`): on a 5 by 5 lot, on the ground or on another room,
  touching the rest; nothing on the garden or observatory, and the basement
  only under a ground-floor room. Houses from before this are laid out again
  so they hold together.
- It's SceneKit from one fixed corner (`HouseScene.swift`). A room is a floor
  and two walls. A wall with a room behind it is down to the knee with a gap,
  except from inside that room, where it's up with a doorway through it (and
  what hangs on it hangs over the doorway). Each floor over the ground has a
  flight of stairs up to it (`HouseLayout.stairs`): outside, since a room's
  floor is all spots, beside a room of that floor where nothing's built, with
  a door at the top when the house is shut. From far off each house is shut, with
  front walls, windows, a door and roofs. Nothing's a screen to go into and
  back out of: the town is dragged about and pinched closer from anywhere
  (`HouseStage.Roam`), and how close the camera is says what's shown
  (`HouseStage.seen`). Close to a house it opens; closer still the room in
  the middle of the screen is the one you're in, its walls up, and whatever's
  in front of it or over it a ghost of itself. A tap on a house or a room
  only flies there.
  At the bottom of the screen are two buttons that keep their corners
  wherever the camera is. On the left, always, Rooms (`HouseRoomSheet`): a
  card to move a room from or add one, which from anywhere flies to the
  kid's own house. On the right, while a room of theirs is in focus,
  "Decorate kitchen", the only thing in red. The floors of the open house
  are a short column up the right edge (All, 2, G, B). In a room of the
  other house, whose room it is is said at the top. Decorate brings a card
  up over the bottom of the screen (`HouseDecorSheet`) and holds the room in
  focus: a tab for each
  of the room's spots, on the first that's still as it came, and under them
  what can go there. Only while the card's up does each spot have a marker
  in the room, which says what goes there (`HouseSpot.symbol`): a white tag
  with a picture and a "+" where nothing's been chosen, a small dot where
  something has. A tab or a marker changes what the card's for, and a tap
  anywhere else puts it away. With no card up, a tap on a thing in their
  room brings it up on that thing's spot.
  A floor picked is the one you're on: those over it go and those
  under it fade.
- The houses stand in a neighbourhood after the family's own in Berkeley
  (`HouseTown.swift`): Avalon Ave winding from the turning circle at its west
  end out to Oak Knoll, inside four straight streets (Kelsey, Garber, Oak
  Knoll, Russell), their names painted on them, with trees and hills past
  them. Mom & Dad's house is at the top of the turning circle up a drive:
  ready-made, every room, solar panels, both of them on the step, and anyone
  can look round it but nobody builds it (`HouseTown.parents`; the stage adds
  it to whatever it's shown). Oscar's lot is west of the circle and
  Sebastian's two doors east of Mom & Dad's, by name (`HouseTown.lots`);
  anyone else (the demo, a parent as themselves) gets the first lot free.
  Five neighbours' houses (shut, nobody's), the big place with the pool and
  Monkey Island Park fill it out, and three lots are bare grass, for buying
  a second house on later (not built yet). The camera looks from the
  south-east, so front doors are on the south: houses north of Avalon open
  onto it, those south of it onto Russell. Each house has its fence and
  trees at the back (`HouseLand.swift`) and a path from its door to the
  street. It opens on the family's end (the three houses framed together);
  the map button pulls back to the whole neighbourhood and, from there, goes
  home again. The town drags as far as its edges and pinches in as far as a
  bit of a room.
  While the house is up a drag doesn't slide the menu out. Looking
  at the basement takes the ground away and shows it in earth. Furniture and pets are Kenney's kits; rugs, floors,
  pictures, windows and the odd things are drawn in code (`HouseProps.swift`).
- Two of a room's spots aren't places in it: its Wood and its Fabric, the
  colour of every wooden and every upholstered thing in the room. The kit's
  parts are named for what they're made of ("wood", "carpet", "lamp"), and
  `HouseProps.finish` gives a thing's parts the room's materials.
- The outside of the house is theirs too (`HouseCatalog.outside`, kept like a
  room's spots under "outside.roof" and so on): the roof's colour and shape,
  what the walls are clad in, the front door, something on the roof and
  something on the lawn. With their house in view and no room in focus the
  red button is "Decorate outside", and while its card's up the house stays
  shut (`HouseStage.shut`) so the roof's there to see.
- The street keeps the phone's time of day (`HouseSky.swift`): the sun low
  and orange about sunrise and sunset (earlier in winter, by the day of the
  year), and at night a bluer, dimmer light, the lamps in the open house on
  (each lighting only its own room, by `categoryBitMask`), the windows of a
  shut house lit, and the night through the windows inside.
- The house goes to `/tuttles/api/house/sync` whole, newest wins, and the
  street comes back and is kept, so the other house shows with no connection.
  The parents see the street and each purse.
- For the simulator, with `--demo --house`: `--house-coins 50000` and
  `--house-gems 40` fill the purse, `--house-room den` opens on a room,
  `--house-add kitchen` opens on choosing where that room goes,
  `--house-floor 0` shows the house up to that floor,
  `--house-fill 0` gives every room with each spot's first thing in it (`2`:
  its third), `--house-decorate` with a room opens its card, `--house-outside` the card
  for the outside,
  `--house-hour 21.5` makes it half past nine at night, and `--house-sizes`
  prints each kit model's size.

## Tuttles (Mac)

Tuttles at a desk, for the family Mac mini (scheme `TuttlesMac`), where each
kid and each parent has a login. Everything the iPhone app does except the
camera and voice (push to talk and calls): homework comes in by dragging it
onto the chat, pasting it (⌘V with a screenshot, a picture, a PDF or a file on
the clipboard) or the + beside the message box.

- One window: a sidebar where the phone has its slide-out menu (New chat,
  Classes, Study, the chats, and who's signed in), and what's open beside it.
  A parent switches between their own view and each kid's from the account
  menu at the foot of the sidebar, as on the phone.
- Return sends and Shift-Return starts a new line; ⌘N is a new chat. In a
  quiz, with nothing typed, 1 to 4 pick an answer.
- The look is Liquid Glass on a mesh of the icon's red and warm paper
  (`MacStyle.swift`): the sidebar, the message box, the student's bubbles and
  the cards are glass; the tutor's replies sit straight on the backdrop, down
  a column in the middle, a size up from the Mac's usual text.
- Sign-in is each login's own (kept in a file in that account, see
  `MasonKit/Session.swift`), so one copy in Applications serves everyone.
- `scripts/release-mac.sh` signs a build with the family Developer ID, has
  Apple notarize it, and publishes it to family.mason.io/install/tuttles
  (`app-builds/tuttles-mac/latest.json`). Installed copies show an
  **Update Tuttles** button in the sidebar when there's a newer one
  (`MacUpdate.swift`): it downloads the build, checks it's signed by the
  family account and newer, swaps it in and reopens. Its one-time setup (the
  certificate and the notarization sign-in) is at the top of the script.
- For trying it out (debug builds): `--demo` runs on canned chats with no
  sign-in; `--open=<n>`, `--class=<id>`, `--study` and `--classes` open
  somewhere; `--dark` is the dark look; `-tuttles.viewer.demo parent` is the
  parent view. `--snapshot=<file.png>` writes a picture of the window a few seconds in
  and quits, without coming to the front (`--snapshot-after=<seconds>`), after
  typing `--keys=<text>` or clicking `--click=<x>,<y>` if given
  (`DebugSnapshot.swift`). Values ride on the flag with an `=`: the Mac takes a
  bare word after a flag for a file to open, and opens no window.

## Workouts

The website's Workouts (`src/app/(workouts)`), for the gym. Bundle id and URL
scheme `io.mason.workouts`; open to everyone in the family, each member seeing
their own. Three tabs: Upcoming, PRs, History.

- Upcoming is where it opens: today's workout first in the list, then
  what's coming, each a tap from logging. Today's is not opened until it's
  tapped, so a day skipped leaves no session behind. Swiping a row away
  (or Delete in a workout's menu) deletes it from the calendar too, Google
  Calendar included, through `/workouts/api/delete`; it's hidden at once and
  the delete is sent when there's signal. Workouts from before today
  that were opened and never marked done are in History, marked unfinished.
  How often you've trained lately sits above the records on PRs.
- A workout open to log is a glass card per block, a
  field for every set (already filled with what was written, so doing it as
  written needs no typing), each lift's best estimated 1RM with the load that
  matches today's reps, a benchmark's earlier attempts, the block's result, how
  the day felt, notes, and Mark done. Done folds it into a recap; Edit in the ⋯
  menu opens the fields again.
- The rules are the website's, ported in `Workouts/App/WorkoutRules.swift`
  (formatting, Epley estimates, which workout is today's, the recap, the
  progress roll-ups) and tested against the same cases as
  `scripts/verify-workout-math.mts`; keep the two in step.
- Reads come straight from Supabase under the member's sign-in
  (`WorkoutStore.swift`, the queries of `src/lib/workouts/queries.ts`). Edits
  queue on disk and go when there's signal, oldest first (`WorkoutWrites.swift`),
  and the last screens seen are kept, so it opens and logs in a gym with none.
- Opening a workout from the calendar goes through the website
  (`/workouts/api/open`, with the phone's access token), which holds the model
  key that structures it. A workout that came back unstructured is tried again
  the same way.
- That structuring is the slow part, so on each load the app sends the
  workouts coming up to `/workouts/api/prepare`, one at a time in the
  background. The website keeps each parse by the text's hash
  (`workout_parses`) and the open picks it up. Nothing is opened ahead: an
  opened workout's prescribed loads count toward estimated maxes whether or
  not it was done, so a skipped one must not become a session.
- Still on the website only: logging a workout that isn't on the calendar,
  editing or re-importing a workout's movements, the movement library, and
  sending to WHOOP (the recap says where that stands).
- The look is Liquid Glass on a mesh of the icon's clay and paper
  (`WorkoutStyle.swift`), warmer with a workout open and sage once it's done.
- `--demo` runs on a made-up training block with no sign-in, for the simulator;
  `--demo-done` has today's workout already done, `--tab <upcoming|prs|history>`
  opens on a tab, and `--website <url>` points opening at another server.

## Calendar

The family calendar (`src/app/(calendar)`), for everyone's phone. Bundle id and
URL scheme `io.mason.calendar`; the scheme is `Calendar` and the module
`FamilyCalendar`, so it doesn't shadow Foundation's `Calendar`. Plan:
`docs/plans/2026-11-18-001-feat-ios-calendar-app-plan.md`.

- Two views, switched from the floating bar's menu: **Day**, a time grid with a
  column per family member, and **Schedule**, one list day after day. The top
  bar's week strip moves between days; its title drops open a month grid.
- In Day the signed-in member's column is first and wide, with full cards.
  Everyone else is a narrow pin line with their photo at each event's start
  (tap for a peek card, tap that for the event), or thin blocks if Settings
  says so. An event someone is only going along to is a fainter line with a
  small ring in their column, so one event doesn't read as two. Long-press empty grid to place a new event in that person's column.
- A trip is drawn in its own time. A day where most of the signed-in member's
  placed events are in another timezone (`calendar_events.location_time_zone`,
  filled by the website's drive-time pass from the geocoded coordinates) is a
  day away: its grid, cards, event sheet and time wheels are in that zone, under
  a "Costa Rica time · 2h ahead" note. Empty days inside a trip count too. Once
  the phone itself is in that zone there's nothing to convert and the note goes.
  The rule is `CalendarRules.awayZones`; `--demo` has a trip 12 days out.
- The rules are the website's, ported in `Calendar/Shared/CalendarRules.swift`
  and `CalendarBoard.swift` (which day an event is on, which rows are one
  shared event, what's hidden, lanes, conflicts, duty chips, the calendar
  label) and tested in `Calendar/Tests`; keep them in step with
  `src/lib/calendar/calendar-utils.ts`, `grid-layout.ts`, `conflicts.ts`,
  `recurrence.ts` and the `display` function in `calendar-client.tsx`.
- It opens on a local copy (a file per member in Application Support: members,
  sources, events from 60 days back to 180 ahead, going, duties) and reads the
  rest straight from Supabase under the member's sign-in. On opening it asks
  the website for its light sync, then reads again.
- Every change goes through the website (`/calendar/api/<action>`, with the
  phone's access token), which runs the same mutations as the website's own
  actions: writing back to Google, drive blocks, TeamSnap. Every change shows
  at once: the event card closes on its ✓ and the website hears in the
  background, a part at a time (the event's fields, a move to another
  calendar, who's going, the RSVP, each drive). A part it refuses or can't be
  reached for is put back and a banner says why; the rest stands. A new event sits under an id made up on the phone until
  the website's row for it has been read. Nothing queues across launches.
  Every family member can make changes, kids included.
- An event opens as one card (`iPhone/EventCard.swift`), which is also how a
  new one is made: there's no separate form. Every row is the thing and the
  way to change it (title, time, all-day, repeat, location, who's going and
  whose calendar it's on, the TeamSnap RSVP, drop-off and pick-up, notes), and
  all of it sits in a draft (`CardDraft`) until the ✓. ✕ or a swipe down with
  changes asks before dropping them. The card is as tall as what's on it. An
  event that can't be edited here (TeamSnap's, a feed's) shows its fields as
  plain words with the family's rows still live. If the calendar is read
  again under an open card, what was changed there stays and the rest
  follows (`CardDraft.rebased`).
- Repeating: a Google event can be made to repeat (every day, weekday, week,
  2 weeks, month, year, with an optional last day), and a rule made in Google
  Calendar that those can't say is kept as it is. Saving an edit to a
  repeating event asks: this one only, or all of them. A change to the rule
  is always to all; "Doesn't repeat" keeps this one and removes the rest.
  Who's going, the RSVP and drives are always the one occurrence's, and so is
  a move to another calendar. Deleting asks the same question. On the website
  the series is changed on Google and its rows mirrored again
  (`mirrorSeries` in `src/lib/calendar/mutations.ts`), each occurrence
  keeping its row so going and drives survive.
- Not here yet: the team's availability roster, and the "pending" drive
  blocks the website draws between a duty tap and the server catching up; the
  app reads again a few seconds after a change, which is when the real ones
  arrive.
- Touch and hold an event to hide it from your own view (`iPhone/Hiding.swift`):
  nobody else's calendar changes. A Google repeating event offers every
  occurrence or just this one; anything else is hidden one at a time. A hidden
  series still shows on a day you're going or driving, and one on your own
  calendar can only be hidden an occurrence at a time; "just this one" always
  holds. Drive blocks go with their event. A note with Undo follows, and
  Settings › Hidden events lists them with a way back. Hides are the member's
  own rows in `calendar_event_hides`, written straight to Supabase (the one
  change that doesn't go through the website), kept in the local copy so the
  widget leaves them out too. The website and the Mac don't read them yet.
- Settings are this phone's: who shows and in what order, pins or blocks, the
  view it opens on, hidden events. Calendar setup stays on the website.
- Released like Tuttles: `scripts/release.sh Calendar --adhoc-only` publishes
  to family.mason.io/install/calendar and installed copies show the update
  banner. Each phone must be registered on the developer account first.
- A large home screen widget (`Calendar/Widgets`, target `CalendarWidgets`)
  shows today as the Day view in small: eight hours from an hour before now,
  the phone's own member in the wide column and the family as pin lines.
  Tapping an event opens it in the app (`io.mason.calendar://event/<id>`). Its
  view and model are in `Calendar/WidgetShared`, built into the app too so
  `--widget` can show it in the simulator. The app and widget share the
  calendar's local copy, members' photos and Settings › People through the app
  group `group.io.mason.calendar` (`Shared/CalendarShared.swift`); the widget
  also reads the calendar itself every half hour with the shared sign-in, so
  it keeps up when the app hasn't been opened.
- The peek card opens on a tap or a swipe up, and goes away on a swipe down.
- Google won't let an event it made from an email (a flight, a booking) be
  edited or given guests. When it refuses, the app asks whether to replace the
  event with a copy that can be: the website makes the copy on the same
  calendar, deletes the original (`convert`), and the refused change is then
  made. An event that moves to another member's calendar keeps whoever had it
  as going.
- `Calendar/Shared` has no UIKit, for the Mac app to come (`Calendar/Mac`).
- `--demo` runs on a made-up family week with no sign-in, for the simulator;
  `--me <first name>` chooses whose phone it is, `--view <day|schedule>` the
  view, `--widget` shows the widget's view at its size, and `--website <url>` points changes at another server.

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
- `scripts/release-mac.sh`: publishes Tuttles for the Mac (see Tuttles (Mac)).
