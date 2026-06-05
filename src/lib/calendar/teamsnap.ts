// TeamSnap API client (Collection+JSON) and OAuth token management. Adapted from
// KidCalendar: token rows are keyed by member_email and read through the
// service-role client.

import { createAdminClient } from "@/lib/supabase/admin";

export const TEAMSNAP_AUTH_URL = "https://auth.teamsnap.com";
export const TEAMSNAP_API_URL = "https://api.teamsnap.com/v3";

interface CollectionLink {
  rel: string;
  href: string;
}

interface CollectionData {
  name: string;
  value: string | number | boolean | null;
}

interface CollectionItem {
  href: string;
  data: CollectionData[];
  links: CollectionLink[];
}

interface CollectionResponse {
  collection: {
    version: string;
    href: string;
    links: CollectionLink[];
    items: CollectionItem[];
    template?: { data: Array<{ name: string; value: unknown }> };
    queries?: Array<{
      rel: string;
      href: string;
      data: Array<{ name: string; value: string }>;
    }>;
    error?: { title: string; message: string };
  };
}

export function getItemData(item: CollectionItem): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const d of item.data) {
    result[d.name] = d.value;
  }
  return result;
}

export function getItemLink(item: CollectionItem, rel: string): string | null {
  const link = item.links?.find((l) => l.rel === rel);
  return link?.href ?? null;
}

export interface TeamsnapUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export interface TeamsnapTeam {
  id: number;
  name: string;
  sport_name: string | null;
  league_name: string | null;
  season_name: string | null;
  division_name: string | null;
  is_archived_season: boolean;
  links: {
    events?: string;
    members?: string;
    availabilities?: string;
  };
}

export interface TeamsnapEvent {
  id: number;
  team_id: number;
  type: string;
  is_game: boolean;
  title: string | null;
  opponent_name: string | null;
  location_name: string | null;
  start_date: string | null;
  end_date: string | null;
  arrival_date: string | null;
  is_canceled: boolean;
  notes: string | null;
  href: string;
}

export interface TeamsnapMember {
  id: number;
  team_id: number;
  first_name: string;
  last_name: string;
  is_non_player: boolean;
  user_id: number | null;
}

export interface TeamsnapAvailability {
  id: number;
  member_id: number;
  event_id: number;
  team_id: number;
  status_code: number | null; // 1=Yes, 0=No, 2=Maybe, null=No Reply
  status: string | null;
  notes: string | null;
  notes_author_id: number | null;
  href: string;
}

export async function teamsnapFetch(
  accessToken: string,
  url: string,
): Promise<CollectionResponse> {
  const fullUrl = url.startsWith("http") ? url : `${TEAMSNAP_API_URL}${url}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let res: Response;
  try {
    res = await fetch(fullUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.collection+json",
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`TeamSnap API timeout after 30s: ${fullUrl}`);
    }
    throw err;
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TeamSnap API error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// PUT a Collection+JSON template to an item href (used to update an availability
// RSVP). TeamSnap expects { template: { data: [{ name, value }, ...] } }.
export async function teamsnapPut(
  accessToken: string,
  url: string,
  template: Record<string, unknown>,
): Promise<void> {
  const fullUrl = url.startsWith("http") ? url : `${TEAMSNAP_API_URL}${url}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const body = {
    template: {
      data: Object.entries(template).map(([name, value]) => ({ name, value })),
    },
  };

  let res: Response;
  try {
    res = await fetch(fullUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.collection+json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`TeamSnap API timeout after 30s: ${fullUrl}`);
    }
    throw err;
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TeamSnap API PUT error ${res.status}: ${text.slice(0, 200)}`);
  }
}

let cachedRootLinks: CollectionLink[] | null = null;

async function getRootLinks(accessToken: string): Promise<CollectionLink[]> {
  if (cachedRootLinks) return cachedRootLinks;
  const root = await teamsnapFetch(accessToken, "/");
  cachedRootLinks = root.collection.links;
  return cachedRootLinks;
}

function findRootLink(links: CollectionLink[], rel: string): string {
  const link = links.find((l) => l.rel === rel);
  if (!link) throw new Error(`Root link not found: ${rel}`);
  return link.href;
}

export async function getTeamsnapMe(
  accessToken: string,
): Promise<TeamsnapUser> {
  const links = await getRootLinks(accessToken);
  const meUrl = findRootLink(links, "me");
  const res = await teamsnapFetch(accessToken, meUrl);

  if (!res.collection.items.length) {
    throw new Error("No user data returned from /me");
  }

  const data = getItemData(res.collection.items[0]);
  return {
    id: data.id as number,
    email: data.email as string,
    first_name: data.first_name as string,
    last_name: data.last_name as string,
  };
}

export async function getTeamsnapTeams(
  accessToken: string,
  userId: number,
): Promise<TeamsnapTeam[]> {
  const links = await getRootLinks(accessToken);
  const teamsUrl = findRootLink(links, "teams");
  const url = `${teamsUrl}/search?user_id=${userId}`;
  const res = await teamsnapFetch(accessToken, url);

  return res.collection.items.map((item) => {
    const data = getItemData(item);
    return {
      id: data.id as number,
      name: data.name as string,
      sport_name: (data.sport_name as string) ?? null,
      league_name: (data.league_name as string) ?? null,
      season_name: (data.season_name as string) ?? null,
      division_name: (data.division_name as string) ?? null,
      is_archived_season: (data.is_archived_season as boolean) ?? false,
      links: {
        events: getItemLink(item, "events") ?? undefined,
        members: getItemLink(item, "members") ?? undefined,
        availabilities: getItemLink(item, "availabilities") ?? undefined,
      },
    };
  });
}

export async function getTeamsnapEvents(
  accessToken: string,
  teamId: number,
): Promise<TeamsnapEvent[]> {
  const links = await getRootLinks(accessToken);
  const eventsUrl = findRootLink(links, "events");
  const url = `${eventsUrl}/search?team_id=${teamId}`;
  const res = await teamsnapFetch(accessToken, url);

  return res.collection.items.map((item) => {
    const data = getItemData(item);
    return {
      id: data.id as number,
      team_id: data.team_id as number,
      type: (data.type as string) ?? "other",
      is_game: (data.is_game as boolean) ?? false,
      title: (data.name as string) ?? null,
      opponent_name: (data.opponent_name as string) ?? null,
      location_name: (data.location_name as string) ?? null,
      start_date: (data.start_date as string) ?? null,
      end_date: (data.end_date as string) ?? null,
      arrival_date: (data.arrival_date as string) ?? null,
      is_canceled: (data.is_canceled as boolean) ?? false,
      notes: (data.notes as string) ?? null,
      href: item.href,
    };
  });
}

export async function getTeamsnapMembers(
  accessToken: string,
  teamId: number,
): Promise<TeamsnapMember[]> {
  const links = await getRootLinks(accessToken);
  const membersUrl = findRootLink(links, "members");
  const url = `${membersUrl}/search?team_id=${teamId}`;
  const res = await teamsnapFetch(accessToken, url);

  return res.collection.items.map((item) => {
    const data = getItemData(item);
    return {
      id: data.id as number,
      team_id: data.team_id as number,
      first_name: (data.first_name as string) ?? "",
      last_name: (data.last_name as string) ?? "",
      is_non_player: (data.is_non_player as boolean) ?? false,
      user_id: (data.user_id as number) ?? null,
    };
  });
}

export async function getTeamsnapAvailabilities(
  accessToken: string,
  eventId: number,
): Promise<TeamsnapAvailability[]> {
  const links = await getRootLinks(accessToken);
  const availUrl = findRootLink(links, "availabilities");
  const url = `${availUrl}/search?event_id=${eventId}`;
  const res = await teamsnapFetch(accessToken, url);

  return res.collection.items.map((item) => {
    const data = getItemData(item);
    return {
      id: data.id as number,
      member_id: data.member_id as number,
      event_id: data.event_id as number,
      team_id: data.team_id as number,
      status_code: (data.status_code as number) ?? null,
      status: (data.status as string) ?? null,
      notes: (data.notes as string) ?? null,
      notes_author_id: (data.notes_author_id as number) ?? null,
      href: item.href,
    };
  });
}

export type TeamsnapRsvpStatus = "going" | "maybe" | "not_going" | "no_reply";

export function statusCodeToRsvp(code: number | null): TeamsnapRsvpStatus {
  switch (code) {
    case 1:
      return "going";
    case 0:
      return "not_going";
    case 2:
      return "maybe";
    default:
      return "no_reply";
  }
}

// Best-effort match of a family member to their player row on a team's roster,
// by first name (the heuristic KidCalendar used when importing a team). Returns
// the TeamSnap member id, or null if no confident match. Non-players (coaches,
// managers, parents) are never matched.
export function matchPlayerMember(
  members: TeamsnapMember[],
  fullName: string | null,
): number | null {
  const first = fullName?.trim().split(/\s+/)[0]?.toLowerCase();
  if (!first) return null;
  const players = members.filter((m) => !m.is_non_player);
  const exact = players.find((m) => m.first_name.toLowerCase() === first);
  if (exact) return exact.id;
  const prefix = players.find((m) => {
    const f = m.first_name.toLowerCase();
    return f.startsWith(first) || first.startsWith(f);
  });
  return prefix?.id ?? null;
}

export function rsvpToStatusCode(rsvp: TeamsnapRsvpStatus): number | null {
  switch (rsvp) {
    case "going":
      return 1;
    case "not_going":
      return 0;
    case "maybe":
      return 2;
    case "no_reply":
      return null;
  }
}

// Update a member's RSVP for an event by PUTting the new status to their
// availability row's href.
export async function setTeamsnapAvailability(
  accessToken: string,
  availabilityHref: string,
  statusCode: number,
): Promise<void> {
  await teamsnapPut(accessToken, availabilityHref, { status_code: statusCode });
}

export async function refreshTeamsnapToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    res = await fetch(`${TEAMSNAP_AUTH_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: process.env.TEAMSNAP_CLIENT_ID!,
        client_secret: process.env.TEAMSNAP_CLIENT_SECRET!,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("TeamSnap token refresh timeout after 15s");
    }
    throw err;
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${text.slice(0, 200)}`);
  }

  return res.json();
}

// Returns a valid access token for the given member, refreshing if needed.
export async function getValidToken(memberEmail: string): Promise<string> {
  const supabase = createAdminClient();

  const { data: conn, error } = await supabase
    .from("teamsnap_connections")
    .select("access_token, refresh_token, token_expires_at")
    .eq("member_email", memberEmail)
    .single();

  if (error || !conn) {
    throw new Error("No TeamSnap connection found");
  }

  if (conn.token_expires_at) {
    const expiresAt = new Date(conn.token_expires_at);
    const bufferMs = 5 * 60 * 1000;
    if (expiresAt.getTime() - bufferMs > Date.now()) {
      return conn.access_token;
    }
  }

  if (!conn.refresh_token) {
    return conn.access_token;
  }

  const refreshed = await refreshTeamsnapToken(conn.refresh_token);
  const newExpiresAt = new Date(
    Date.now() + refreshed.expires_in * 1000,
  ).toISOString();

  await supabase
    .from("teamsnap_connections")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      token_expires_at: newExpiresAt,
    })
    .eq("member_email", memberEmail);

  cachedRootLinks = null;
  return refreshed.access_token;
}
