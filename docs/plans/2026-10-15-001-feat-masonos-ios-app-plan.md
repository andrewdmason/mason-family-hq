---
title: MasonOS for iOS, v1 (shell + Practice quick log) - Plan
type: feat
date: 2026-10-15
---

# MasonOS for iOS, v1 - Plan

## Goal

A native MasonOS iPhone app in `ios/MasonOS`, the start of a family app that will eventually hold calendar and the other web apps. v1 is for Andrew only: a sidebar shell, a placeholder Home, and a Practice quick logger with a Lock Screen Live Activity. Everything else about practice is still set up on the web.

## Decisions (2026-10-15 Q&A)

- **Shell.** A slide-out sidebar for switching apps, like ChatGPT's or the web app on mobile. It holds Home (a placeholder) and Practice.
- **Who sees Practice.** Only the owner, the same rule the web uses. The app has family sign-in, and members are checked per app, so others can be added later.
- **Practice scope.** Quick log only. Setup and editing stay on the web.
- **Where the timer lives.** On the phone. Supabase gets the same writes the web makes; there is no live sync with the web.
- **Lock Screen.** A Live Activity with a Stop button.
- **Forgotten timers.** A timer auto-ends 1 hour after the last interaction.
- **Baseball Clips.** Remove only `ios/ClipsCamera`. The `/clips` website, its public endpoints, the tables and the storage bucket all stay, since bbcam may still use them.
- **Distribution.** TestFlight for Andrew. The ad hoc install link and in-app updater, which Sebastian needs because he's under 13, wait until a family release.

## Product contract

**Shell**
- R1. One-time Google sign-in through the family Supabase (the same account as family.mason.io). The app stays signed in after that.
- R2. A sidebar opens with a swipe from the left edge or the menu button and lists the apps this member can use. The app remembers which one was open last.
- R3. Home is a placeholder screen.

**Practice: quick log**
- R4. Today's active pieces appear as tap-to-time cards, split into **Current** and **Maintenance**. They use the web's grouping and order: a work with several active pieces is one segmented card, sorted by kind and then name. Each card shows the minutes practiced today. The maintenance piece that's due next gets the same quiet highlight it gets on the web.
- R5. "Today" is the calendar date on the phone, as the website has it. Days that have ended (the practice day ends at 3am) are archived with `practice_rollover` on load, as the website does.
- R6. Tapping a card does what it does on the web:
  - If that piece is running, the tap stops it.
  - Otherwise it times today's entry for that piece, or creates one if there isn't one.
  - If another piece is running, the tap stops that one first.
- R7. A running timer counts up, and it survives the app being closed or killed because it's based on a stored start time.

**Live Activity**
- R8. While a timer runs, a Live Activity shows on the Lock Screen and in the Dynamic Island. It shows the piece name and the elapsed time counting up, plus today's total.
- R9. The Live Activity has a **Stop** button that ends the timer without opening the app.

**Auto-end**
- R10. A running timer ends on its own 1 hour after the last interaction. An interaction is a start, switch or stop in the app or from the Live Activity. The log records the timer as stopped at the 1-hour mark. The Live Activity stops counting at the cap and then ends, and the stop is written to Supabase the next time the app runs.

**Reliability**
- R11. If a write fails because the phone is offline, it's queued and retried. Nothing is lost when the phone has no signal.

## Technical approach

- **Project.** XcodeGen with iOS 26 and SwiftUI. The setup matches Clips Camera: team S4AV4J8F99, automatic signing, and `supabase-swift`.
  - Bundle ID `io.mason.masonos`, with a widget extension `io.mason.masonos.widgets` for the Live Activity.
  - An App Group carries timer state between the app and the extension.
  - The Stop button is a `LiveActivityIntent`, so it runs in the app's process and can write to Supabase.
- **Data.** The app writes to `practice_tasks` directly with the signed-in session; the existing RLS already allows signed-in users. The writes mirror `src/app/practice/timer/task-actions.ts`:
  - start sets `started_at`
  - stop sets `timer_remaining_seconds = goal − elapsed` (it can go negative) and `ended_at`
  - a new entry is created the same way `createTaskOptimistic` creates one: today's date, the current highest session number, and a goal of 0
- **Reads.** `pieces` (active, with work names), today's `practice_tasks`, and the `piece_last_practiced` RPC for the maintenance pick.
- **Ported from TypeScript.** These get Swift versions with unit tests that reuse the cases from `scripts/verify-practice-*.mts`:
  - `buildQuickCards`
  - `pickQuickLogTask`
  - `pickMaintenancePiece`
  - the calendar day and the 3am rollover cutoff
- **Remove `ios/ClipsCamera`.** Update anything in the repo that points at it. The `/clips/install` page and the `app-builds/clips-camera` builds stay as they are.
- **Scripts.**
  - `scripts/install-on-phone.sh` installs over the cable.
  - `scripts/release.sh` uploads to TestFlight. The ad hoc install link and updater are left out until a family release; Clips Camera's versions are in git history.

## One-time steps for Andrew

1. Add `io.mason.masonos://auth-callback` to Supabase › Authentication › URL Configuration › Redirect URLs.
2. Create the MasonOS app record in App Store Connect so TestFlight has somewhere to upload, the first time `release.sh` runs.

## Not in v1

- The list view, task editing, repeats and follow-ups
- Recording, both per-task audio and the session recorder
- Repertoire, lessons and reports
- Live timer sync with the web
- Family members in Practice
- The ad hoc install link
