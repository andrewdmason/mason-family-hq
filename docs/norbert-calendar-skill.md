---
name: family-calendar
description: Read and manage the Mason family calendar through Family HQ — list events, add/edit/delete events, mark which parent is going to kids' events, assign drop-off/pick-up, answer TeamSnap RSVPs, and surface scheduling problems (conflicts, missing drive assignments, unanswered RSVPs). Use this INSTEAD of reading or writing Google Calendar directly for anything involving the family schedule.
---

# Family HQ calendar

Family HQ is the family's calendar hub. It aggregates every source — TeamSnap
teams, school ICS feeds, and everyone's Google calendars — into one place, and
it owns the family-specific state Google doesn't have: which parent is going to
a kid's event, who's doing drop-off and pick-up (with drive-time blocks it
materializes onto the parents' real Google calendars), and the kids' TeamSnap
RSVPs.

**Always work through this API for family scheduling. Never write family
events to Google Calendar directly** — events created here land on the right
person's real Google calendar automatically, and writing to Google yourself
creates duplicates the app can't reconcile. Reading Google directly is also
unnecessary: this API already shows every calendar, plus the attendance/drive
state Google doesn't have.

## Setup

Two environment variables must be set:

- `FAMILY_HQ_URL` — the app's base URL (e.g. `https://familyhq.example.com`)
- `FAMILY_HQ_AGENT_SECRET` — the bearer token

Every request:

```bash
curl -s -H "Authorization: Bearer $FAMILY_HQ_AGENT_SECRET" \
  "$FAMILY_HQ_URL/api/agent/calendar/<endpoint>"
```

All times are ISO 8601. Send timezone-explicit datetimes (e.g.
`2026-06-14T15:00:00-05:00`); responses come back in UTC.

## Who's who

`GET /api/agent/calendar/context` returns the family members (name, email,
role: owner/parent/kid), the calendar sources, and the logistics settings
(home address, drive buffer). Fetch it once per session to map names to
emails. Parents = role `owner` or `parent`.

## Reading the calendar

```
GET /api/agent/calendar/events?from=2026-06-12&to=2026-06-19
GET /api/agent/calendar/events?member=oscar@mason.io
GET /api/agent/calendar/events/<id>
```

`from`/`to` accept `YYYY-MM-DD` or ISO datetimes; default is roughly now →
+14 days. Each event includes:

- `member` — whose event it is
- `teamsnap` — for team events: `is_game`, `opponent`, `arrival_time`, and
  `rsvp` (the KID's TeamSnap attendance: going/maybe/not_going/no_reply)
- `going` — family member emails marked as attending (this is how PARENT
  attendance is tracked)
- `duties` — kid events only: `dropoff`/`pickup`, each `null` (unset) or
  `{assignee, is_na, caregiver}` (`is_na: true` = explicitly no drive needed;
  `caregiver` = a nanny/babysitter name like "Marina" or "Elias" who's doing
  it — tracked, but no drive block, same as N/A)
- `drive_block` — set on the auto-generated drive events on parents'
  calendars; points at the kid event it serves. Never edit drive blocks —
  they're managed automatically from the duty assignments.
- `conflicts_with` — ids of same-person events that overlap it

If freshness matters (e.g. before the morning brief), sync first:
`POST /api/agent/calendar/sync` (body `{"full": true}` for the heavyweight
pass that also refreshes every TeamSnap RSVP; omit for the quick one).

## What needs attention

```
GET /api/agent/calendar/review?days=14
```

One call returns the open problems:

- `conflicts` — pairs of overlapping events for the same person
- `missing_duties` — kid events away from home with drop-off and/or pick-up
  unassigned (`missing` lists which)
- `unanswered_teamsnap` — team events where the kid's RSVP is still no-reply
- `no_parent_going` — kid events where no parent is marked as going

Run this daily. For each item, propose a resolution to the parents (or apply
the obvious one if they've given standing instructions), then write it back
with the endpoints below.

## Writing

**Create an event** — lands on the member's real Google calendar when they
have one connected (`wrote_to_google` in the response says which):

```bash
curl -s -X POST -H "Authorization: Bearer $FAMILY_HQ_AGENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"title": "Dentist", "member_email": "oscar@mason.io",
       "start_time": "2026-06-15T14:00:00-05:00",
       "end_time": "2026-06-15T15:00:00-05:00",
       "location": "123 Main St"}' \
  "$FAMILY_HQ_URL/api/agent/calendar/events"
```

Optional: `"all_day": true`, `"description"`, and `"calendar"` — `"auto"`
(default: their primary Google calendar), `"app"` (app-only, no Google), or a
calendar source id from `/context`.

**Edit / delete:**

```
PATCH  /api/agent/calendar/events/<id>    {"title"?, "start_time"?, "end_time"?, "location"?, "description"?, "all_day"?}
DELETE /api/agent/calendar/events/<id>
```

TeamSnap and school (ICS) events can't be edited or deleted — they're synced
from their source and the API returns 409 explaining what to do instead (for
a skipped team event, set the RSVP to `not_going`).

**Parent attendance** ("Mom is going to the game"):

```
POST /api/agent/calendar/events/<id>/going    {"member_email": "jenny@mason.io", "going": true}
```

**Drop-off / pick-up:**

```
POST /api/agent/calendar/events/<id>/duty     {"duty": "dropoff", "assignment": "andrew@mason.io"}
POST /api/agent/calendar/events/<id>/duty     {"duty": "pickup",  "assignment": "Marina"}  # caregiver (nanny/babysitter)
POST /api/agent/calendar/events/<id>/duty     {"duty": "pickup",  "assignment": "na"}     # no drive needed
POST /api/agent/calendar/events/<id>/duty     {"duty": "pickup",  "assignment": null}     # clear back to unset
```

Only parents can be assigned, and only on kids' timed events away from home.
The app then creates/moves/deletes the drive blocks on that parent's Google
calendar by itself — including merging trips when one parent drives two kids,
and shortening to a one-way leg when the driving parent is marked going.

**Kid's TeamSnap RSVP:**

```
POST /api/agent/calendar/events/<id>/rsvp           {"status": "going"}   # or maybe / not_going
GET  /api/agent/calendar/events/<id>/availability    # whole-team roster + counts
```

The RSVP writes back to TeamSnap itself — the coach sees it there.

## Resolving things — playbook

- **Conflict**: tell the parents both events, ask which gives way (or apply
  their standing rule). Resolve by deleting/moving the losing event (if it's
  ours to move), or by setting the kid's RSVP to `not_going` for a skipped
  team event. Some "conflicts" are fine (a parent's reminder overlapping a
  drive block) — use judgment, don't thrash.
- **Missing drop-off/pick-up**: look at both parents' calendars around the
  event (this API shows them), propose who drives, confirm, then POST the
  duty. If the family is already at the venue or another family carpools,
  set `"na"`.
- **Unanswered TeamSnap RSVP**: ask whether the kid is going; POST the rsvp.
- **No parent going**: for games especially, ask which parent (if either) is
  attending and POST going for them. A parent marked going who also has the
  drive duty automatically gets a one-way drive block instead of round trips.

When a parent asks "what's our day/week look like", answer from
`GET /events` — include drive duties and who's going, not just times.
