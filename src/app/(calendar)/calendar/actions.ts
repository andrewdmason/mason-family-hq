"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/members/auth";
import { runCalendarSync } from "@/lib/calendar/sync";
import {
  getValidToken,
  getTeamsnapMe,
  getTeamsnapTeams,
} from "@/lib/calendar/teamsnap";
import { syncTeamEvents } from "@/lib/calendar/teamsnap-sync";
import {
  getEventTeamAvailability,
  setEventRsvp,
  listTeamPlayers,
  type TeamAvailability,
} from "@/lib/calendar/attendance";
import type { TeamsnapRsvp } from "@/lib/calendar/types";
import {
  listGoogleCalendars,
  insertGoogleEvent,
  patchGoogleEvent,
  deleteGoogleEvent,
  eventToGoogleBody,
  type GoogleCalendarListEntry,
} from "@/lib/calendar/google";
import { syncGoogleSource } from "@/lib/calendar/google-sync";
import { allDayInstant } from "@/lib/calendar/calendar-utils";

/** Throw unless the caller is an owner/parent — the roles that manage calendars.
 * Returns the caller's member email (handy for connection-scoped work). */
async function requireParent(): Promise<string> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const { data } = await supabase
    .from("family_members")
    .select("email, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || (data.role !== "owner" && data.role !== "parent")) {
    throw new Error("Not authorized");
  }
  return data.email as string;
}

export type ManualEventInput = {
  // The Google source to write into, or null for an app-only ("manual") event.
  calendarSourceId: string | null;
  // Only used for manual events — Google events belong to the source's member.
  memberEmail: string | null;
  title: string;
  location: string | null;
  description: string | null;
  startTime: string; // ISO
  endTime: string | null; // ISO
  allDay: boolean;
};

// Fields shared by manual and Google event rows (source_type / external_id are
// set per source by the callers).
function baseEventColumns(input: ManualEventInput) {
  return {
    title: input.title.trim(),
    location: input.location?.trim() || null,
    description: input.description?.trim() || null,
    // All-day events are pinned to midnight UTC of their wall-clock date — the
    // single anchor every sync path and the Calendar views agree on, so the day
    // reads back correctly in every timezone (see calendar-utils' eventDayKey).
    start_time: input.allDay ? allDayInstant(input.startTime) : input.startTime,
    end_time:
      input.allDay && input.endTime
        ? allDayInstant(input.endTime)
        : input.endTime,
    all_day: input.allDay,
  };
}

type GoogleWriteTarget = {
  sourceId: string;
  memberEmail: string | null;
  googleCalendarId: string;
  connectionEmail: string;
};

/** Resolve a calendar source to a Google write target, or null if it isn't a
 * (writable) Google source. */
async function googleTarget(
  admin: ReturnType<typeof createAdminClient>,
  sourceId: string | null,
): Promise<GoogleWriteTarget | null> {
  if (!sourceId) return null;
  const { data: src } = await admin
    .from("calendar_sources")
    .select(
      "id, member_email, source_type, google_calendar_id, google_connection_email",
    )
    .eq("id", sourceId)
    .maybeSingle();
  if (
    !src ||
    src.source_type !== "google" ||
    !src.google_calendar_id
  ) {
    return null;
  }
  const connectionEmail = src.google_connection_email ?? src.member_email;
  if (!connectionEmail) return null;
  return {
    sourceId: src.id,
    memberEmail: src.member_email,
    googleCalendarId: src.google_calendar_id,
    connectionEmail,
  };
}

export async function createManualEvent(input: ManualEventInput): Promise<string> {
  await requireParent();
  const admin = createAdminClient();

  // Writing into a Google calendar: push to Google first, then mirror locally so
  // the row carries the Google event id for later edits/deletes.
  const target = await googleTarget(admin, input.calendarSourceId);
  if (target) {
    const created = await insertGoogleEvent(
      target.connectionEmail,
      target.googleCalendarId,
      eventToGoogleBody(input),
    );
    const { data, error } = await admin
      .from("calendar_events")
      .insert({
        ...baseEventColumns(input),
        member_email: target.memberEmail,
        calendar_source_id: target.sourceId,
        source_type: "google" as const,
        external_id: `google:${created.id}`,
      })
      .select("id")
      .single();
    if (error || !data)
      throw new Error(error?.message ?? "Couldn't create the event.");
    revalidatePath("/calendar");
    return data.id as string;
  }

  // App-only manual event.
  const { data, error } = await admin
    .from("calendar_events")
    .insert({
      ...baseEventColumns(input),
      member_email: input.memberEmail,
      source_type: "manual" as const,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't create the event.");
  revalidatePath("/calendar");
  return data.id as string;
}

export async function updateManualEvent(
  id: string,
  input: ManualEventInput,
): Promise<void> {
  await requireParent();
  const admin = createAdminClient();

  const { data: ev } = await admin
    .from("calendar_events")
    .select("id, source_type, calendar_source_id, external_id")
    .eq("id", id)
    .single();

  // Editing a Google event writes back to Google (it stays on its calendar — we
  // don't move events between calendars from here).
  if (
    ev?.source_type === "google" &&
    ev.external_id?.startsWith("google:") &&
    ev.calendar_source_id
  ) {
    const target = await googleTarget(admin, ev.calendar_source_id);
    if (!target) throw new Error("This calendar is no longer connected.");
    const googleEventId = ev.external_id.slice("google:".length);
    await patchGoogleEvent(
      target.connectionEmail,
      target.googleCalendarId,
      googleEventId,
      eventToGoogleBody(input),
    );
    const { error } = await admin
      .from("calendar_events")
      .update(baseEventColumns(input))
      .eq("id", id);
    if (error) throw new Error(error.message);
    revalidatePath("/calendar");
    return;
  }

  // Manual event.
  const { error } = await admin
    .from("calendar_events")
    .update({ ...baseEventColumns(input), member_email: input.memberEmail })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/calendar");
}

export async function deleteEvent(id: string): Promise<void> {
  await requireParent();
  const admin = createAdminClient();

  const { data: ev } = await admin
    .from("calendar_events")
    .select("id, source_type, calendar_source_id, external_id")
    .eq("id", id)
    .single();

  if (
    ev?.source_type === "google" &&
    ev.external_id?.startsWith("google:") &&
    ev.calendar_source_id
  ) {
    const target = await googleTarget(admin, ev.calendar_source_id);
    if (target) {
      await deleteGoogleEvent(
        target.connectionEmail,
        target.googleCalendarId,
        ev.external_id.slice("google:".length),
      );
    }
  }

  const { error } = await admin.from("calendar_events").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/calendar");
}

export type IcsSourceInput = {
  memberEmail: string | null;
  nickname: string;
  icsUrl: string;
  color: string | null;
};

export async function addIcsSource(input: IcsSourceInput): Promise<string> {
  await requireParent();
  const admin = createAdminClient();
  const icsUrl = input.icsUrl.trim();

  // Subscribing the same feed twice just duplicates every event, so block it.
  const { data: existing } = await admin
    .from("calendar_sources")
    .select("id")
    .eq("source_type", "ics")
    .eq("ics_url", icsUrl)
    .limit(1);
  if (existing && existing.length > 0) {
    throw new Error("That calendar is already subscribed.");
  }

  const { data, error } = await admin
    .from("calendar_sources")
    .insert({
      member_email: input.memberEmail,
      source_type: "ics",
      ics_url: icsUrl,
      nickname: input.nickname.trim() || null,
      color: input.color,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't add the calendar.");
  revalidatePath("/calendar");
  revalidatePath("/settings/calendars");
  return data.id as string;
}

/** Rename a calendar source — sets the nickname shown wherever the calendar
 * appears. Owner/parent only. */
export async function renameSource(id: string, nickname: string): Promise<void> {
  await requireParent();
  const trimmed = nickname.trim();
  if (!trimmed) throw new Error("A name is required.");
  const admin = createAdminClient();
  const { error } = await admin
    .from("calendar_sources")
    .update({ nickname: trimmed })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/calendar");
  revalidatePath("/settings/calendars");
}

export async function deleteSource(id: string): Promise<void> {
  await requireParent();
  const admin = createAdminClient();
  // Its events go to calendar_source_id NULL (ON DELETE SET NULL); clear them so
  // synced rows don't linger as orphans.
  await admin.from("calendar_events").delete().eq("calendar_source_id", id);
  const { error } = await admin.from("calendar_sources").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/calendar");
  revalidatePath("/settings/calendars");
}

/** Return (creating if needed) the outbound feed token for a member's calendar. */
export async function ensureFeedToken(memberEmail: string): Promise<string> {
  await requireParent();
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("ical_feed_tokens")
    .select("token")
    .eq("member_email", memberEmail)
    .maybeSingle();
  if (existing?.token) return existing.token as string;

  const { data, error } = await admin
    .from("ical_feed_tokens")
    .insert({ member_email: memberEmail })
    .select("token")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't create the feed.");
  return data.token as string;
}

/** Lightweight sync run on page load: refreshes the event list but skips the
 * per-event TeamSnap RSVP fetch, so it doesn't compete with the first event the
 * user opens (which loads its own availability live). */
export async function triggerSync(): Promise<void> {
  await requireUserId(await createClient()); // any signed-in member may trigger
  await runCalendarSync({ teamsnapRsvp: false });
  revalidatePath("/calendar");
}

/** Full sync including every player's RSVP — used by the manual "Sync" button,
 * where the user is explicitly asking to pull everything and waits for it. */
export async function triggerFullSync(): Promise<void> {
  await requireUserId(await createClient());
  await runCalendarSync();
  revalidatePath("/calendar");
}

// --- Google Calendar --------------------------------------------------------

/** Emails of members who have connected their Google account (signed in with the
 * calendar grant). Lets the settings UI show a picker vs. a "not connected" note
 * per member. */
export async function listGoogleConnectedEmails(): Promise<string[]> {
  await requireParent();
  const admin = createAdminClient();
  const { data } = await admin
    .from("google_connections")
    .select("member_email");
  return (data ?? []).map((r) => r.member_email as string);
}

/** A connected member's Google calendars (for the add picker). The token belongs
 * to `connectionEmail` — that member's own account. */
export async function listGoogleCalendarsForConnection(
  connectionEmail: string,
): Promise<GoogleCalendarListEntry[]> {
  await requireParent();
  return listGoogleCalendars(connectionEmail);
}

/** Add a Google calendar as a source, then sync it immediately. `connectionEmail`
 * is whose token reaches the calendar; `memberEmail` is the group it shows under
 * (null = family-wide, e.g. a shared calendar added from a parent's account). */
export async function addGoogleSource(input: {
  memberEmail: string | null;
  connectionEmail: string;
  googleCalendarId: string;
  nickname: string;
  color: string | null;
}): Promise<void> {
  await requireParent();
  const admin = createAdminClient();

  // Adding the same calendar from the same account twice would duplicate events.
  const { data: existing } = await admin
    .from("calendar_sources")
    .select("id")
    .eq("source_type", "google")
    .eq("google_calendar_id", input.googleCalendarId)
    .eq("google_connection_email", input.connectionEmail)
    .limit(1);
  if (existing && existing.length > 0) {
    throw new Error("That calendar is already added.");
  }

  const { data, error } = await admin
    .from("calendar_sources")
    .insert({
      member_email: input.memberEmail,
      source_type: "google",
      google_calendar_id: input.googleCalendarId,
      google_connection_email: input.connectionEmail,
      nickname: input.nickname.trim() || null,
      color: input.color,
    })
    .select("id")
    .single();
  if (error || !data)
    throw new Error(error?.message ?? "Couldn't add the calendar.");

  await syncGoogleSource(data.id as string).catch(() => {});
  revalidatePath("/calendar");
  revalidatePath("/settings/calendars");
}

// --- TeamSnap ---------------------------------------------------------------

/** Whether the current parent has a TeamSnap connection. */
export async function hasTeamsnapConnection(): Promise<boolean> {
  const email = await requireParent();
  const admin = createAdminClient();
  const { data } = await admin
    .from("teamsnap_connections")
    .select("member_email")
    .eq("member_email", email)
    .maybeSingle();
  return !!data;
}

/** The current parent's TeamSnap teams (for the "add a team" picker). */
export async function listTeamsnapTeams(): Promise<
  { id: number; name: string }[]
> {
  const email = await requireParent();
  const token = await getValidToken(email);
  const me = await getTeamsnapMe(token);
  const teams = await getTeamsnapTeams(token, me.id);
  return teams
    .filter((t) => !t.is_archived_season)
    .map((t) => ({ id: t.id, name: t.name }));
}

/** The players on a team (for picking which one this calendar belongs to). */
export async function listTeamsnapPlayers(
  teamId: number,
): Promise<{ id: number; name: string }[]> {
  const email = await requireParent();
  return listTeamPlayers(email, teamId);
}

/** Add a TeamSnap team as a source for a kid, then sync it immediately. The
 * player member id links the team's roster to this kid so their RSVP can be read
 * and written back; the connection email records whose token reaches the team. */
export async function addTeamsnapSource(input: {
  teamId: number;
  teamName: string;
  memberEmail: string | null;
  playerMemberId: number | null;
  color: string | null;
}): Promise<void> {
  const connectionEmail = await requireParent();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calendar_sources")
    .insert({
      member_email: input.memberEmail,
      source_type: "teamsnap",
      teamsnap_team_id: input.teamId,
      teamsnap_team_name: input.teamName,
      teamsnap_player_member_id: input.playerMemberId,
      teamsnap_connection_email: connectionEmail,
      nickname: input.teamName,
      color: input.color,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't add the team.");
  await syncTeamEvents(connectionEmail, data.id as string).catch(() => {});
  revalidatePath("/calendar");
  revalidatePath("/settings/calendars");
}

/** Link (or change) which roster player an existing TeamSnap source represents,
 * then refresh that player's RSVP. Lets teams added before player-linking get
 * attendance without being removed and re-added. */
export async function relinkTeamsnapPlayer(
  sourceId: string,
  playerMemberId: number | null,
): Promise<void> {
  const connectionEmail = await requireParent();
  const admin = createAdminClient();
  const { error } = await admin
    .from("calendar_sources")
    .update({
      teamsnap_player_member_id: playerMemberId,
      teamsnap_connection_email: connectionEmail,
    })
    .eq("id", sourceId)
    .eq("source_type", "teamsnap");
  if (error) throw new Error(error.message);
  // Pull the newly-linked player's RSVP onto existing events.
  await syncTeamEvents(connectionEmail, sourceId).catch(() => {});
  revalidatePath("/calendar");
  revalidatePath("/settings/calendars");
}

// --- TeamSnap attendance ----------------------------------------------------

/** Read the whole team's RSVP roster for an event. Any signed-in member. */
export async function fetchEventTeamAvailability(
  eventId: string,
): Promise<TeamAvailability | { error: string }> {
  await requireUserId(await createClient());
  return getEventTeamAvailability(eventId);
}

/** Mark the linked player's RSVP for an event, writing it back to TeamSnap.
 * Owner/parent only (kids see the calendar read-only). */
export async function markEventRsvp(
  eventId: string,
  status: Exclude<TeamsnapRsvp, "no_reply">,
): Promise<{ ok: true } | { error: string }> {
  await requireParent();
  const result = await setEventRsvp(eventId, status);
  if ("error" in result) return result;
  revalidatePath("/calendar");
  return result;
}
