// Sync ICS subscription sources (school calendars, a personal Google calendar,
// etc.) into calendar_events. Adapted from KidCalendar: scoped to member_email
// instead of family_id/kid_id, writing to calendar_events under the service-role
// client. The lightweight RFC 5545 parser is unchanged (no external dependency).

import { createAdminClient } from "@/lib/supabase/admin";
import {
  importerEnabled,
  getMemberPrimary,
  reconcileAbsentEvents,
  materializeSource,
} from "./materialize";

interface IcsEvent {
  uid: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  dtstart: string | null;
  dtend: string | null;
  status: string | null;
  allDay: boolean;
}

function parseIcsText(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  const blocks = text.split("BEGIN:VEVENT");

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split("END:VEVENT")[0];
    if (!block) continue;

    const uid = extractField(block, "UID");
    const dtstart = extractField(block, "DTSTART");
    if (!uid || !dtstart) continue;

    const dtstartRaw = extractFieldRaw(block, "DTSTART");
    const allDay =
      /VALUE=DATE[^-]/.test(dtstartRaw?.params ?? "") ||
      (dtstart.length === 8 && !dtstart.includes("T"));

    events.push({
      uid,
      summary: extractField(block, "SUMMARY"),
      description: extractField(block, "DESCRIPTION"),
      location: extractField(block, "LOCATION"),
      dtstart: toIsoDate(dtstart),
      dtend: toIsoDate(extractField(block, "DTEND")),
      status: extractField(block, "STATUS"),
      allDay,
    });
  }

  return events;
}

function extractField(block: string, field: string): string | null {
  const regex = new RegExp(`^${field}[;:](.*)`, "m");
  const match = block.match(regex);
  if (!match) return null;
  let value = match[1];
  if (match[0].includes(";") && value.includes(":")) {
    value = value.substring(value.indexOf(":") + 1);
  }
  value = value.replace(/\r?\n[ \t]/g, "");
  value = value
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\\\/g, "\\");
  return value.trim() || null;
}

function extractFieldRaw(
  block: string,
  field: string,
): { params: string; value: string } | null {
  const regex = new RegExp(`^(${field}[;:].*)`, "m");
  const match = block.match(regex);
  if (!match) return null;
  const line = match[1].replace(/\r?\n[ \t]/g, "");
  const colonIdx = line.indexOf(":", field.length);
  return {
    params: line.substring(field.length, colonIdx),
    value: line.substring(colonIdx + 1).trim(),
  };
}

function toIsoDate(value: string | null): string | null {
  if (!value) return null;
  if (value.length === 8 && /^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`;
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || "Z"}`;
  }
  return value;
}

// ============================================================
// Sync a single ICS calendar source
// ============================================================

export async function syncIcsSource(
  calendarSourceId: string,
  opts: { materialize?: boolean } = {},
): Promise<{ synced: number; error?: string }> {
  const supabase = createAdminClient();

  const { data: source, error: sourceError } = await supabase
    .from("calendar_sources")
    .select("id, member_email, ics_url, nickname")
    .eq("id", calendarSourceId)
    .single();

  if (sourceError || !source) {
    return { synced: 0, error: "Calendar source not found" };
  }
  if (!source.ics_url) {
    return { synced: 0, error: "Missing ICS URL" };
  }

  let icsEvents: IcsEvent[];
  try {
    const fetchUrl = source.ics_url.replace(/^webcal:\/\//, "https://");
    const response = await fetch(fetchUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const text = await response.text();
    icsEvents = parseIcsText(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch ICS feed";
    await supabase
      .from("calendar_sources")
      .update({ sync_error: msg })
      .eq("id", calendarSourceId);
    return { synced: 0, error: msg };
  }

  // Build one row per external_id (last wins if a feed repeats a UID) so the
  // batched upsert never tries to touch the same conflict target twice.
  const rowByExtId = new Map<string, Record<string, unknown>>();
  for (const icsEvent of icsEvents) {
    if (!icsEvent.dtstart) continue;
    const externalId = `ics:${icsEvent.uid}`;
    rowByExtId.set(externalId, {
      member_email: source.member_email,
      calendar_source_id: source.id,
      title: icsEvent.summary ?? "Event",
      description: icsEvent.description,
      location: icsEvent.location,
      start_time: icsEvent.dtstart,
      end_time: icsEvent.dtend,
      all_day: icsEvent.allDay,
      source_type: "ics" as const,
      external_id: externalId,
      is_canceled: icsEvent.status === "CANCELLED",
    });
  }

  const syncedExternalIds = new Set(rowByExtId.keys());
  const syncedCount = rowByExtId.size;

  // Idempotent: the unique (calendar_source_id, external_id) constraint makes
  // this a no-op insert or in-place update, so concurrent syncs can't duplicate.
  if (rowByExtId.size > 0) {
    const { error: upsertError } = await supabase
      .from("calendar_events")
      .upsert([...rowByExtId.values()], {
        onConflict: "calendar_source_id,external_id",
      });
    if (upsertError) {
      await supabase
        .from("calendar_sources")
        .update({ sync_error: upsertError.message })
        .eq("id", calendarSourceId);
      return { synced: 0, error: upsertError.message };
    }
  }

  // Cancel events no longer present in the feed — window-scoped + miss-counted so
  // an aged-out past event or a transient feed hiccup isn't wrongly cancelled.
  if (syncedExternalIds.size > 0) {
    await reconcileAbsentEvents(supabase, source.id, syncedExternalIds);
  }

  // Materialize to the member's primary calendar (full sync only, importer on).
  if (opts.materialize && importerEnabled()) {
    const dest = await getMemberPrimary(supabase, source.member_email);
    if (dest) await materializeSource(supabase, source.id, dest);
  }

  await supabase
    .from("calendar_sources")
    .update({ last_synced_at: new Date().toISOString(), sync_error: null })
    .eq("id", calendarSourceId);

  return { synced: syncedCount };
}

// ============================================================
// Sync all active ICS sources
// ============================================================

export async function syncAllIcsSources(
  opts: { materialize?: boolean } = {},
): Promise<{
  results: Array<{ sourceId: string; synced: number; error?: string }>;
}> {
  const supabase = createAdminClient();

  const { data: sources } = await supabase
    .from("calendar_sources")
    .select("id")
    .eq("source_type", "ics")
    .eq("is_active", true);

  if (!sources?.length) return { results: [] };

  const results = [];
  for (const source of sources) {
    try {
      const result = await syncIcsSource(source.id, opts);
      results.push({ sourceId: source.id, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ sourceId: source.id, synced: 0, error: message });
    }
  }

  return { results };
}
