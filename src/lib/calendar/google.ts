// Google Calendar API client (REST v3) and OAuth token management. Kept fetch-
// based to match the TeamSnap client and the hand-rolled ICS parser — no heavy
// SDK. Token rows live in google_connections, keyed by member_email, and are read
// through the service-role client. Supabase brokers sign-in but does NOT refresh
// provider tokens, so refresh is owned here (getValidGoogleToken).

import { createAdminClient } from "@/lib/supabase/admin";

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

// ---------------------------------------------------------------------------
// Types (only the fields we use).
// ---------------------------------------------------------------------------
export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor: string | null;
  accessRole: string; // "owner" | "writer" | "reader" | "freeBusyReader"
}

interface GoogleEventDate {
  date?: string; // all-day: "YYYY-MM-DD"
  dateTime?: string; // timed: RFC3339
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventDate;
  end?: GoogleEventDate;
}

// ---------------------------------------------------------------------------
// Low-level fetch with timeout + clear errors (mirrors teamsnapFetch).
// ---------------------------------------------------------------------------
async function googleFetch(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const fullUrl = url.startsWith("http") ? url : `${GOOGLE_CALENDAR_API}${url}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let res: Response;
  try {
    res = await fetch(fullUrl, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`Google API timeout after 30s: ${fullUrl}`);
    }
    throw err;
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// OAuth token refresh. Google's refresh response does not return a new refresh
// token, so we keep the stored one.
// ---------------------------------------------------------------------------
async function refreshGoogleToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Google token refresh timeout after 15s");
    }
    throw err;
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Returns a valid access token for the given member, refreshing if it's within
// 5 minutes of expiry (mirrors getValidToken for TeamSnap).
export async function getValidGoogleToken(memberEmail: string): Promise<string> {
  const supabase = createAdminClient();

  const { data: conn, error } = await supabase
    .from("google_connections")
    .select("access_token, refresh_token, token_expires_at")
    .eq("member_email", memberEmail)
    .single();

  if (error || !conn) {
    throw new Error("No Google connection found");
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

  const refreshed = await refreshGoogleToken(conn.refresh_token);
  const newExpiresAt = new Date(
    Date.now() + refreshed.expires_in * 1000,
  ).toISOString();

  await supabase
    .from("google_connections")
    .update({
      access_token: refreshed.access_token,
      token_expires_at: newExpiresAt,
    })
    .eq("member_email", memberEmail);

  return refreshed.access_token;
}

// ---------------------------------------------------------------------------
// Calendar list (for the picker). Only calendars the user can read are returned;
// the UI can use accessRole to decide which are writable.
// ---------------------------------------------------------------------------
export async function listGoogleCalendars(
  memberEmail: string,
): Promise<GoogleCalendarListEntry[]> {
  const token = await getValidGoogleToken(memberEmail);
  const out: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${GOOGLE_CALENDAR_API}/users/me/calendarList`);
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await googleFetch(token, url.toString());
    const json = (await res.json()) as {
      items?: Array<{
        id: string;
        summary?: string;
        primary?: boolean;
        backgroundColor?: string;
        accessRole?: string;
      }>;
      nextPageToken?: string;
    };
    for (const c of json.items ?? []) {
      out.push({
        id: c.id,
        summary: c.summary ?? c.id,
        primary: c.primary ?? false,
        backgroundColor: c.backgroundColor ?? null,
        accessRole: c.accessRole ?? "reader",
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);

  // Primary first, then alphabetical.
  return out.sort((a, b) =>
    a.primary === b.primary ? a.summary.localeCompare(b.summary) : a.primary ? -1 : 1,
  );
}

// ---------------------------------------------------------------------------
// Events. We expand recurring events into instances (singleEvents=true) so the
// rows mirror how ICS feeds are already flattened.
// ---------------------------------------------------------------------------
export async function listGoogleEvents(
  memberEmail: string,
  calendarId: string,
  range: { timeMin: string; timeMax: string },
): Promise<GoogleEvent[]> {
  const token = await getValidGoogleToken(memberEmail);
  const out: GoogleEvent[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
    );
    url.searchParams.set("timeMin", range.timeMin);
    url.searchParams.set("timeMax", range.timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true"); // so we can cancel removed rows
    url.searchParams.set("maxResults", "2500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await googleFetch(token, url.toString());
    const json = (await res.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
    };
    out.push(...(json.items ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);

  return out;
}

export async function insertGoogleEvent(
  memberEmail: string,
  calendarId: string,
  body: Record<string, unknown>,
): Promise<GoogleEvent> {
  const token = await getValidGoogleToken(memberEmail);
  const res = await googleFetch(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return res.json();
}

export async function patchGoogleEvent(
  memberEmail: string,
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>,
): Promise<GoogleEvent> {
  const token = await getValidGoogleToken(memberEmail);
  const res = await googleFetch(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
  return res.json();
}

export async function deleteGoogleEvent(
  memberEmail: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const token = await getValidGoogleToken(memberEmail);
  // 404/410 mean it's already gone — treat as success.
  try {
    await googleFetch(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (!/error 40[049]/.test(msg)) throw err;
  }
}

// ---------------------------------------------------------------------------
// Conversions between our event shape and Google's start/end objects.
// ---------------------------------------------------------------------------

// Google event start/end -> our { start_time, end_time, all_day }.
export function googleTimesToEvent(ev: GoogleEvent): {
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
} {
  const allDay = !!ev.start?.date;
  if (allDay) {
    const start = ev.start?.date ? `${ev.start.date}T00:00:00Z` : null;
    const end = ev.end?.date ? `${ev.end.date}T00:00:00Z` : null;
    return { start_time: start, end_time: end, all_day: true };
  }
  return {
    start_time: ev.start?.dateTime ?? null,
    end_time: ev.end?.dateTime ?? null,
    all_day: false,
  };
}

// Our event input -> Google start/end objects. All-day uses date strings (end is
// exclusive in Google's model, so a single all-day event ends the next day).
export function eventToGoogleBody(input: {
  title: string;
  location: string | null;
  description: string | null;
  startTime: string;
  endTime: string | null;
  allDay: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: input.title,
    location: input.location ?? undefined,
    description: input.description ?? undefined,
  };

  if (input.allDay) {
    const startDate = ymd(input.startTime);
    // Exclusive end: default to the day after start when no end given.
    const endDate = input.endTime
      ? ymd(input.endTime)
      : ymd(addDays(input.startTime, 1));
    body.start = { date: startDate };
    body.end = { date: endDate };
  } else {
    body.start = { dateTime: new Date(input.startTime).toISOString() };
    body.end = {
      dateTime: new Date(input.endTime ?? input.startTime).toISOString(),
    };
  }
  return body;
}

function ymd(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
