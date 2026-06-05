// Sync Google Calendar sources into calendar_events. Mirrors ics-sync.ts: scoped
// to member_email, writing under the service-role client, idempotent via the
// unique (calendar_source_id, external_id) constraint. Reads happen on calendar
// load; writes back to Google are handled by the calendar actions, not here.

import { createAdminClient } from "@/lib/supabase/admin";
import { listGoogleEvents, googleTimesToEvent } from "./google";

// How far back/forward to pull. A year ahead covers school years and seasons; a
// month back keeps recently-passed events visible.
const WINDOW_PAST_MONTHS = 1;
const WINDOW_FUTURE_MONTHS = 12;

function syncWindow(): { timeMin: string; timeMax: string } {
  const now = new Date();
  const min = new Date(now);
  min.setMonth(min.getMonth() - WINDOW_PAST_MONTHS);
  const max = new Date(now);
  max.setMonth(max.getMonth() + WINDOW_FUTURE_MONTHS);
  return { timeMin: min.toISOString(), timeMax: max.toISOString() };
}

export async function syncGoogleSource(
  calendarSourceId: string,
): Promise<{ synced: number; error?: string }> {
  const supabase = createAdminClient();

  const { data: source, error: sourceError } = await supabase
    .from("calendar_sources")
    .select(
      "id, member_email, google_calendar_id, google_connection_email, nickname",
    )
    .eq("id", calendarSourceId)
    .single();

  if (sourceError || !source) {
    return { synced: 0, error: "Calendar source not found" };
  }
  if (!source.google_calendar_id) {
    return { synced: 0, error: "Missing Google calendar id" };
  }

  // Whose token reaches this calendar. Defaults to the member it belongs to.
  const connectionEmail =
    source.google_connection_email ?? source.member_email;
  if (!connectionEmail) {
    return { synced: 0, error: "No Google connection for this calendar" };
  }

  let events;
  try {
    events = await listGoogleEvents(
      connectionEmail,
      source.google_calendar_id,
      syncWindow(),
    );
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Failed to fetch Google events";
    await supabase
      .from("calendar_sources")
      .update({ sync_error: msg })
      .eq("id", calendarSourceId);
    return { synced: 0, error: msg };
  }

  // One row per external_id (last wins) so the batched upsert never touches the
  // same conflict target twice.
  const rowByExtId = new Map<string, Record<string, unknown>>();
  for (const ev of events) {
    const { start_time, end_time, all_day } = googleTimesToEvent(ev);
    if (!start_time) continue;
    const externalId = `google:${ev.id}`;
    rowByExtId.set(externalId, {
      member_email: source.member_email,
      calendar_source_id: source.id,
      title: ev.summary ?? "Event",
      description: ev.description ?? null,
      location: ev.location ?? null,
      start_time,
      end_time,
      all_day,
      source_type: "google" as const,
      external_id: externalId,
      is_canceled: ev.status === "cancelled",
    });
  }

  const syncedExternalIds = new Set(rowByExtId.keys());
  const syncedCount = rowByExtId.size;

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

  const { data: existingEvents } = await supabase
    .from("calendar_events")
    .select("id, external_id, is_canceled")
    .eq("calendar_source_id", source.id);

  // Cancel events no longer present in the window (e.g. deleted in Google).
  const cancelOps = (existingEvents ?? [])
    .filter(
      (e) =>
        !e.is_canceled &&
        e.external_id &&
        !syncedExternalIds.has(e.external_id),
    )
    .map((e) =>
      supabase
        .from("calendar_events")
        .update({ is_canceled: true })
        .eq("id", e.id),
    );
  if (cancelOps.length > 0) await Promise.all(cancelOps);

  await supabase
    .from("calendar_sources")
    .update({ last_synced_at: new Date().toISOString(), sync_error: null })
    .eq("id", calendarSourceId);

  return { synced: syncedCount };
}

export async function syncAllGoogleSources(): Promise<{
  results: Array<{ sourceId: string; synced: number; error?: string }>;
}> {
  const supabase = createAdminClient();

  const { data: sources } = await supabase
    .from("calendar_sources")
    .select("id")
    .eq("source_type", "google")
    .eq("is_active", true);

  if (!sources?.length) return { results: [] };

  const results = [];
  for (const source of sources) {
    try {
      const result = await syncGoogleSource(source.id);
      results.push({ sourceId: source.id, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ sourceId: source.id, synced: 0, error: message });
    }
  }

  return { results };
}
