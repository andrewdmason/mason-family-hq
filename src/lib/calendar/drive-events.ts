// Drive-block orchestration: keeps each duty assignment's round-trip drive
// event in sync with reality — a REAL Google event on the assigned parent's
// primary calendar plus a local mirror row (rendered in the kid's color, tap-
// through to the kid's event).
//
// Reconciliation is scope-based, not per-assignment, because blocks interact
// at two levels: within one event, the same parent holding both duties with no
// real time at home between them gets ONE combined (↔) block; and ACROSS
// events, the same parent's same-direction blocks that overlap or nearly touch
// (dropping two kids at different practices) merge into one multi-stop block
// (drive-window.ts clusterDriveBlocks) owned by the earliest stop's
// assignment, first stop in the location field and the full stop list in the
// description.
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
  clusterDriveBlocks,
  FALLBACK_DRIVE_MINUTES,
  COMBINE_GAP_MINUTES,
  type Duty,
  type DriveCluster,
  type PlannedDriveBlock,
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
/** First names for every member at once — a reconcile scope spans several
 * kids' events, and the table is tiny. */
async function loadFirstNames(
  supabase: AdminClient,
): Promise<Map<string, string>> {
  const { data } = await supabase.from("family_members").select("email, name");
  return new Map(
    ((data ?? []) as { email: string; name: string | null }[]).map((m) => [
      m.email,
      (m.name ?? m.email.split("@")[0]).split(" ")[0],
    ]),
  );
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
// Reconcile: compute each duty's desired block, then write it. Computed over a
// SCOPE of events (not per assignment) because blocks interact — within one
// event, the same parent doing both duties with no real time at home in
// between gets ONE combined block (they're effectively attending the event);
// across events, the same parent's overlapping same-direction blocks merge
// into one multi-stop block.
// ---------------------------------------------------------------------------
type DesiredBlock =
  | { exists: false }
  | {
      exists: true;
      kind: Duty | "combined";
      window: { start: string; end: string };
      /** Stop instant (drop-off arrival anchor / pick-up end) — feeds the
       * merged block's stop-list description. */
      anchor: string;
      title: string;
      location: string | null;
      description: string | null;
      kidName: string;
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

  const dropAnchor = ev.teamsnap_arrival_time ?? ev.start_time;
  const pickAnchor = ev.end_time ?? ev.start_time;

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
        kind: "combined",
        window,
        anchor: dropAnchor,
        title: driveEventTitle({
          duty: "combined",
          kidName,
          driveMinutes,
          isEstimate,
        }),
        location: ev.location,
        description: null,
        kidName,
        isEstimate,
      };
    }
  }

  const window = driveBlockWindow({ duty: a.duty, ...windowArgs });
  return {
    exists: true,
    kind: a.duty,
    window,
    anchor: a.duty === "dropoff" ? dropAnchor : pickAnchor,
    title: driveEventTitle({
      duty: a.duty,
      kidName,
      driveMinutes,
      isEstimate,
    }),
    location: ev.location,
    description: null,
    kidName,
    isEstimate,
  };
}

async function writeDesired(
  supabase: AdminClient,
  a: DutyAssignmentRow,
  desired: DesiredBlock,
): Promise<void> {
  if (!desired.exists) {
    // Unset/N/A, folded into a combined or merged block, or the source event
    // went away — tear this duty's block down. The assignment row survives a
    // soft-cancel, so a restored event re-creates it.
    if (a.drive_google_event_id || a.drive_event_id) {
      await deleteDriveEvent(supabase, a);
    }
    return;
  }
  const { window, title, location, description, isEstimate } = desired;

  const dest = a.assignee_email
    ? await getMemberPrimary(supabase, a.assignee_email)
    : null;
  const destCalendarId = dest?.calendarId ?? null;

  const hash = sha12(
    JSON.stringify([
      window.start,
      window.end,
      title,
      location,
      description,
      destCalendarId,
      a.assignee_email,
    ]),
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
      // Explicit nulls (not undefined): a merged block that reverts to solo
      // must CLEAR the stop-list description on patch, not keep the stale one.
      location,
      description,
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
        description,
        location,
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

// Stop-list description for a merged multi-stop block — read in Google
// Calendar, where the location field only fits the first stop. Times are
// formatted in the family's home timezone (every stop is local).
const FAMILY_TZ = process.env.FAMILY_TIMEZONE || "America/Los_Angeles";

function stopsDescription(cluster: DriveCluster): string {
  const label =
    cluster.members[0].duty === "dropoff" ? "Drop-offs" : "Pick-ups";
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: FAMILY_TZ,
    hour: "numeric",
    minute: "2-digit",
  });
  const lines = cluster.members.map(
    (m, i) =>
      `${i + 1}. ${fmt.format(new Date(m.anchor))} ${m.kidName}${
        m.location ? ` — ${m.location}` : ""
      }`,
  );
  return [`${label}:`, ...lines].join("\n");
}

interface ScopeItem {
  a: DutyAssignmentRow;
  ev: SourceEventRow | null;
}

/** Reconcile a scope of assignments together: the per-event pass first (the
 * drop/pick combine is a property of the event's pair), then the cross-event
 * merge pass (same parent, same direction, windows that overlap or nearly
 * touch → one multi-stop block, owned by the earliest stop's assignment),
 * then the writes. Hash short-circuits make untouched assignments free, so a
 * scope can be generous. */
async function reconcileScope(
  supabase: AdminClient,
  items: ScopeItem[],
  settings: LogisticsSettings | null,
): Promise<{ reconciled: number; errors: number }> {
  if (!items.length) return { reconciled: 0, errors: 0 };
  const names = await loadFirstNames(supabase);

  const byEvent = new Map<string, ScopeItem[]>();
  for (const it of items) {
    const list = byEvent.get(it.a.event_id);
    if (list) list.push(it);
    else byEvent.set(it.a.event_id, [it]);
  }

  const desired = new Map<string, DesiredBlock>();
  for (const group of byEvent.values()) {
    for (const it of group) {
      const sibling = group.find((o) => o.a.duty !== it.a.duty)?.a ?? null;
      const kidName =
        (it.ev?.member_email && names.get(it.ev.member_email)) ||
        it.ev?.member_email?.split("@")[0] ||
        "kid";
      desired.set(it.a.id, desiredFor(it.a, sibling, it.ev, settings, kidName));
    }
  }

  // Cross-event merge: fold each multi-stop cluster into its owner's desired
  // block; the other members materialize nothing (their ledgers tear down,
  // and they re-expand to solo blocks whenever the cluster breaks up).
  const planned: PlannedDriveBlock[] = [];
  for (const it of items) {
    const d = desired.get(it.a.id);
    if (!d?.exists || !it.a.assignee_email) continue;
    planned.push({
      key: it.a.id,
      assignee: it.a.assignee_email,
      duty: d.kind,
      kidName: d.kidName,
      location: d.location,
      window: d.window,
      title: d.title,
      anchor: d.anchor,
      isEstimate: d.isEstimate,
    });
  }
  for (const cluster of clusterDriveBlocks(planned)) {
    if (cluster.members.length < 2) continue;
    const owner = cluster.members[0];
    const od = desired.get(owner.key);
    if (!od?.exists) continue; // owners only come from exists blocks
    desired.set(owner.key, {
      ...od,
      window: cluster.window,
      title: cluster.title,
      location: cluster.location,
      description: stopsDescription(cluster),
      isEstimate: cluster.isEstimate,
    });
    for (const m of cluster.members.slice(1)) {
      desired.set(m.key, { exists: false });
    }
  }

  let reconciled = 0;
  let errors = 0;
  for (let i = 0; i < items.length; i += SWEEP_CONCURRENCY) {
    await Promise.all(
      items.slice(i, i + SWEEP_CONCURRENCY).map(async (it) => {
        try {
          await writeDesired(supabase, it.a, desired.get(it.a.id)!);
          reconciled += 1;
        } catch (err) {
          // isolate: one bad assignment doesn't abort the scope — but say why,
          // or a deterministic failure looks like "the block never appeared"
          errors += 1;
          console.error(
            `[drive] reconcile failed for event ${it.a.event_id} (${it.a.duty}):`,
            err instanceof Error ? err.message : err,
          );
        }
      }),
    );
  }
  return { reconciled, errors };
}

// Serialize ALL deferred (after()) drive work in-process. Duty taps are
// non-blocking, so several reconciles can be in flight at once, and a
// reconcile now reshapes blocks across NEIGHBORING events (cross-event merge),
// so per-event queues no longer isolate writes — family-scale tap volume makes
// one global chain free. Each queued run re-reads current assignment state, so
// intermediate clicks collapse into the final one. In-process only —
// concurrent serverless instances still rely on the deterministic-id/409
// hardening + the cron sweep.
let driveWorkChain: Promise<void> = Promise.resolve();

export function queueDriveWork(fn: () => Promise<void>): Promise<void> {
  const next = driveWorkChain.then(fn, fn); // run regardless of the predecessor's fate
  driveWorkChain = next;
  return next;
}

// Cross-event merging means one assignment's change can reshape a neighbor
// event's block, so the live reconcile loads everything in a window around the
// trigger event rather than just its own pair.
const NEIGHBORHOOD_MS = 24 * 60 * 60 * 1000;

/** Reconcile every duty assignment whose source event starts within a day of
 * the given instant. Also the after-delete hook: when a source event is
 * removed, its old merge partners re-expand to solo blocks through here. */
export async function reconcileDriveAround(
  supabase: AdminClient,
  isoStart: string,
): Promise<void> {
  const t = new Date(isoStart).getTime();
  const { data: events } = await supabase
    .from("calendar_events")
    .select(SOURCE_EVENT_COLUMNS)
    .gte("start_time", new Date(t - NEIGHBORHOOD_MS).toISOString())
    .lte("start_time", new Date(t + NEIGHBORHOOD_MS).toISOString())
    .is("drive_source_event_id", null);
  if (!events?.length) return;
  const evs = events as unknown as SourceEventRow[];

  const { data: rows } = await supabase
    .from("event_duty_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .in(
      "event_id",
      evs.map((e) => e.id),
    );
  if (!rows?.length) return;

  const settings = await getLogisticsSettings(supabase);
  const byId = new Map(evs.map((e) => [e.id, e]));
  await reconcileScope(
    supabase,
    (rows as unknown as DutyAssignmentRow[]).map((a) => ({
      a,
      ev: byId.get(a.event_id) ?? null,
    })),
    settings,
  );
}

/** Reconcile one event's drive blocks (and its neighborhood — see above). The
 * live path behind setEventDuty; idempotent, safe to call after any assignment
 * change (assigning the second duty to the same parent collapses two blocks
 * into one; clearing one expands a combined or merged block back out). */
export async function reconcileEventDrive(
  supabase: AdminClient,
  eventId: string,
): Promise<void> {
  const { data: ev } = await supabase
    .from("calendar_events")
    .select(SOURCE_EVENT_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();
  if (ev) {
    await reconcileDriveAround(
      supabase,
      (ev as unknown as SourceEventRow).start_time,
    );
    return;
  }

  // Source event gone — tear down whatever its assignments still hold.
  const { data: rows } = await supabase
    .from("event_duty_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("event_id", eventId);
  if (!rows?.length) return;
  const settings = await getLogisticsSettings(supabase);
  await reconcileScope(
    supabase,
    (rows as unknown as DutyAssignmentRow[]).map((a) => ({ a, ev: null })),
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

  // Scope to near/ahead-of-now events. Clusters compute within this window
  // only — a merge partner that just aged past the cutoff stops participating,
  // which is fine: events that old no longer change.
  const now = Date.now();
  const items: ScopeItem[] = [];
  for (const a of assignments as unknown as DutyAssignmentRow[]) {
    const ev = byId.get(a.event_id);
    if (!ev) continue;
    const t = new Date(ev.start_time).getTime();
    if (t < now - SWEEP_PAST_MS || t > now + SWEEP_FUTURE_MS) continue;
    items.push({ a, ev });
  }
  return reconcileScope(supabase, items, settings);
}
