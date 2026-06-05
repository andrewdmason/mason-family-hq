// TeamSnap attendance: reading the team's RSVP roster for an event and writing a
// player's own RSVP back to TeamSnap. The calendar port (00098) dropped this;
// 00102 restores the source→player and source→connection linkage it needs.
//
// Token resolution prefers the connection recorded on the source
// (teamsnap_connection_email), falling back to discovery — walking connections
// until one can see the team — for sources added before that column existed.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getValidToken,
  getTeamsnapMe,
  getTeamsnapTeams,
  getTeamsnapAvailabilities,
  getTeamsnapMembers,
  setTeamsnapAvailability,
  matchPlayerMember,
  statusCodeToRsvp,
  rsvpToStatusCode,
  type TeamsnapRsvpStatus,
} from "./teamsnap";

type AdminClient = ReturnType<typeof createAdminClient>;

interface SourceForAttendance {
  id: string;
  member_email: string | null;
  teamsnap_team_id: number | null;
  teamsnap_player_member_id: number | null;
  teamsnap_connection_email: string | null;
}

interface EventForAttendance {
  external_id: string | null;
  source_type: string;
  source: SourceForAttendance | null;
}

// Returns the TeamSnap event id and a usable token for the event's team, or an
// error string. Shared by both the read (availability) and write (RSVP) paths.
async function resolveTeamsnapEvent(
  supabase: AdminClient,
  eventId: string,
): Promise<
  | { tsEventId: number; token: string; source: SourceForAttendance }
  | { error: string }
> {
  const { data: event } = await supabase
    .from("calendar_events")
    .select(
      "external_id, source_type, source:calendar_sources(id, member_email, teamsnap_team_id, teamsnap_player_member_id, teamsnap_connection_email)",
    )
    .eq("id", eventId)
    .single<EventForAttendance>();

  if (!event || event.source_type !== "teamsnap" || !event.external_id) {
    return { error: "Not a TeamSnap event." };
  }
  const source = event.source;
  if (!source?.teamsnap_team_id) {
    return { error: "This event isn't linked to a TeamSnap team." };
  }

  const resolved = await resolveSourceToken(supabase, source);
  if (!resolved) {
    return { error: "No TeamSnap connection can reach this team." };
  }

  const tsEventId = parseInt(event.external_id.replace("ts:", ""), 10);
  if (Number.isNaN(tsEventId)) {
    return { error: "Malformed TeamSnap event id." };
  }
  return { tsEventId, token: resolved.token, source };
}

async function resolveSourceToken(
  supabase: AdminClient,
  source: SourceForAttendance,
): Promise<{ email: string; token: string } | null> {
  if (source.teamsnap_connection_email) {
    try {
      const token = await getValidToken(source.teamsnap_connection_email);
      return { email: source.teamsnap_connection_email, token };
    } catch {
      // Recorded connection is unusable (revoked/expired) — try discovery.
    }
  }

  const { data: connections } = await supabase
    .from("teamsnap_connections")
    .select("member_email");

  for (const conn of connections ?? []) {
    try {
      const token = await getValidToken(conn.member_email);
      const me = await getTeamsnapMe(token);
      const teams = await getTeamsnapTeams(token, me.id);
      if (teams.some((t) => t.id === source.teamsnap_team_id)) {
        // Cache the discovery so the next call goes straight to the token.
        await supabase
          .from("calendar_sources")
          .update({ teamsnap_connection_email: conn.member_email })
          .eq("id", source.id);
        return { email: conn.member_email, token };
      }
    } catch {
      continue;
    }
  }
  return null;
}

// Resolve (and persist) the player row this source represents, matching the
// kid's name against the roster. Lets RSVP work without a prior manual link.
async function ensurePlayerMemberId(
  supabase: AdminClient,
  token: string,
  source: SourceForAttendance,
): Promise<number | null> {
  if (source.teamsnap_player_member_id) return source.teamsnap_player_member_id;
  if (!source.member_email || !source.teamsnap_team_id) return null;

  const { data: member } = await supabase
    .from("family_members")
    .select("name")
    .eq("email", source.member_email)
    .maybeSingle();

  let roster;
  try {
    roster = await getTeamsnapMembers(token, source.teamsnap_team_id);
  } catch {
    return null;
  }
  const matched = matchPlayerMember(roster, member?.name ?? null);
  if (matched) {
    await supabase
      .from("calendar_sources")
      .update({ teamsnap_player_member_id: matched })
      .eq("id", source.id);
  }
  return matched;
}

export interface TeamAvailability {
  counts: Record<TeamsnapRsvpStatus, number>;
  roster: Array<{ name: string; status: TeamsnapRsvpStatus }>;
  // The linked player's own current RSVP (live from TeamSnap), or null when no
  // player is linked. Lets the sheet show the true state on open, even if the
  // background sync hasn't run since the RSVP last changed in TeamSnap.
  myStatus: TeamsnapRsvpStatus | null;
}

// The whole team's RSVP for an event: counts plus a per-player roster. Players
// only (non-player members — coaches, managers, parents — are excluded from the
// roster and counts, matching how TeamSnap presents attendance). Also reads the
// linked player's own status and mirrors it onto the local event so badges and
// the list view stay in sync without waiting for the next background sync.
export async function getEventTeamAvailability(
  eventId: string,
): Promise<TeamAvailability | { error: string }> {
  const supabase = createAdminClient();
  const resolved = await resolveTeamsnapEvent(supabase, eventId);
  if ("error" in resolved) return resolved;
  const { tsEventId, token, source } = resolved;

  const playerMemberId = await ensurePlayerMemberId(supabase, token, source);

  let availabilities, members;
  try {
    [availabilities, members] = await Promise.all([
      getTeamsnapAvailabilities(token, tsEventId),
      getTeamsnapMembers(token, source.teamsnap_team_id!),
    ]);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "TeamSnap error." };
  }

  const memberById = new Map(
    members.map((m) => [
      m.id,
      { name: `${m.first_name} ${m.last_name}`.trim(), isNonPlayer: m.is_non_player },
    ]),
  );

  const counts: Record<TeamsnapRsvpStatus, number> = {
    going: 0,
    maybe: 0,
    not_going: 0,
    no_reply: 0,
  };
  const roster: Array<{ name: string; status: TeamsnapRsvpStatus }> = [];
  let myStatus: TeamsnapRsvpStatus | null = null;

  for (const avail of availabilities) {
    if (playerMemberId && avail.member_id === playerMemberId) {
      myStatus = statusCodeToRsvp(avail.status_code);
    }
    const member = memberById.get(avail.member_id);
    if (!member || member.isNonPlayer) continue;
    const status = statusCodeToRsvp(avail.status_code);
    counts[status]++;
    roster.push({ name: member.name || "Unknown", status });
  }

  // Keep the locally-stored RSVP (used by list badges) consistent with what we
  // just read live.
  if (playerMemberId && myStatus !== null) {
    await supabase
      .from("calendar_events")
      .update({ teamsnap_rsvp: myStatus })
      .eq("id", eventId);
  }

  const order: Record<TeamsnapRsvpStatus, number> = {
    going: 0,
    maybe: 1,
    no_reply: 2,
    not_going: 3,
  };
  roster.sort((a, b) => order[a.status] - order[b.status]);

  return { counts, roster, myStatus };
}

// Write a player's RSVP back to TeamSnap and mirror it onto the local event.
// `status` is restricted to the three states a person can actually pick.
export async function setEventRsvp(
  eventId: string,
  status: Exclude<TeamsnapRsvpStatus, "no_reply">,
): Promise<{ ok: true } | { error: string }> {
  const supabase = createAdminClient();
  const resolved = await resolveTeamsnapEvent(supabase, eventId);
  if ("error" in resolved) return resolved;
  const { tsEventId, token, source } = resolved;

  const playerMemberId = await ensurePlayerMemberId(supabase, token, source);
  if (!playerMemberId) {
    return {
      error:
        "Couldn't tell which player to RSVP for. Link a player in Settings → Calendars.",
    };
  }

  let availabilities;
  try {
    availabilities = await getTeamsnapAvailabilities(token, tsEventId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "TeamSnap error." };
  }

  const mine = availabilities.find((a) => a.member_id === playerMemberId);
  if (!mine) {
    return { error: "No RSVP slot found for this player on the event." };
  }

  const statusCode = rsvpToStatusCode(status);
  if (statusCode === null) {
    return { error: "Invalid RSVP status." };
  }

  try {
    await setTeamsnapAvailability(token, mine.href, statusCode);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "TeamSnap error." };
  }

  await supabase
    .from("calendar_events")
    .update({ teamsnap_rsvp: status })
    .eq("id", eventId);

  return { ok: true };
}

// Roster of players on a team (for picking which one a source represents).
export async function listTeamPlayers(
  connectionEmail: string,
  teamId: number,
): Promise<Array<{ id: number; name: string }>> {
  const token = await getValidToken(connectionEmail);
  const members = await getTeamsnapMembers(token, teamId);
  return members
    .filter((m) => !m.is_non_player)
    .map((m) => ({
      id: m.id,
      name: `${m.first_name} ${m.last_name}`.trim() || "Player",
    }));
}
