# TeamSnap → Google Calendar importer

The calendar app materializes source events (TeamSnap, ICS) as **real Google
Calendar events** on each kid's own Google calendar, instead of only mirroring
them into `calendar_events` and serving an ICS feed. This gives:

- **Per-kid color** natively (each kid is a real Google calendar parents share).
- **No duplicate entries** — a parent who watches a kid's calendar and is marked
  "going" to an event sees one entry (real events share one identity; feeds copy).
- **Native "going" invites** — toggling a member "going" adds them as a Google
  guest, so the event lands on their own calendar with reminders.

`calendar_events` becomes a cache + augmentation sidecar + import ledger; the real
events live in Google.

## How it works

- Each importer source (`calendar_sources`, `source_type` teamsnap/ics) has an
  `import_destination_calendar_id` (the kid's Google calendar — their email) and
  `import_destination_connection` (the @mason.io user to act as). Defaults are
  backfilled to the owning kid; multiple sources can target one calendar.
- The full sync (cron + manual "Sync" button — **not** the page-load sync) calls
  `materializeSource`, which creates/patches/soft-cancels the real Google events
  via a service account using domain-wide delegation (DWD).
- "Going" is stored in `event_attendees` and reconciled to the event's native
  guest list (`reconcileEventGuests`).

Code: `src/lib/calendar/materialize.ts`, `google-dwd.ts`, and the
`GoogleCredential` layer in `google.ts`.

## Gating / rollout

The importer is dormant until **both** are true:

- `CALENDAR_IMPORTER_ENABLED=true`
- DWD is configured (`GOOGLE_SA_CLIENT_EMAIL` + `GOOGLE_SA_PRIVATE_KEY`)

With it off, sync behaves exactly as before (sidecar-only). Turn it on per
environment after the one-time Google setup below, ideally first on one kid with a
**clean** destination calendar (so the importer is the sole writer and there are
no pre-existing duplicates).

## One-time Google Workspace setup (domain-wide delegation)

1. **Google Cloud Console** → create (or reuse) a project → *IAM & Admin →
   Service Accounts* → **Create service account**. No project roles are needed.
2. On the service account, **Keys → Add key → JSON**. Download it. From the JSON
   you need `client_email` and `private_key`.
3. Note the service account's **Client ID** (Details → Advanced / "Unique ID").
4. **Enable the Google Calendar API** for the project (APIs & Services → Library).
5. **Admin Console** (admin.google.com, as a Workspace admin) → *Security → Access
   and data control → API controls → Manage Domain-Wide Delegation* → **Add new**:
   - Client ID: the service account's Client ID from step 3.
   - OAuth scopes: `https://www.googleapis.com/auth/calendar`
   - Authorize.
6. Set env vars (server-only):
   - `GOOGLE_SA_CLIENT_EMAIL` = the JSON's `client_email`
   - `GOOGLE_SA_PRIVATE_KEY` = the JSON's `private_key` (literal `\n` newlines are
     handled; or paste the real multi-line PEM)
   - `CALENDAR_IMPORTER_ENABLED=true`
7. **Share each kid's Google calendar** with the parents (Google Calendar settings
   → share with andrew@ / jenny@) so they see per-kid colors and can be guests.

To verify delegation works before enabling the importer, call
`mintDelegatedToken("oscar@mason.io")` (e.g. from a one-off script) and confirm it
returns a token.

## Safety properties (why it won't trash a calendar)

- **Deterministic Google event ids** → a retried/concurrent insert 409s instead of
  duplicating; partial failures recover.
- **Window-scoped + miss-counted soft-cancel** → events that age out of the window
  are never deleted, and a transient single-sync disappearance won't delete +
  re-create. Cancels are soft (recoverable), not hard deletes.
- **Per-source lease** (`materialize_claimed_at`) + per-event error isolation.
- **Feedback-loop guard** → materialized events carry a private
  `extendedProperties` marker; `google-sync` skips them, so a calendar that is both
  a destination and a read source won't re-ingest itself. Do **not** add a kid's
  destination calendar as a `source_type='google'` read source.
- **Notifications**: silent (`sendUpdates=none`) for guest-list churn; guests are
  notified only when a time/location change is patched.

## Known limitations / future work

- We don't read guest responses back from Google, so if a parent declines an event
  in Google (instead of toggling in-app), the importer may re-add them as a guest
  on a later sync. Toggling in-app is the supported path.
- Disabling a source (`is_active=false`) stops syncing but leaves its materialized
  events in place; deleting the source removes them.
- The outbound per-kid ICS feed has been **removed** (route, `ensureFeedToken`,
  `FeedLink`, and `ical.ts`) — family members get events natively via shared Google
  calendars. The `ical_feed_tokens` table is left in place, unused, and can be
  dropped in a later migration. Sharing a calendar with someone outside the
  Workspace is handled via Google's own calendar sharing.
