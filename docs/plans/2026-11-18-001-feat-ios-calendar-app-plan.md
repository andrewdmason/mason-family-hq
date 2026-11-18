---
title: Calendar for iPhone (then Mac) - Plan
type: feat
date: 2026-11-18
---

# Calendar for iPhone (then Mac) - Plan

## Goal

A native, Liquid Glass version of the family calendar that Jenny and Sebastian keep on their phones, with the same in-app update banner as Tuttles. It borrows the shape of Notion Calendar and Fantastical (a floating bottom bar, a week strip up top, a schedule list) and keeps what makes ours a family calendar: the Day view with a column per person, and the going, drop-off and pick-up actions.

The iPhone app is built in one go. The Mac app follows as its own piece of work on the same shared core.

## Decisions (2026-11-18 Q&A)

- **Creating and editing are in.** Not a viewer.
- **One set of rules for everyone.** Sebastian can do anything a parent can do with events. The parent-only check comes off the website's event actions too (create, edit, delete, move to another calendar, going, drop-off and pick-up, TeamSnap RSVP, location search). Calendar *setup* (sources, primary calendars, logistics) is unchanged and still parent-only on the website.
- **Offline viewing, online-only changes.** The app opens on a local copy and refreshes in the background. Changes go through the website and need a connection; there is no offline queue.
- **Views on iPhone: Day and Schedule.** Month is navigation (the title drops open into a month grid), not a view. Week and Month views are for the Mac.
- **iPhone first, then Mac.** Folders are laid out so `Calendar/Mac` slots in beside `Calendar/iPhone`.
- **The event sheet has the website panel's abilities, redesigned as a native sheet.** Team availability (the rest of the team's RSVPs) is left for later. Repeating events display but aren't created or edited in the app, as on the website.
- **Nothing outside the app in v1.** The home screen widget is the first follow-up; "time to leave" alerts after that.
- **Settings are how the calendar looks on this phone.** Setup stays on the website, one tap away.
- **Look: a quiet content layer, glass only on what floats.** Flat warm ground and softened member colours for the grid and list; glass for the bottom bar, the top strip, sheets and the peek card. Light and dark.
- **Creating: the compose button, and long-press on the Day grid.** No sentence parsing yet.
- **One delivery.** No slices.

## Product contract

**Opening and signing in**
- R1. The shared family Google sign-in (MasonKit `Session`); any family member gets in. Others see that it isn't available, with a way to sign out.
- R2. The app opens at once on the local copy (members, sources, events from 60 days back to 180 days ahead, going, duties, logistics), then refreshes from Supabase. With no signal it stays on the copy and says when it was last updated.
- R3. On opening and on coming back to the front, it asks the website for the light sync (no Google writes) and reads again when that finishes. Pull to refresh does the same.

**Top area** (glass, events scroll under it)
- R4. Month title, a Today button showing today's number, and a week strip (Monday first) with the viewed day marked and today in the accent. Swiping the strip changes week.
- R5. Tapping the month title drops open a month grid with a dot under days that have events; tapping a day goes there and closes it.

**Day view** (default)
- R6. A column per shown family member on one time axis. The signed-in person's column comes first and is wide, with full cards (time, title with the calendar's name, location, duty glyphs, who's going). Everyone else is a narrow column: by default a pin line with their photo at each event's start; optionally small washed blocks (Settings).
- R7. The website's rules decide what shows and where: shared events collapse to one with the others attending; hidden events (dismissed, the kid isn't going, TeamSnap "not going") stay out unless Settings says to show them; overlaps sit side by side; a TeamSnap arrival time starts the block early; drive blocks are arrows in the kid's colour, fused onto an event the driver is attending; conflicts get an amber triangle.
- R8. All-day events sit in a strip above the grid. Today has a now line, and the grid opens scrolled to just before now (or the day's first event).
- R9. Swiping left and right moves a day.
- R10. Tapping a card opens the event sheet. Tapping a pin raises a peek card at the bottom (time, title, who); tapping the peek opens the sheet. A drive block opens the kid's event.
- R11. Long-press on empty grid drops a draft at that time in that person's column, draggable before letting go; releasing opens the new-event sheet with time and person filled in.

**Schedule view**
- R12. A continuous list by day, starting at today, with earlier days above. Each row has the member's colour bar and photo, the time, the title, location, and the same glyphs. Days with nothing are skipped; today always shows. Scrolling moves the top strip's day; picking a day up top scrolls the list.

**Floating bar** (glass, bottom)
- R13. A menu button (Day, Schedule, Settings) on the left and the compose button on the right. Compose opens the new-event sheet on the viewed day at the next round hour (9:00 on another day), one hour long, on your own calendar. Today is the button in the top bar. Saving with no connection keeps the form open and says so.

**Event sheet**
- R14. Opens at half height with what matters first: title, when (with "Arrive by" for TeamSnap and the repeat text), where (opens Maps), then the instant actions; expands for notes and the calendar it's from.
- R15. Instant actions, each showing at once and put back with a message if the website refuses:
  - TeamSnap RSVP (Going / Maybe / Not going) on TeamSnap events with a linked player.
  - The kid's own Going / Not going on a kid's other events.
  - Who's going along (every other family member), except on app-only events.
  - Drop-off and Pick-up on a kid's timed events away from home: a parent, a caregiver (Marina, Elias), or not needed; tapping the chosen one clears it.
- R16. Edit (Google and app-only events): title, all-day, start and end, whose calendar, location with suggestions, notes. Moving the start keeps the length; an end before the start snaps to 15 minutes after. Delete asks first. TeamSnap and ICS events can't be edited.
- R17. New events go on the chosen person's Google calendar when they have one, else app-only.

**Settings**
- R18. Who shows and in what order; pins or blocks for other people; Day or Schedule on opening; show hidden events; sync now; manage calendars (opens the website); the account and sign out; the version.

**Updates**
- R19. `scripts/release.sh Calendar` publishes to family.mason.io/install/calendar; copies installed from there show the update banner (MasonKit `AppUpdate`).

## How it's built

**Website**
- `src/app/(calendar)/calendar/api/[action]/route.ts`: the app's changes, with the phone's access token as a bearer (as Workouts and Tuttles do), calling the same functions in `src/lib/calendar/mutations.ts` the website's actions call. Exempt from the session gate in `src/lib/supabase/middleware.ts`.
- `src/app/(calendar)/calendar/actions.ts` and `page.tsx`: event actions and the editing UI open to every member.
- `src/app/install/[app]/page.tsx`: the Calendar entry.

**App** (`ios/Calendar`, scheme `Calendar`, bundle id and URL scheme `io.mason.calendar`, module `FamilyCalendar` so it doesn't shadow Foundation's `Calendar`)
- `Shared/`: models, the ported rules (`CalendarRules.swift`, tested against the website's cases), the store with its local copy, the website client, demo data. No UIKit; the Mac app uses it as is.
- `iPhone/`: the screens.
- `Tests/`: the rules.
- Reads go straight to Supabase under the member's sign-in (row-level security already lets every member read these tables and the photos bucket). No migration is needed.

**Rules that must match the website** (keep in step with `src/lib/calendar/calendar-utils.ts`, `grid-layout.ts`, `conflicts.ts`, `recurrence.ts` and the client's `display`):
- An all-day event's day is read in UTC; a timed event's in the phone's zone.
- Collapsing shared events and choosing the owner row.
- Lane packing, block start (arrival time) and end (30 minutes when there's none; at least 15).
- Hidden events, conflicts, the home-location test, duty chips, the calendar label prefix.
- The softened member colour: 60% the colour, 40% `#6f6a5f`.

Left on the website's side: working out drive blocks. The app shows the drive blocks the website has written; it doesn't draw the "pending" ghost blocks the web client synthesises between a duty tap and the server catching up. After a duty change the app reads again a few seconds later, which is when the real blocks appear.

## One-time setup (Andrew)

- `io.mason.calendar://auth-callback` in Supabase › Authentication › URL Configuration › Redirect URLs.
- Register Jenny's and Sebastian's iPhones on the developer account (plugging each into Xcode does it) before they install from the link.
- An App Store Connect record for `io.mason.calendar` only if TestFlight is wanted; `--adhoc-only` skips it.

## Later

1. The Mac app (`Calendar/Mac`): Day, Week, Month and Schedule, keyboard, drag to create and move, and a way to deliver updates.
2. Home screen widget.
3. "Time to leave" alerts from drive times.
4. Team availability in the event sheet; sentence parsing for new events; repeating events.
