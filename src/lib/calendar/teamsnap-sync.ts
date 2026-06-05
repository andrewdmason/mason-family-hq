// Sync TeamSnap team events into calendar_events. Adapted from KidCalendar onto
// the member_email model: a TeamSnap source belongs to a kid (member_email) and
// is fetched using the access token of the adult whose TeamSnap account can see
// that team. syncAllTeamsnapSources walks each connection, discovers which teams
// it can access, and syncs only the matching sources — so the right token is
// always used without storing a connecting-adult column.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getValidToken,
  getTeamsnapMe,
  getTeamsnapTeams,
  getTeamsnapEvents,
  getTeamsnapAvailabilities,
  statusCodeToRsvp,
  type TeamsnapEvent,
} from "./teamsnap";

type AdminClient = ReturnType<typeof createAdminClient>;

// Title without the team prefix (the team is shown as a colored chip in the UI).
export function buildEventTitle(event: TeamsnapEvent): string {
  if (event.is_game && event.opponent_name) {
    return `vs. ${event.opponent_name}`;
  }
  if (
    event.type === "practice" ||
    event.title?.toLowerCase().includes("practice")
  ) {
    return "Practice";
  }
  return event.title || (event.is_game ? "Game" : "Event");
}

export async function syncTeamEvents(
  connectionEmail: string,
  calendarSourceId: string,
): Promise<{ synced: number; error?: string }> {
  const supabase = createAdminClient();

  const { data: source, error: sourceError } = await supabase
    .from("calendar_sources")
    .select(
      "id, member_email, teamsnap_team_id, teamsnap_team_name, nickname, teamsnap_player_member_id",
    )
    .eq("id", calendarSourceId)
    .single();

  if (sourceError || !source) {
    return { synced: 0, error: "Calendar source not found" };
  }
  if (!source.teamsnap_team_id) {
    return { synced: 0, error: "Missing TeamSnap team id" };
  }

  let accessToken: string;
  try {
    accessToken = await getValidToken(connectionEmail);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Token error";
    await supabase
      .from("calendar_sources")
      .update({ sync_error: msg })
      .eq("id", calendarSourceId);
    return { synced: 0, error: msg };
  }

  let tsEvents: TeamsnapEvent[];
  try {
    tsEvents = await getTeamsnapEvents(accessToken, source.teamsnap_team_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "API error";
    await supabase
      .from("calendar_sources")
      .update({ sync_error: msg })
      .eq("id", calendarSourceId);
    return { synced: 0, error: msg };
  }

  // One row per external_id (last wins) so the batched upsert never hits the
  // same conflict target twice.
  const rowByExtId = new Map<string, Record<string, unknown>>();
  for (const tsEvent of tsEvents) {
    if (!tsEvent.start_date) continue;
    const externalId = `ts:${tsEvent.id}`;
    rowByExtId.set(externalId, {
      member_email: source.member_email,
      calendar_source_id: source.id,
      title: buildEventTitle(tsEvent),
      description: tsEvent.notes,
      location: tsEvent.location_name,
      start_time: tsEvent.start_date,
      end_time: tsEvent.end_date,
      source_type: "teamsnap" as const,
      external_id: externalId,
      teamsnap_opponent: tsEvent.opponent_name,
      teamsnap_arrival_time: tsEvent.arrival_date,
      teamsnap_is_game: tsEvent.is_game,
      is_canceled: tsEvent.is_canceled,
    });
  }

  const syncedExternalIds = new Set(rowByExtId.keys());

  // Idempotent on the unique (calendar_source_id, external_id) constraint, so
  // concurrent syncs can't create duplicate rows.
  if (rowByExtId.size > 0) {
    await supabase
      .from("calendar_events")
      .upsert([...rowByExtId.values()], {
        onConflict: "calendar_source_id,external_id",
      });
  }

  // Cancel events no longer returned by TeamSnap.
  if (syncedExternalIds.size > 0) {
    const { data: localEvents } = await supabase
      .from("calendar_events")
      .select("id, external_id")
      .eq("calendar_source_id", source.id)
      .eq("is_canceled", false);

    for (const e of localEvents ?? []) {
      if (e.external_id && !syncedExternalIds.has(e.external_id)) {
        await supabase
          .from("calendar_events")
          .update({ is_canceled: true })
          .eq("id", e.id);
      }
    }
  }

  // Sync the player's own RSVP (passive, read-only in our UI).
  if (source.teamsnap_player_member_id) {
    await syncRsvpStatuses(
      supabase,
      accessToken,
      source.id,
      source.teamsnap_player_member_id,
      tsEvents,
    );
  }

  await supabase
    .from("calendar_sources")
    .update({ last_synced_at: new Date().toISOString(), sync_error: null })
    .eq("id", calendarSourceId);

  return { synced: tsEvents.length };
}

async function syncRsvpStatuses(
  supabase: AdminClient,
  accessToken: string,
  calendarSourceId: string,
  playerMemberId: number,
  tsEvents: TeamsnapEvent[],
) {
  for (const tsEvent of tsEvents) {
    if (!tsEvent.start_date) continue;
    const externalId = `ts:${tsEvent.id}`;

    const { data: localEvent } = await supabase
      .from("calendar_events")
      .select("id")
      .eq("calendar_source_id", calendarSourceId)
      .eq("external_id", externalId)
      .single();
    if (!localEvent) continue;

    let availabilities;
    try {
      availabilities = await getTeamsnapAvailabilities(accessToken, tsEvent.id);
    } catch {
      continue;
    }

    const mine = availabilities.find((a) => a.member_id === playerMemberId);
    if (!mine) continue;

    await supabase
      .from("calendar_events")
      .update({ teamsnap_rsvp: statusCodeToRsvp(mine.status_code) })
      .eq("id", localEvent.id);
  }
}

// Sync every active TeamSnap source, routing each through a connection that can
// actually see its team.
export async function syncAllTeamsnapSources(): Promise<{
  results: Array<{ sourceId: string; synced: number; error?: string }>;
}> {
  const supabase = createAdminClient();

  const { data: connections } = await supabase
    .from("teamsnap_connections")
    .select("member_email");
  if (!connections?.length) return { results: [] };

  const { data: sources } = await supabase
    .from("calendar_sources")
    .select("id, teamsnap_team_id")
    .eq("source_type", "teamsnap")
    .eq("is_active", true);
  if (!sources?.length) return { results: [] };

  const remaining = new Map(
    sources.filter((s) => s.teamsnap_team_id).map((s) => [s.teamsnap_team_id!, s.id]),
  );
  const results: Array<{ sourceId: string; synced: number; error?: string }> =
    [];

  for (const conn of connections) {
    if (remaining.size === 0) break;
    let teamIds: number[];
    try {
      const token = await getValidToken(conn.member_email);
      const me = await getTeamsnapMe(token);
      const teams = await getTeamsnapTeams(token, me.id);
      teamIds = teams.map((t) => t.id);
    } catch {
      continue; // this connection can't be used right now; try the next
    }

    for (const teamId of teamIds) {
      const sourceId = remaining.get(teamId);
      if (!sourceId) continue;
      remaining.delete(teamId);
      try {
        const result = await syncTeamEvents(conn.member_email, sourceId);
        results.push({ sourceId, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ sourceId, synced: 0, error: message });
      }
    }
  }

  return results.length ? { results } : { results: [] };
}
