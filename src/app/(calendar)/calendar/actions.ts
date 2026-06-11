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
  shareCalendar,
  type GoogleCalendarListEntry,
} from "@/lib/calendar/google";
import { syncGoogleSource } from "@/lib/calendar/google-sync";
import { cancelSourceMaterializations } from "@/lib/calendar/materialize";
import type { Duty } from "@/lib/calendar/drive-events";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  changeCalendarEventOwner,
  setGoing,
  setDuty,
} from "@/lib/calendar/mutations";
import { geocodeAddress } from "@/lib/calendar/geocoding";

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

// The mutation bodies live in @/lib/calendar/mutations (shared with the
// token-authenticated agent API); these wrappers add the session auth.
// Type aliases (not `export type {...}` re-exports) because the server-action
// transform rejects re-export syntax in a "use server" file.
export type ManualEventInput = import("@/lib/calendar/mutations").ManualEventInput;
export type DutyState = import("@/lib/calendar/mutations").DutyState;

export async function createManualEvent(input: ManualEventInput): Promise<string> {
  await requireParent();
  return createCalendarEvent(input);
}

export async function updateManualEvent(
  id: string,
  input: ManualEventInput,
): Promise<void> {
  await requireParent();
  return updateCalendarEvent(id, input);
}

export async function deleteEvent(id: string): Promise<void> {
  await requireParent();
  return deleteCalendarEvent(id);
}

/** Move an event to a different family member's calendar (the Edit form's
 * Calendar picker). Owner/parent only. */
export async function changeEventOwner(
  eventId: string,
  newOwnerEmail: string,
): Promise<{ ok: true; warning?: string } | { error: string }> {
  await requireParent();
  return changeCalendarEventOwner(eventId, newOwnerEmail);
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

  // If this source materialized events onto a kid's Google calendar, delete those
  // real events first — otherwise removing the source orphans them on Google with
  // no record to find them by.
  const { data: source } = await admin
    .from("calendar_sources")
    .select("id, member_email")
    .eq("id", id)
    .maybeSingle();
  if (source) await cancelSourceMaterializations(admin, source);

  // Its events go to calendar_source_id NULL (ON DELETE SET NULL); clear them so
  // synced rows don't linger as orphans.
  await admin.from("calendar_events").delete().eq("calendar_source_id", id);
  const { error } = await admin.from("calendar_sources").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/calendar");
  revalidatePath("/settings/calendars");
}

/** Lightweight sync run on page load: refreshes the event list but skips the
 * per-event TeamSnap RSVP fetch, so it doesn't compete with the first event the
 * user opens (which loads its own availability live). */
export async function triggerSync(): Promise<void> {
  await requireUserId(await createClient()); // any signed-in member may trigger
  // Page-load: light + no Google writes (those run on the cron/full sync only).
  await runCalendarSync({ teamsnapRsvp: false, materialize: false });
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
  return listGoogleCalendars({ kind: "oauth", memberEmail: connectionEmail });
}

// --- Primary calendar setup -------------------------------------------------

/** Set up a member's primary calendar in "managed" mode: the app acts AS them via
 * domain-wide delegation (no login from them). Auto-detects their primary Google
 * calendar and shares it with the other parents so the family sees it natively.
 * Owner/parent only — this is how an admin sets up the kids (and other adults). */
export async function setupManagedPrimary(
  memberEmail: string,
  // Optional explicit calendar; omit to auto-pick their account's primary.
  override?: { calendarId: string; summary: string },
): Promise<{ ok: true; calendarId: string } | { error: string }> {
  await requireParent();
  const admin = createAdminClient();

  let calendarId: string;
  let summary: string | null;
  if (override) {
    calendarId = override.calendarId;
    summary = override.summary;
  } else {
    let calendars: GoogleCalendarListEntry[];
    try {
      calendars = await listGoogleCalendars({ kind: "dwd", subjectEmail: memberEmail });
    } catch (e) {
      return {
        error:
          e instanceof Error
            ? `Couldn't reach ${memberEmail}'s Google account: ${e.message}`
            : "Couldn't reach their Google account.",
      };
    }
    // Their primary calendar (id is normally their email); fall back gracefully.
    const primary =
      calendars.find((c) => c.primary) ??
      calendars.find((c) => c.id === memberEmail) ??
      calendars[0];
    if (!primary) return { error: `No Google calendar found for ${memberEmail}.` };
    calendarId = primary.id;
    summary = primary.summary;
  }

  const { error } = await admin
    .from("family_members")
    .update({
      primary_calendar_id: calendarId,
      primary_calendar_connection: memberEmail,
      primary_calendar_mode: "managed",
      primary_calendar_summary: summary,
    })
    .eq("email", memberEmail);
  if (error) return { error: error.message };

  // Read this calendar's existing events into the app (via delegation, since the
  // member never signs in) by ensuring a Google source for it, then syncing.
  const { data: existing } = await admin
    .from("calendar_sources")
    .select("id")
    .eq("source_type", "google")
    .eq("member_email", memberEmail)
    .eq("google_calendar_id", calendarId)
    .maybeSingle();
  let sourceId = existing?.id as string | undefined;
  if (!sourceId) {
    const { data: ins } = await admin
      .from("calendar_sources")
      .insert({
        member_email: memberEmail,
        source_type: "google",
        google_calendar_id: calendarId,
        google_connection_email: memberEmail,
        nickname: summary,
      })
      .select("id")
      .single();
    sourceId = ins?.id as string | undefined;
  }
  if (sourceId) await syncGoogleSource(sourceId).catch(() => {});

  // Share it (read-only) with the other parents so they see it natively and can
  // be guests on its events. Best-effort: a failed share doesn't fail setup.
  const { data: parents } = await admin
    .from("family_members")
    .select("email")
    .in("role", ["owner", "parent"])
    .neq("email", memberEmail);
  for (const p of parents ?? []) {
    try {
      await shareCalendar(
        { kind: "dwd", subjectEmail: memberEmail },
        calendarId,
        p.email as string,
      );
    } catch {
      // ignore — the parent can be shared manually if this fails
    }
  }

  revalidatePath("/settings/calendars");
  revalidatePath("/calendar");
  return { ok: true, calendarId };
}

/** A managed member's calendars (writable ones), so an owner can pick which is
 * their primary instead of accepting the auto-detected one. */
export async function listManagedCalendars(
  memberEmail: string,
): Promise<GoogleCalendarListEntry[]> {
  await requireParent();
  const all = await listGoogleCalendars({ kind: "dwd", subjectEmail: memberEmail });
  return all.filter((c) => c.accessRole === "owner" || c.accessRole === "writer");
}

/** Set a member's primary calendar in "connected" mode: written via that person's
 * own Google OAuth token (an adult who signed in and picked one of their own
 * calendars). Also ensures the calendar is a synced source so its events show in
 * the app — done here rather than by the client calling addGoogleSource, because
 * the expected "already added" case must be a no-op: thrown action errors are
 * masked in production builds, so the client can't tell it apart from a real
 * failure. */
export async function setConnectedPrimary(
  memberEmail: string,
  calendarId: string,
  summary: string,
  color?: string | null,
): Promise<{ ok: true } | { error: string }> {
  await requireParent();
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("calendar_sources")
    .select("id")
    .eq("source_type", "google")
    .eq("google_calendar_id", calendarId)
    .eq("google_connection_email", memberEmail)
    .limit(1);
  let sourceId = existing?.[0]?.id as string | undefined;
  if (!sourceId) {
    const { data: ins, error: insError } = await admin
      .from("calendar_sources")
      .insert({
        member_email: memberEmail,
        source_type: "google",
        google_calendar_id: calendarId,
        google_connection_email: memberEmail,
        nickname: summary.trim() || null,
        color: color ?? null,
      })
      .select("id")
      .single();
    if (insError || !ins)
      return { error: insError?.message ?? "Couldn't add the calendar." };
    sourceId = ins.id as string;
  }

  const { error } = await admin
    .from("family_members")
    .update({
      primary_calendar_id: calendarId,
      primary_calendar_connection: memberEmail,
      primary_calendar_mode: "connected",
      primary_calendar_summary: summary,
    })
    .eq("email", memberEmail);
  if (error) return { error: error.message };

  await syncGoogleSource(sourceId).catch(() => {});
  revalidatePath("/settings/calendars");
  revalidatePath("/calendar");
  return { ok: true };
}

/** Clear a member's primary calendar (stops imports until set up again). */
export async function clearPrimaryCalendar(memberEmail: string): Promise<void> {
  await requireParent();
  const admin = createAdminClient();
  await admin
    .from("family_members")
    .update({
      primary_calendar_id: null,
      primary_calendar_connection: null,
      primary_calendar_mode: null,
    })
    .eq("email", memberEmail);
  revalidatePath("/settings/calendars");
  revalidatePath("/calendar");
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

// --- "Going" (who's attending) ----------------------------------------------

/** Toggle whether a family member is "going" to an event. Stored in
 * event_attendees (the durable source of truth, survives re-sync) and reconciled
 * to the event's real Google guest list when it's a materialized event. Binary —
 * distinct from TeamSnap's player RSVP. Owner/parent only. */
export async function setEventGoing(
  eventId: string,
  memberEmail: string,
  going: boolean,
): Promise<{ ok: true; warning?: string } | { error: string }> {
  await requireParent();
  return setGoing(eventId, memberEmail, going);
}

// --- Drop-off / pick-up duty ------------------------------------------------

/** Set (or clear) who's doing drop-off / pick-up for a kid's event. Owner/parent
 * only. See setDuty in @/lib/calendar/mutations for the mechanics. */
export async function setEventDuty(
  eventId: string,
  duty: Duty,
  state: DutyState,
): Promise<{ ok: true } | { error: string }> {
  await requireParent();
  return setDuty(eventId, duty, state);
}

// --- Logistics settings (home address, buffer) --------------------------------

export type LogisticsSettingsView = {
  homeAddress: string;
  bufferMinutes: number;
  homeGeocoded: boolean;
};

export async function getLogisticsSettingsView(): Promise<LogisticsSettingsView | null> {
  await requireParent();
  const admin = createAdminClient();
  const { data } = await admin
    .from("calendar_logistics_settings")
    .select("home_address, drive_buffer_minutes, home_lat, home_lng")
    .eq("id", 1)
    .maybeSingle();
  if (!data) return null;
  return {
    homeAddress: data.home_address as string,
    bufferMinutes: data.drive_buffer_minutes as number,
    homeGeocoded: data.home_lat != null && data.home_lng != null,
  };
}

/** Save the home address + arrive-early buffer. Geocodes inline (one Nominatim
 * call); a failed geocode still saves and the cron retries. Changed values flow
 * into every block via the sweep's hash check. */
export async function updateLogisticsSettings(input: {
  homeAddress: string;
  bufferMinutes: number;
}): Promise<{ ok: true; geocoded: boolean } | { error: string }> {
  await requireParent();
  const address = input.homeAddress.trim();
  if (!address) return { error: "A home address is required." };
  const buffer = Math.max(0, Math.min(60, Math.round(input.bufferMinutes)));

  const geo = await geocodeAddress(address).catch(() => null);

  const admin = createAdminClient();
  const { error } = await admin.from("calendar_logistics_settings").upsert({
    id: 1,
    home_address: address,
    drive_buffer_minutes: buffer,
    home_lat: geo?.lat ?? null,
    home_lng: geo?.lng ?? null,
    home_geocoded_at: geo ? new Date().toISOString() : null,
  });
  if (error) return { error: error.message };

  revalidatePath("/settings/calendars");
  revalidatePath("/calendar");
  return { ok: true, geocoded: !!geo };
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
