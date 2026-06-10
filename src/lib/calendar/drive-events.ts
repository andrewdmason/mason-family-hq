// Drive-block orchestration: keeps each duty assignment's round-trip drive
// event in sync with reality — a REAL Google event on the assigned parent's
// primary calendar plus a local mirror row (rendered in the kid's color, tap-
// through to the kid's event).
//
// Same hardening as the importer (materialize.ts): deterministic Google ids
// (concurrent reconciles 409 → patch), an extendedProperties stamp so the
// parent's own read sync never re-ingests the block, and a sync hash so the
// cron sweep only touches Google when something actually moved. The live
// setEventDuty action and the cron sweep both funnel through reconcile — the
// sweep is the safety net when a background reconcile dies mid-flight.

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  insertGoogleEvent,
  patchGoogleEvent,
  deleteGoogleEvent,
  FAMILYHQ_MARKER,
} from "./google";
import { getMemberPrimary, deterministicEventId, type ImportDest } from "./materialize";
import { isHomeLocation } from "./calendar-utils";
import { getLogisticsSettings, type LogisticsSettings } from "./drive-time";
import {
  driveBlockWindow,
  driveEventTitle,
  FALLBACK_DRIVE_MINUTES,
  COMBINE_GAP_MINUTES,
  type Duty,
} from "./drive-window";

type AdminClient = ReturnType<typeof createAdminClient>;

export { driveBlockWindow, driveEventTitle, type Duty };

// The cron sweep only reconciles assignments whose source event is near/ahead
// of now — finished events keep their (historical) blocks untouched.
const SWEEP_PAST_MS = 2 * 60 * 60 * 1000;
const SWEEP_FUTURE_MS = 60 * 24 * 60 * 60 * 1000;
const SWEEP_CONCURRENCY = 4;

export const ASSIGNMENT_COLUMNS =
  "id, event_id, duty, assignee_email, is_na, drive_event_id, drive_google_event_id, drive_calendar_id, drive_sync_hash, drive_is_estimate";

export interface DutyAssignmentRow {
  id: string;
  event_id: string;
  duty: Duty;
  assignee_email: string | null;
  is_na: boolean;
  drive_event_id: string | null;
  drive_google_event_id: string | null;
  drive_calendar_id: string | null;
  drive_sync_hash: string | null;
  drive_is_estimate: boolean;
}

const SOURCE_EVENT_COLUMNS =
  "id, member_email, title, location, start_time, end_time, all_day, is_canceled, dismissed, teamsnap_arrival_time, drive_minutes";

interface SourceEventRow {
  id: string;
  member_email: string | null;
  title: string;
  location: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
  is_canceled: boolean;
  dismissed: boolean;
  teamsnap_arrival_time: string | null;
  drive_minutes: number | null;
}

// Block math + titles live in drive-window.ts (client-safe, shared with the
// calendar client's ghost blocks); re-exported above for server callers.

function sha12(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

function isHttp(err: unknown, codes: RegExp): boolean {
  return err instanceof Error && codes.test(err.message);
}

// ---------------------------------------------------------------------------
// Lookups.
// ---------------------------------------------------------------------------
async function kidFirstName(
  supabase: AdminClient,
  memberEmail: string | null,
): Promise<string> {
  if (!memberEmail) return "kid";
  const { data: m } = await supabase
    .from("family_members")
    .select("name")
    .eq("email", memberEmail)
    .maybeSingle();
  const name = (m?.name as string | null) ?? memberEmail.split("@")[0];
  return name.split(" ")[0];
}

/** The credential to delete a block from a calendar we previously wrote to —
 * resolved from whichever member has it as their primary (handles the
 * reassigned-to-the-other-parent case, where the assignment row no longer
 * names the old parent). */
async function destForCalendarId(
  supabase: AdminClient,
  calendarId: string,
): Promise<ImportDest | null> {
  const { data: m } = await supabase
    .from("family_members")
    .select("email")
    .eq("primary_calendar_id", calendarId)
    .maybeSingle();
  if (!m?.email) return null;
  return getMemberPrimary(supabase, m.email as string);
}

// ---------------------------------------------------------------------------
// Delete: Google first, then the mirror, then the ledger — so a failure leaves
// a recoverable extra event rather than an orphaned Google block.
// ---------------------------------------------------------------------------
export async function deleteDriveEvent(
  supabase: AdminClient,
  assignment: DutyAssignmentRow,
): Promise<void> {
  if (assignment.drive_google_event_id && assignment.drive_calendar_id) {
    const dest = await destForCalendarId(supabase, assignment.drive_calendar_id);
    if (dest) {
      await deleteGoogleEvent(
        dest.cred,
        assignment.drive_calendar_id,
        assignment.drive_google_event_id,
        { sendUpdates: "none" },
      );
    }
  }
  await supabase
    .from("calendar_events")
    .delete()
    .eq("drive_source_event_id", assignment.event_id)
    .eq("drive_duty", assignment.duty);
  await supabase
    .from("event_duty_assignments")
    .update({
      drive_event_id: null,
      drive_google_event_id: null,
      drive_calendar_id: null,
      drive_sync_hash: null,
      drive_synced_at: null,
      drive_is_estimate: false,
    })
    .eq("id", assignment.id);
}

// ---------------------------------------------------------------------------
// Reconcile: compute each duty's desired block, then write it. Computed per
// EVENT (not per assignment) because the two duties interact — the same parent
// doing both with no real time at home in between gets ONE combined block
// (they're effectively attending the event), not two overlapping round trips.
// ---------------------------------------------------------------------------
type DesiredBlock =
  | { exists: false }
  | {
      exists: true;
      window: { start: string; end: string };
      title: string;
      isEstimate: boolean;
    };

function desiredFor(
  a: DutyAssignmentRow,
  sibling: DutyAssignmentRow | null,
  event: SourceEventRow | null,
  settings: LogisticsSettings | null,
  kidName: string,
): DesiredBlock {
  const shouldExist =
    !!a.assignee_email &&
    !!event &&
    !event.is_canceled &&
    !event.dismissed &&
    !event.all_day &&
    // An event AT home needs no driving — even if a duty was assigned before
    // the location changed (the sweep tears stale blocks down through here).
    !isHomeLocation(event.location, settings?.homeAddress);
  if (!shouldExist) return { exists: false };
  const ev = event as SourceEventRow;

  const bufferMinutes = settings?.bufferMinutes ?? 5;
  const driveMinutes = ev.drive_minutes ?? FALLBACK_DRIVE_MINUTES;
  const isEstimate = ev.drive_minutes == null;
  const windowArgs = {
    startTime: ev.start_time,
    endTime: ev.end_time,
    teamsnapArrivalTime: ev.teamsnap_arrival_time,
    driveMinutes,
    bufferMinutes,
  };

  // Same parent on both duties: if the time at home between returning from
  // drop-off and leaving for pick-up is under the threshold, combine.
  if (sibling?.assignee_email && sibling.assignee_email === a.assignee_email) {
    const dropW = driveBlockWindow({ duty: "dropoff", ...windowArgs });
    const pickW = driveBlockWindow({ duty: "pickup", ...windowArgs });
    const gapMin =
      (new Date(pickW.start).getTime() - new Date(dropW.end).getTime()) /
      60_000;
    if (gapMin < COMBINE_GAP_MINUTES) {
      // The combined block lives on the DROPOFF assignment's ledger; the
      // pickup assignment stays saved but materializes nothing.
      if (a.duty === "pickup") return { exists: false };
      const window = { start: dropW.start, end: pickW.end };
      return {
        exists: true,
        window,
        title: driveEventTitle({
          duty: "combined",
          kidName,
          driveMinutes,
          isEstimate,
        }),
        isEstimate,
      };
    }
  }

  const window = driveBlockWindow({ duty: a.duty, ...windowArgs });
  return {
    exists: true,
    window,
    title: driveEventTitle({
      duty: a.duty,
      kidName,
      driveMinutes,
      isEstimate,
    }),
    isEstimate,
  };
}

async function writeDesired(
  supabase: AdminClient,
  a: DutyAssignmentRow,
  event: SourceEventRow | null,
  desired: DesiredBlock,
): Promise<void> {
  if (!desired.exists) {
    // Unset/N/A, folded into the combined block, or the source event went
    // away — tear this duty's block down. The assignment row survives a
    // soft-cancel, so a restored event re-creates it.
    if (a.drive_google_event_id || a.drive_event_id) {
      await deleteDriveEvent(supabase, a);
    }
    return;
  }
  const ev = event as SourceEventRow;
  const { window, title, isEstimate } = desired;

  const dest = a.assignee_email
    ? await getMemberPrimary(supabase, a.assignee_email)
    : null;
  const destCalendarId = dest?.calendarId ?? null;

  const hash = sha12(
    JSON.stringify([window.start, window.end, title, destCalendarId, a.assignee_email]),
  );
  if (hash === a.drive_sync_hash) return; // unchanged — no API calls

  // The assignee is part of the id: Google tombstones deleted event ids, so
  // a block that moved between parents' calendars (delete + insert) must
  // mint a fresh id rather than reuse the old parent's dead one.
  const googleId = dest
    ? deterministicEventId(`drive:${a.duty}:${a.event_id}:${a.assignee_email}`)
    : null;

  // Reassigned (or the assignee's primary calendar changed): remove the block
  // from wherever it used to live before writing the new one — covers a
  // calendar move AND an id change on the same calendar (else it lingers as a
  // duplicate).
  if (
    a.drive_google_event_id &&
    a.drive_calendar_id &&
    (a.drive_calendar_id !== destCalendarId ||
      a.drive_google_event_id !== googleId)
  ) {
    const oldDest = await destForCalendarId(supabase, a.drive_calendar_id);
    if (oldDest) {
      await deleteGoogleEvent(
        oldDest.cred,
        a.drive_calendar_id,
        a.drive_google_event_id,
        { sendUpdates: "none" },
      );
    }
    a = { ...a, drive_google_event_id: null, drive_calendar_id: null };
  }

  // Write the Google block. Skipped (mirror only) when the parent has no
  // primary calendar yet — the sweep retries once they connect one.
  if (dest && googleId) {
    const body: Record<string, unknown> = {
      summary: title,
      location: ev.location ?? undefined,
      start: { dateTime: window.start },
      end: { dateTime: window.end },
      // Explicit, so patching a tombstoned id (same parent unset → re-set)
      // revives the cancelled event instead of leaving it hidden.
      status: "confirmed",
      extendedProperties: { private: { [FAMILYHQ_MARKER]: `drive:${a.id}` } },
    };
    if (a.drive_google_event_id === googleId && a.drive_calendar_id === dest.calendarId) {
      try {
        await patchGoogleEvent(dest.cred, dest.calendarId, googleId, body, {
          sendUpdates: "none",
        });
      } catch (err) {
        // The parent deleted it by hand in Google — recreate (assignment is
        // the source of truth).
        if (!isHttp(err, /error 4(04|10)/)) throw err;
        await insertGoogleEvent(
          dest.cred,
          dest.calendarId,
          { ...body, id: googleId },
          { sendUpdates: "none" },
        );
      }
    } else {
      try {
        await insertGoogleEvent(
          dest.cred,
          dest.calendarId,
          { ...body, id: googleId },
          { sendUpdates: "none" },
        );
      } catch (err) {
        // 409: a concurrent reconcile already created it (deterministic id).
        // 410: the id is a tombstone of an earlier deleted block on this same
        // calendar. Either way, patch — status:"confirmed" revives it.
        if (!isHttp(err, /error 4(09|10)/)) throw err;
        await patchGoogleEvent(dest.cred, dest.calendarId, googleId, body, {
          sendUpdates: "none",
        });
      }
    }
  }

  // Local mirror row: what the calendar UI renders (kid color + tap-through
  // come from drive_source_event_id). Upsert keyed by (source event, duty).
  const { data: mirror } = await supabase
    .from("calendar_events")
    .upsert(
      {
        member_email: a.assignee_email,
        source_type: "manual",
        title,
        description: null,
        location: ev.location,
        start_time: window.start,
        end_time: window.end,
        all_day: false,
        google_event_id: googleId,
        google_calendar_id: destCalendarId,
        drive_source_event_id: a.event_id,
        drive_duty: a.duty,
        is_canceled: false,
        dismissed: false,
      },
      { onConflict: "drive_source_event_id,drive_duty" },
    )
    .select("id")
    .maybeSingle();

  await supabase
    .from("event_duty_assignments")
    .update({
      drive_event_id: (mirror?.id as string | undefined) ?? a.drive_event_id,
      drive_google_event_id: googleId,
      drive_calendar_id: destCalendarId,
      drive_sync_hash: hash,
      drive_synced_at: new Date().toISOString(),
      drive_is_estimate: isEstimate,
    })
    .eq("id", a.id);
}

/** Reconcile both of an event's duty assignments together (combination is a
 * property of the pair, not of either duty alone). */
async function reconcileEventLoaded(
  supabase: AdminClient,
  rows: DutyAssignmentRow[],
  ev: SourceEventRow | null,
  settings: LogisticsSettings | null,
): Promise<void> {
  if (!rows.length) return;
  const kidName = ev ? await kidFirstName(supabase, ev.member_email) : "";
  for (const a of rows) {
    const sibling = rows.find((r) => r.duty !== a.duty) ?? null;
    const desired = desiredFor(a, sibling, ev, settings, kidName);
    await writeDesired(supabase, a, ev, desired);
  }
}

// Per-event serialization for the deferred (after()) drive work. Duty taps are
// non-blocking, so several reconciles for one event can be in flight at once;
// chaining them prevents interleaved Google writes from orphaning a block.
// Each queued run re-reads current assignment state, so intermediate clicks
// collapse into the final one. In-process only — concurrent serverless
// instances still rely on the deterministic-id/409 hardening + the cron sweep.
const driveWorkQueues = new Map<string, Promise<void>>();

export function queueDriveWork(
  eventId: string,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = driveWorkQueues.get(eventId) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run regardless of the predecessor's fate
  driveWorkQueues.set(eventId, next);
  void next.finally(() => {
    if (driveWorkQueues.get(eventId) === next) driveWorkQueues.delete(eventId);
  });
  return next;
}

/** Reconcile one event's drive blocks. The live path behind setEventDuty;
 * idempotent, safe to call after any assignment change (assigning the second
 * duty to the same parent collapses two blocks into one; clearing one expands
 * the combined block back out). */
export async function reconcileEventDrive(
  supabase: AdminClient,
  eventId: string,
): Promise<void> {
  const { data: rows } = await supabase
    .from("event_duty_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("event_id", eventId);
  if (!rows?.length) return;

  const { data: ev } = await supabase
    .from("calendar_events")
    .select(SOURCE_EVENT_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();

  const settings = await getLogisticsSettings(supabase);
  await reconcileEventLoaded(
    supabase,
    rows as unknown as DutyAssignmentRow[],
    (ev as unknown as SourceEventRow) ?? null,
    settings,
  );
}

/** The cron sweep: reconcile every assignment whose source event is upcoming
 * (or just finished). Hash short-circuits make untouched assignments cheap; a
 * change that landed via sync (moved time, new location, recalculated drive
 * minutes) gets its block patched here. */
export async function reconcileAllDriveEvents(
  supabase: AdminClient,
): Promise<{ reconciled: number; errors: number }> {
  const settings = await getLogisticsSettings(supabase);

  const { data: assignments } = await supabase
    .from("event_duty_assignments")
    .select(ASSIGNMENT_COLUMNS);
  if (!assignments?.length) return { reconciled: 0, errors: 0 };

  const eventIds = [...new Set(assignments.map((a) => a.event_id as string))];
  const { data: events } = await supabase
    .from("calendar_events")
    .select(SOURCE_EVENT_COLUMNS)
    .in("id", eventIds);
  const byId = new Map(
    ((events ?? []) as unknown as SourceEventRow[]).map((e) => [e.id, e]),
  );

  // Group by event — the two duties reconcile together (combined-block rule).
  const now = Date.now();
  const byEvent = new Map<string, DutyAssignmentRow[]>();
  for (const a of assignments as unknown as DutyAssignmentRow[]) {
    const ev = byId.get(a.event_id);
    if (!ev) continue;
    const t = new Date(ev.start_time).getTime();
    if (t < now - SWEEP_PAST_MS || t > now + SWEEP_FUTURE_MS) continue;
    (byEvent.get(a.event_id) ?? byEvent.set(a.event_id, []).get(a.event_id)!).push(a);
  }
  const work = [...byEvent.entries()];

  let reconciled = 0;
  let errors = 0;
  for (let i = 0; i < work.length; i += SWEEP_CONCURRENCY) {
    await Promise.all(
      work.slice(i, i + SWEEP_CONCURRENCY).map(async ([eventId, rows]) => {
        try {
          await reconcileEventLoaded(
            supabase,
            rows,
            byId.get(eventId) ?? null,
            settings,
          );
          reconciled += rows.length;
        } catch (err) {
          // isolate: one bad event doesn't abort the sweep — but say why,
          // or a deterministic failure looks like "the block never appeared"
          errors += 1;
          console.error(
            `[drive] reconcile failed for event ${eventId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }),
    );
  }
  return { reconciled, errors };
}
