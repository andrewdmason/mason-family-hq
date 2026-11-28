# Calendar: trips

A trip is a named stretch of days with a set of travelers. Its flights, stays
and other bookings are calendar events with structured details. With that
known, the calendar can say what's still to book and draw each day in the
right time.

Andrew settled the first six questions on 2026-11-28. The rest were left to
the build and are marked *(build)*.

## Decided

1. **How a trip comes into being.** The app suggests trips and you confirm
   them, and you can also make one by hand at any time. A trip made by hand
   can start as a stub (name and dates only) and fill in as things get
   booked.
2. **First build.** Includes:
   - the trip and its view;
   - time zones taken from the trip;
   - checks, which double as a "still to book" list.

   Next round: home-life stand-down (attendance, TeamSnap RSVPs, drive
   duties). Later: import from email, a shareable itinerary, packing lists
   and templates. Desktop (Mac) first, then iPhone; the web comes after.
3. **What's still to book.** Built-in slots plus your own items.
   - The built-in slots are: getting there, a bed for every night, each move
     between places, and getting home.
   - Slots that need no booking close in one tap: "We're driving", "Staying
     with family".
4. **Who's on it.** A trip has travelers. Each piece (flight, stay…) is for
   all of them unless narrowed to some. Slots are per person ("Getting home:
   open for Andrew"). Only travelers' days switch to the trip's time; the
   whole family sees every trip.
5. **Details.** Attaching an event fills in what can be read from its title,
   place and notes: kind, flight number, airports, confirmation code, address,
   check-in and check-out. Then you edit. Details live in Family HQ and are
   never written back to Google.
6. **Where trips show.** Two places:
   - A band across the trip's days.
   - A Trips list (upcoming trips with what's open, plus suggestions).

   On the Mac:
   - The band sits in the week's all-day row, and clicking it opens the trip
     in a side panel.
   - The Trips list is a toolbar button and menu item.
   - The applet shows a line for the trip you're on, or one coming up with
     things still to book.

## Model *(build)*

`supabase/migrations/00231_calendar_trips.sql`:

- **`calendar_trips`**
  - `name`, `start_date` and `end_date` (whole days, the last one included),
    `traveler_emails`, `notes`, `created_by_email`.
  - The nights are `start_date` … `end_date − 1`.
- **`calendar_trip_pieces`**
  - What's booked, or planned: `kind` is one of flight, train, bus, ferry,
    drive, car, stay or other.
  - `leg` (out, between, back) says which slot a way of getting somewhere
    fills.
  - `booked`: false is "planned, not locked in", which still leaves the slot
    open.
  - `event_id` and `event_google_id` point at the event, when it's on the
    calendar. There is no foreign key: a re-sync can replace a row, and the
    Google id finds it again.
  - Times: `starts_at`, `ends_at`. Places: `from_place`, `to_place`. Zones:
    `from_zone`, `to_zone`. `title`, `confirmation`, and `details` (jsonb of
    strings: seat, terminal, address, phone, door code, Wi-Fi…).
  - `traveler_emails`: null is everyone on the trip.
- **`calendar_trip_items`**: your own to-dos (`title`, `done`, `position`).
- **`calendar_trip_dismissals`**: suggestions a member said no to, their own
  rows, the way hides are.

Every family member can read and change trips, as with events. The apps write
straight to Supabase under the member's sign-in, as hides do, because no
Google, TeamSnap or drive-block rules are involved.

## Rules *(build)*

All in `ios/Calendar/Shared/Trips.swift`, tested in `Calendar/Tests/TripTests.swift`.

- **A traveler's span.**
  - It runs from the trip's first day to its last.
  - A `back` leg for them ends it earlier: Dad flying home Thursday.
  - An `out` leg for them starts it later or earlier.
- **Slots per traveler.**
  - *Getting there*: a booked way of getting somewhere marked `out`, or
    starting on their first day.
  - *Each night*: a booked stay covering it, or a way of getting somewhere
    that runs through it (a red-eye).
  - *Moving on*: on a day where their stay changes from one place to
    another, a booked way of getting somewhere on that day.
  - *Getting home*: a booked way of getting somewhere marked `back`, or
    starting on their last day.
  - Slots for a trip of one day: getting there and getting home.
  - A one-tap "We're driving" or "Staying with family" is a booked piece
    with no event.
- **The trip's time.** Each day of a traveler's span is in the zone of where
  they sleep that night (the stay's zone). Their last day is in the zone of
  where they slept the night before.
  - These days replace the inferred "days away" for the signed-in member.
  - The inference still fills days that no trip covers.
- **Suggestions** come from three sources:
  - The signed-in member's inferred days away, as runs of days in one zone.
  - All-day events that run two days or more.
  - Flight-looking events.

  A suggestion that overlaps an existing trip, or one that was dismissed,
  isn't offered.
- **Prefill.** Reading an event's text gives:
  - The kind, from words such as flight, hotel, Airbnb or Hertz, and from a
    flight number.
  - Airline and flight number, as two letters then digits.
  - Airports, as three-letter codes found in a small built-in table, which
    gives the zones.
  - The confirmation code: the word after "confirmation", "record locator",
    "booking reference" or "PNR".
  - A phone number.
  - Times from the event, and the address from its place.

## Not in the first build

- The iPhone trip view (next).
- The website.
- Home-life stand-down.
- Email import, sharing, packing lists, templates.
- Passport expiry.
- Check-in reminders.
- Writing new events from a trip. A piece without an event is fine, and
  attaching one is how events join.
