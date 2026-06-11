// The importer: materializes sidecar calendar_events rows as REAL Google events
// on the owning kid's Google calendar (via domain-wide delegation). Shared by the
// TeamSnap and ICS syncs. "TeamSnap owns whether an event exists; humans own
// going + augmentations" — so this is the sole writer of event existence/core
// fields on the destination calendar.
//
// Hardening baked in (see the plan's edge-case matrix):
//   * Deterministic Google event ids → insert 409s on duplicate, so concurrent
//     syncs / retries / partial failures can't create a second copy.
//   * extendedProperties stamp → a calendar that is both destination and read
//     source won't re-ingest its own events (google-sync filters on the marker).
//   * Window-scoped, miss-counted SOFT cancel → events that merely age out of the
//     window are never deleted, and a transient single-sync disappearance won't
//     delete + re-create (losing the guest list); only a sustained absence does.
//   * Partial-update patches omit attendees → the native guest list is preserved
//     and a guest's manual decline isn't clobbered on every sync.
//   * Per-source lease + per-event error isolation.

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  insertGoogleEvent,
  patchGoogleEvent,
  deleteGoogleEvent,
  getGoogleEvent,
  eventToGoogleBody,
  FAMILYHQ_MARKER,
  type GoogleCredential,
} from "./google";
import { isDwdConfigured } from "./google-dwd";

type AdminClient = ReturnType<typeof createAdminClient>;

// How far around "now" we keep Google in sync. Past events older than this are
// left untouched (created when they were in-window) — never deleted by aging.
const WINDOW_PAST_MS = 30 * 24 * 60 * 60 * 1000;
const WINDOW_FUTURE_MS = 365 * 24 * 60 * 60 * 1000;
// An absent event must be missing this long before we soft-cancel it (protects
// against a transient API blip dropping one event from a single fetch).
const MISS_THRESHOLD_MS = 60 * 60 * 1000;
// Only future-ish events are eligible for absence-cancellation; vanished past
// events are left in place (we don't retroactively delete history).
const ABSENCE_GRACE_MS = 24 * 60 * 60 * 1000;
const WRITE_CONCURRENCY = 6;
const LEASE_MS = 5 * 60 * 1000;

/** Whether the importer should run at all: explicitly enabled AND DWD configured. */
export function importerEnabled(): boolean {
  return process.env.CALENDAR_IMPORTER_ENABLED === "true" && isDwdConfigured();
}

export interface ImportDest {
  calendarId: string;
  cred: GoogleCredential;
}

/** Resolve a member's primary calendar into a destination + the credential to
 * write it with, or null if they haven't set one up. Managed members are written
 * via domain-wide delegation (impersonating them); connected members via their
 * own OAuth token. This is the single source of truth for "where do this member's
 * imports go." */
export async function getMemberPrimary(
  supabase: AdminClient,
  memberEmail: string | null,
): Promise<ImportDest | null> {
  if (!memberEmail) return null;
  const { data: m } = await supabase
    .from("family_members")
    .select(
      "primary_calendar_id, primary_calendar_connection, primary_calendar_mode",
    )
    .eq("email", memberEmail)
    .maybeSingle();
  if (!m?.primary_calendar_id || !m.primary_calendar_mode) return null;
  const connection = (m.primary_calendar_connection as string | null) ?? memberEmail;
  const cred: GoogleCredential =
    m.primary_calendar_mode === "connected"
      ? { kind: "oauth", memberEmail: connection }
      : { kind: "dwd", subjectEmail: connection };
  return { calendarId: m.primary_calendar_id as string, cred };
}

// ---------------------------------------------------------------------------
// Deterministic Google event ids. Google requires base32hex (0-9a-v), 5–1024
// chars. We hash the external_id → 20 bytes → 32 chars, so the same source event
// always maps to the same Google id. A duplicate insert then 409s instead of
// creating a second event.
// ---------------------------------------------------------------------------
const B32HEX = "0123456789abcdefghijklmnopqrstuv";

function base32hex(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32HEX[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32HEX[(value << (5 - bits)) & 31];
  return out;
}

export function deterministicEventId(externalId: string): string {
  const hash = createHash("sha256").update(externalId).digest().subarray(0, 20);
  return base32hex(hash);
}

// ---------------------------------------------------------------------------
// Field hashing. The combined hash decides whether to patch at all; the time/loc
// part (stored as a prefix) decides whether a patch should notify guests.
// A soft-cancelled event stores the CANCELLED sentinel so that, if it reappears,
// the hash differs and we re-confirm it.
// ---------------------------------------------------------------------------
const CANCELLED_HASH = "cancelled";

interface CoreFields {
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
}

function sha12(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

function hashes(
  row: CoreFields,
  title: string,
): { timeLoc: string; combined: string } {
  const timeLoc = sha12(
    JSON.stringify([row.start_time, row.end_time, row.all_day, row.location ?? null]),
  );
  const rest = sha12(JSON.stringify([title, row.description ?? null]));
  return { timeLoc, combined: `${timeLoc}.${rest}` };
}

function bodyFromRow(row: CoreFields, title: string): Record<string, unknown> {
  return {
    ...eventToGoogleBody({
      title,
      location: row.location,
      description: row.description,
      startTime: row.start_time,
      endTime: row.end_time,
      allDay: row.all_day,
    }),
    status: "confirmed",
  };
}

// Imported (TeamSnap/ICS) events get the calendar/team name prefixed onto their
// materialized title — e.g. "Ballers: Practice" — so they're distinguishable on a
// member's primary calendar in Google/Fantastical, where everything merges into
// one calendar with one color.
export function importTitlePrefix(source: {
  source_type?: string | null;
  nickname?: string | null;
  teamsnap_team_name?: string | null;
} | null): string | null {
  if (!source) return null;
  if (source.source_type === "teamsnap" || source.source_type === "ics") {
    return source.nickname ?? source.teamsnap_team_name ?? null;
  }
  return null;
}

function isHttp(err: unknown, code: number): boolean {
  return err instanceof Error && new RegExp(`error ${code}`).test(err.message);
}

// ---------------------------------------------------------------------------
// The row shape the materializer needs.
// ---------------------------------------------------------------------------
interface LedgerRow extends CoreFields {
  id: string;
  external_id: string | null;
  is_canceled: boolean;
  dismissed: boolean;
  google_event_id: string | null;
  google_sync_hash: string | null;
}

const LEDGER_COLUMNS =
  "id, external_id, title, description, location, start_time, end_time, all_day, is_canceled, dismissed, google_event_id, google_sync_hash";

/** The native guest list for an event, from the "going" toggles. Used only when
 * (re)creating an event — patches omit attendees so a guest's response and
 * manual changes are preserved (Google patch is a partial update). */
async function guestList(
  supabase: AdminClient,
  eventId: string,
): Promise<Array<{ email: string; responseStatus: string }>> {
  const { data } = await supabase
    .from("event_attendees")
    .select("member_email")
    .eq("event_id", eventId)
    .eq("going", true);
  return (data ?? []).map((r) => ({
    email: r.member_email as string,
    responseStatus: "accepted",
  }));
}

/** Create / patch / soft-cancel one event's real Google counterpart. */
async function materializeRow(
  supabase: AdminClient,
  cred: GoogleCredential,
  dest: ImportDest,
  row: LedgerRow,
  titlePrefix: string | null,
): Promise<void> {
  if (!row.external_id) return;
  // The user deleted this materialized event off their calendar — respect it:
  // don't recreate or touch it (it stays hidden via the dismissed flag).
  if (row.dismissed) return;
  const googleId = row.google_event_id ?? deterministicEventId(row.external_id);

  // Soft-cancel: keep the event (and its guests) on the calendar, marked
  // cancelled, so it's recoverable if the source restores it.
  if (row.is_canceled) {
    if (row.google_sync_hash === CANCELLED_HASH) return; // already cancelled
    try {
      await patchGoogleEvent(
        cred,
        dest.calendarId,
        googleId,
        { status: "cancelled" },
        { sendUpdates: "none" },
      );
    } catch (err) {
      if (!isHttp(err, 404) && !isHttp(err, 410)) throw err;
    }
    await supabase
      .from("calendar_events")
      .update({
        google_event_id: googleId,
        google_calendar_id: dest.calendarId,
        google_sync_hash: CANCELLED_HASH,
        google_synced_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return;
  }

  const title = titlePrefix ? `${titlePrefix}: ${row.title}` : row.title;
  const h = hashes(row, title);

  if (!row.google_event_id) {
    // CREATE with the deterministic id. Include the stamp + current guest list;
    // a 409 means a concurrent run / retry already created it, so patch instead.
    const createBody = {
      ...bodyFromRow(row, title),
      id: googleId,
      extendedProperties: { private: { [FAMILYHQ_MARKER]: row.id } },
      attendees: await guestList(supabase, row.id),
    };
    try {
      await insertGoogleEvent(cred, dest.calendarId, createBody, {
        sendUpdates: "none",
      });
    } catch (err) {
      if (isHttp(err, 409)) {
        await patchGoogleEvent(
          cred,
          dest.calendarId,
          googleId,
          bodyFromRow(row, title),
          { sendUpdates: "none" },
        );
      } else {
        throw err;
      }
    }
  } else if (row.google_sync_hash !== h.combined) {
    // PATCH only changed fields; omit attendees so the guest list is preserved.
    // Notify guests only when the time/location moved.
    const prevTimeLoc = (row.google_sync_hash ?? "").split(".")[0];
    const notify = !!prevTimeLoc && prevTimeLoc !== CANCELLED_HASH && prevTimeLoc !== h.timeLoc;
    await patchGoogleEvent(
      cred,
      dest.calendarId,
      row.google_event_id,
      bodyFromRow(row, title),
      { sendUpdates: notify ? "all" : "none" },
    );
  } else {
    return; // unchanged — no API call
  }

  await supabase
    .from("calendar_events")
    .update({
      google_event_id: googleId,
      google_calendar_id: dest.calendarId,
      google_sync_hash: h.combined,
      google_synced_at: new Date().toISOString(),
      google_missing_since: null,
    })
    .eq("id", row.id);
}

/** Mark events absent from the latest fetch: stamp first-miss, and soft-cancel
 * (locally) only future-ish events that have been missing past the threshold.
 * Past/aged-out events are never cancelled here. Also clears the miss stamp for
 * events that came back. */
export async function reconcileAbsentEvents(
  supabase: AdminClient,
  sourceId: string,
  presentExternalIds: Set<string>,
): Promise<void> {
  const now = Date.now();
  const graceIso = new Date(now - ABSENCE_GRACE_MS).toISOString();

  const { data: rows } = await supabase
    .from("calendar_events")
    .select("id, external_id, google_missing_since")
    .eq("calendar_source_id", sourceId)
    .eq("is_canceled", false)
    .gte("start_time", graceIso);

  const firstMiss: string[] = [];
  const cancel: string[] = [];
  const reappeared: string[] = [];

  for (const r of rows ?? []) {
    const ext = r.external_id as string | null;
    if (!ext) continue;
    if (presentExternalIds.has(ext)) {
      if (r.google_missing_since) reappeared.push(r.id as string);
      continue;
    }
    if (!r.google_missing_since) {
      firstMiss.push(r.id as string);
    } else if (now - new Date(r.google_missing_since).getTime() >= MISS_THRESHOLD_MS) {
      cancel.push(r.id as string);
    }
  }

  if (reappeared.length) {
    await supabase
      .from("calendar_events")
      .update({ google_missing_since: null })
      .in("id", reappeared);
  }
  if (firstMiss.length) {
    await supabase
      .from("calendar_events")
      .update({ google_missing_since: new Date(now).toISOString() })
      .in("id", firstMiss);
  }
  if (cancel.length) {
    await supabase
      .from("calendar_events")
      .update({ is_canceled: true })
      .in("id", cancel);
  }
}

/** Claim a short lease on the source so only one run materializes it at a time.
 * Returns false if another run currently holds it. */
async function claimSource(supabase: AdminClient, sourceId: string): Promise<boolean> {
  // Done via an RPC (a SECURITY DEFINER UPDATE … WHERE) rather than a supabase-js
  // conditional update: PostgREST rejects an `or=()` filter on a mutation, so the
  // null-or-stale check has to live in SQL. The function returns true only when it
  // actually took the lease.
  const { data } = await supabase.rpc("claim_calendar_source", {
    p_source_id: sourceId,
    p_lease_seconds: Math.round(LEASE_MS / 1000),
  });
  return data === true;
}

async function releaseSource(supabase: AdminClient, sourceId: string): Promise<void> {
  await supabase
    .from("calendar_sources")
    .update({ materialize_claimed_at: null })
    .eq("id", sourceId);
}

/** Materialize one source's window of events to its Google destination. Called
 * after the sidecar upsert, only from the full (cron/manual) sync. */
export async function materializeSource(
  supabase: AdminClient,
  sourceId: string,
  dest: ImportDest,
): Promise<{ errors: number }> {
  // Absence handling (reconcileAbsentEvents) is run by the caller before this, in
  // every sync mode. Here we just take the lease and write to Google.
  if (!(await claimSource(supabase, sourceId))) return { errors: 0 };

  const { data: src } = await supabase
    .from("calendar_sources")
    .select("source_type, nickname, teamsnap_team_name")
    .eq("id", sourceId)
    .maybeSingle();
  const titlePrefix = importTitlePrefix(src);

  let errors = 0;
  try {
    const now = Date.now();
    const minIso = new Date(now - WINDOW_PAST_MS).toISOString();
    const maxIso = new Date(now + WINDOW_FUTURE_MS).toISOString();

    const { data: rows } = await supabase
      .from("calendar_events")
      .select(LEDGER_COLUMNS)
      .eq("calendar_source_id", sourceId)
      .gte("start_time", minIso)
      .lte("start_time", maxIso);

    const cred = dest.cred;
    const list = (rows ?? []) as unknown as LedgerRow[];
    for (let i = 0; i < list.length; i += WRITE_CONCURRENCY) {
      await Promise.all(
        list.slice(i, i + WRITE_CONCURRENCY).map(async (row) => {
          try {
            await materializeRow(supabase, cred, dest, row, titlePrefix);
          } catch {
            errors += 1; // isolate: one bad event doesn't abort the rest
          }
        }),
      );
    }
  } finally {
    await releaseSource(supabase, sourceId);
  }

  return { errors };
}

/** Push an event's "going" toggles to its real Google event as the native guest
 * list. The live path behind setEventGoing. Replaces the whole attendees array
 * (so a removed member is dropped), with going members marked accepted. No-ops
 * for events that aren't materialized onto a delegated calendar. */
// The credential to write to a member's calendar: managed members via delegation,
// connected members via their own OAuth token.
export async function credForMember(
  supabase: AdminClient,
  memberEmail: string | null,
  connection: string,
): Promise<GoogleCredential> {
  if (memberEmail) {
    const { data: m } = await supabase
      .from("family_members")
      .select("primary_calendar_mode")
      .eq("email", memberEmail)
      .maybeSingle();
    if (m?.primary_calendar_mode === "managed") {
      return { kind: "dwd", subjectEmail: connection };
    }
  }
  return { kind: "oauth", memberEmail: connection };
}

export async function reconcileEventGuests(
  supabase: AdminClient,
  eventId: string,
): Promise<void> {
  const { data: ev } = await supabase
    .from("calendar_events")
    .select(
      "id, member_email, source_type, external_id, calendar_source_id, google_event_id, google_calendar_id",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) return;

  let googleEventId = ev.google_event_id as string | null;
  let calendarId = ev.google_calendar_id as string | null;
  let cred: GoogleCredential | null = null;

  if (googleEventId && calendarId) {
    // Importer-created event: write via the owning member's primary credential.
    const dest = await getMemberPrimary(supabase, ev.member_email as string | null);
    cred = dest?.cred ?? null;
  } else if (
    ev.source_type === "google" &&
    typeof ev.external_id === "string" &&
    ev.external_id.startsWith("google:") &&
    ev.calendar_source_id
  ) {
    // Event read in from a real Google calendar: derive its native identity from
    // the source so we can still attach guests (impersonating the calendar owner).
    googleEventId = ev.external_id.slice("google:".length);
    const { data: src } = await supabase
      .from("calendar_sources")
      .select("google_calendar_id, google_connection_email, member_email")
      .eq("id", ev.calendar_source_id)
      .maybeSingle();
    if (src?.google_calendar_id) {
      calendarId = src.google_calendar_id as string;
      const conn =
        (src.google_connection_email as string | null) ??
        (src.member_email as string | null);
      if (conn) {
        cred = await credForMember(
          supabase,
          src.member_email as string | null,
          conn,
        );
      }
    }
  }

  if (!googleEventId || !calendarId || !cred) return;

  // Merge our "going" toggles into the event's CURRENT guest list rather than
  // replacing it — so guests we don't track (someone invited directly in Google,
  // a coach) are never wiped when a family member toggles going.
  const currentEvent = await getGoogleEvent(cred, calendarId, googleEventId);
  if (!currentEvent) return;
  const byEmail = new Map<string, { email: string; responseStatus?: string }>();
  for (const a of currentEvent.attendees ?? []) {
    if (a.email) byEmail.set(a.email, { email: a.email, responseStatus: a.responseStatus });
  }
  const { data: rows } = await supabase
    .from("event_attendees")
    .select("member_email, going")
    .eq("event_id", eventId);
  for (const r of rows ?? []) {
    const email = r.member_email as string;
    if (r.going) {
      if (!byEmail.has(email)) byEmail.set(email, { email, responseStatus: "accepted" });
    } else {
      byEmail.delete(email);
    }
  }

  await patchGoogleEvent(
    cred,
    calendarId,
    googleEventId,
    { attendees: [...byEmail.values()] },
    { sendUpdates: "none" },
  );
}

/** Materialize a single event on demand (its owning member's primary calendar),
 * creating it with the current guest list. Used when a user toggles "going" on a
 * TeamSnap/ICS event that the full sync hasn't materialized yet, so the invite is
 * immediate rather than waiting for the next sync. Idempotent via the
 * deterministic id (a later full sync 409s and patches the same event). */
async function materializeEventById(
  supabase: AdminClient,
  eventId: string,
): Promise<void> {
  const { data: row } = await supabase
    .from("calendar_events")
    .select(`${LEDGER_COLUMNS}, member_email, calendar_source_id`)
    .eq("id", eventId)
    .maybeSingle();
  if (!row) return;
  const typed = row as { member_email: string | null; calendar_source_id: string | null };
  const dest = await getMemberPrimary(supabase, typed.member_email);
  if (!dest) return;

  let titlePrefix: string | null = null;
  if (typed.calendar_source_id) {
    const { data: src } = await supabase
      .from("calendar_sources")
      .select("source_type, nickname, teamsnap_team_name")
      .eq("id", typed.calendar_source_id)
      .maybeSingle();
    titlePrefix = importTitlePrefix(src);
  }
  await materializeRow(supabase, dest.cred, dest, row as unknown as LedgerRow, titlePrefix);
}

/** Apply the saved "going" list to Google for one event: materialize it first if
 * it's a TeamSnap/ICS event we haven't created yet, otherwise reconcile the guest
 * list on the existing real event. The entry point behind the "going" toggle. */
export async function syncEventGuests(
  supabase: AdminClient,
  eventId: string,
): Promise<void> {
  const { data: ev } = await supabase
    .from("calendar_events")
    .select("id, source_type, google_event_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) return;
  const isImporter = ev.source_type === "teamsnap" || ev.source_type === "ics";
  if (isImporter && !ev.google_event_id) {
    await materializeEventById(supabase, eventId);
  } else {
    await reconcileEventGuests(supabase, eventId);
  }
}

/** Delete every Google event this source materialized (used when the source is
 * removed, so real events aren't orphaned on the kid's calendar). Best-effort and
 * batched; deleteGoogleEvent already tolerates already-gone events. Safe to call
 * even when the importer is disabled — it no-ops without a destination. */
export async function cancelSourceMaterializations(
  supabase: AdminClient,
  source: { id: string; member_email: string | null },
): Promise<void> {
  if (!importerEnabled()) return;
  const dest = await getMemberPrimary(supabase, source.member_email);
  if (!dest) return;

  const { data: rows } = await supabase
    .from("calendar_events")
    .select("google_event_id")
    .eq("calendar_source_id", source.id)
    .not("google_event_id", "is", null);
  if (!rows?.length) return;

  for (let i = 0; i < rows.length; i += WRITE_CONCURRENCY) {
    await Promise.all(
      rows.slice(i, i + WRITE_CONCURRENCY).map(async (r) => {
        try {
          await deleteGoogleEvent(
            dest.cred,
            dest.calendarId,
            r.google_event_id as string,
            { sendUpdates: "none" },
          );
        } catch {
          // best-effort: a failed delete leaves a recoverable event, not data loss
        }
      }),
    );
  }
}
