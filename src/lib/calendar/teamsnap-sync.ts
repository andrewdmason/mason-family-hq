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
  getTeamsnapMembers,
  getTeamsnapAvailabilities,
  matchPlayerMember,
  statusCodeToRsvp,
  type TeamsnapEvent,
} from "./teamsnap";
import {
  importerEnabled,
  getMemberPrimary,
  reconcileAbsentEvents,
  materializeSource,
} from "./materialize";

type AdminClient = ReturnType<typeof createAdminClient>;

// Where the calendar event begins. TeamSnap games often carry an arrival time
// ("be there by"), earlier than the game start — we start the event at arrival
// when it's set and genuinely earlier, so the event reads as the whole
// commitment (arrive → game end) and lines up with the drop-off block, which
// already anchors on the arrival time (see drive-window.ts). The raw arrival is
// still stored separately in teamsnap_arrival_time; TeamSnap stays the source of
// truth, so the game's own start isn't lost — every sync re-derives this.
export function effectiveStartTime(
  gameStart: string,
  arrival: string | null,
): string {
  if (arrival && new Date(arrival).getTime() < new Date(gameStart).getTime()) {
    return arrival;
  }
  return gameStart;
}

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
  // Pulling each player's RSVP costs one TeamSnap API call per event, so it's
  // skipped on the page-load sync (which only needs the event list); the cron
  // and the manual "Sync" button run the full sync. `materialize` (full sync
  // only) additionally writes events to the kid's Google calendar.
  opts: { syncRsvp?: boolean; materialize?: boolean } = {},
): Promise<{ synced: number; error?: string }> {
  const syncRsvp = opts.syncRsvp !== false;
  const supabase = createAdminClient();

  const { data: source, error: sourceError } = await supabase
    .from("calendar_sources")
    .select(
      "id, member_email, teamsnap_team_id, teamsnap_team_name, nickname, teamsnap_player_member_id, teamsnap_connection_email",
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

  // Backfill the linkage RSVP needs on sources added before it existed: the
  // connection that just reached this team, and the kid's player row on the
  // roster (matched by name, like the original import). This is what makes the
  // Attendance control light up automatically for teams imported earlier.
  let playerMemberId = source.teamsnap_player_member_id as number | null;
  const sourceUpdates: Record<string, unknown> = {};
  if (source.teamsnap_connection_email !== connectionEmail) {
    sourceUpdates.teamsnap_connection_email = connectionEmail;
  }
  if (!playerMemberId && source.member_email) {
    try {
      const { data: member } = await supabase
        .from("family_members")
        .select("name")
        .eq("email", source.member_email)
        .maybeSingle();
      const roster = await getTeamsnapMembers(accessToken, source.teamsnap_team_id);
      const matched = matchPlayerMember(roster, member?.name ?? null);
      if (matched) {
        playerMemberId = matched;
        sourceUpdates.teamsnap_player_member_id = matched;
      }
    } catch {
      // Non-critical — the source still syncs events without a player link.
    }
  }
  if (Object.keys(sourceUpdates).length > 0) {
    await supabase
      .from("calendar_sources")
      .update(sourceUpdates)
      .eq("id", calendarSourceId);
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
      start_time: effectiveStartTime(tsEvent.start_date, tsEvent.arrival_date),
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

  // Cancel events no longer returned by TeamSnap — window-scoped + miss-counted
  // so a transient drop or an aged-out past event isn't wrongly cancelled. Only
  // act when the fetch returned something (an empty payload is treated as a blip,
  // not "everything was deleted").
  if (syncedExternalIds.size > 0) {
    await reconcileAbsentEvents(supabase, source.id, syncedExternalIds);
  }

  // Materialize to the member's primary calendar (full sync only, importer on).
  if (opts.materialize && importerEnabled()) {
    const dest = await getMemberPrimary(supabase, source.member_email);
    if (dest) await materializeSource(supabase, source.id, dest);
  }

  // Pull the player's RSVP from TeamSnap so the local copy stays in sync with
  // any changes made in the TeamSnap app.
  if (syncRsvp && playerMemberId) {
    await syncRsvpStatuses(
      supabase,
      accessToken,
      source.id,
      playerMemberId,
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
  const dated = tsEvents.filter((e) => e.start_date);
  if (!dated.length) return;

  // Resolve every external id to a local row in one query rather than per event.
  const { data: localEvents } = await supabase
    .from("calendar_events")
    .select("id, external_id")
    .eq("calendar_source_id", calendarSourceId);
  const idByExternalId = new Map(
    (localEvents ?? []).map((e) => [e.external_id, e.id as string]),
  );

  // One availability fetch per event is unavoidable, but they're independent —
  // run them in small concurrent batches instead of strictly serial so a full
  // season's worth of events doesn't take tens of seconds.
  const CONCURRENCY = 6;
  for (let i = 0; i < dated.length; i += CONCURRENCY) {
    await Promise.all(
      dated.slice(i, i + CONCURRENCY).map(async (tsEvent) => {
        const localId = idByExternalId.get(`ts:${tsEvent.id}`);
        if (!localId) return;

        let availabilities;
        try {
          availabilities = await getTeamsnapAvailabilities(accessToken, tsEvent.id);
        } catch {
          return;
        }
        const mine = availabilities.find((a) => a.member_id === playerMemberId);
        if (!mine) return;

        await supabase
          .from("calendar_events")
          .update({ teamsnap_rsvp: statusCodeToRsvp(mine.status_code) })
          .eq("id", localId);
      }),
    );
  }
}

// Sync every active TeamSnap source, routing each through a connection that can
// actually see its team.
export async function syncAllTeamsnapSources(
  opts: { syncRsvp?: boolean; materialize?: boolean } = {},
): Promise<{
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
        const result = await syncTeamEvents(conn.member_email, sourceId, opts);
        results.push({ sourceId, ...result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ sourceId, synced: 0, error: message });
      }
    }
  }

  return results.length ? { results } : { results: [] };
}
