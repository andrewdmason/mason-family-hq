"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
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
  getGoogleEvent,
  shareCalendar,
  eventToGoogleBody,
  type GoogleCalendarListEntry,
  type GoogleCredential,
} from "@/lib/calendar/google";
import { syncGoogleSource } from "@/lib/calendar/google-sync";
import {
  cancelSourceMaterializations,
  syncEventGuests,
  importerEnabled,
  getMemberPrimary,
  credForMember,
} from "@/lib/calendar/materialize";
import {
  reconcileEventDrive,
  reconcileDriveAround,
  deleteDriveEvent,
  queueDriveWork,
  ASSIGNMENT_COLUMNS,
  type DutyAssignmentRow,
  type Duty,
} from "@/lib/calendar/drive-events";
import { geocodeAddress } from "@/lib/calendar/geocoding";
import { allDayInstant, isHomeLocation } from "@/lib/calendar/calendar-utils";

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
  // Reaches the calendar: delegation for a managed member (kids), their own
  // OAuth token otherwise.
  cred: GoogleCredential;
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
    cred: await credForMember(admin, src.member_email, connectionEmail),
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
      target.cred,
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
      target.cred,
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
    .select("id, source_type, calendar_source_id, external_id, start_time")
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
        target.cred,
        target.googleCalendarId,
        ev.external_id.slice("google:".length),
      );
    }
  }

  // Drive blocks this event's duty assignments materialized live on a PARENT's
  // Google calendar — delete them BEFORE the row delete, because the cascade
  // erases the assignment ledger (the only record of where the blocks live).
  const { data: duties } = await admin
    .from("event_duty_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("event_id", id);
  for (const a of duties ?? []) {
    await deleteDriveEvent(admin, a as unknown as DutyAssignmentRow).catch(() => {});
  }

  const { error } = await admin.from("calendar_events").delete().eq("id", id);
  if (error) throw new Error(error.message);

  // A deleted event's blocks may have been merged with a neighbor's (one
  // multi-stop trip) — re-expand the survivors after the response.
  if (duties?.length && ev?.start_time) {
    const startTime = ev.start_time as string;
    after(() =>
      queueDriveWork(async () => {
        try {
          await reconcileDriveAround(admin, startTime);
          revalidatePath("/calendar");
        } catch (err) {
          // best-effort: the next sweep finishes the job
          console.error(
            `[drive] neighborhood reconcile failed after event delete (${id}):`,
            err instanceof Error ? err.message : err,
          );
        }
      }),
    );
  }
  revalidatePath("/calendar");
}

/** After an owner change, bring the event's drive logistics in line with the new
 * owner: a kid's event gets its blocks reconciled (renamed/reshaped) after the
 * response; anyone else's event can't carry duties at all, so existing
 * assignments and their blocks are torn down. */
async function settleDutiesForNewOwner(
  admin: ReturnType<typeof createAdminClient>,
  eventId: string,
  newOwnerRole: string | undefined,
): Promise<void> {
  const { data: duties } = await admin
    .from("event_duty_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("event_id", eventId);
  if (!duties?.length) return;

  if (newOwnerRole === "kid") {
    after(() =>
      queueDriveWork(async () => {
        try {
          await reconcileEventDrive(admin, eventId);
          revalidatePath("/calendar");
        } catch (err) {
          // best-effort: the next sweep reshapes the blocks
          console.error(
            `[drive] reconcile failed after owner change (event ${eventId}):`,
            err instanceof Error ? err.message : err,
          );
        }
      }),
    );
    return;
  }

  for (const a of duties) {
    await deleteDriveEvent(admin, a as unknown as DutyAssignmentRow).catch(() => {});
  }
  await admin.from("event_duty_assignments").delete().eq("event_id", eventId);
}

/** Move an event to a different family member — "oh, this is actually Oscar's
 * event". For a Google event it's re-created on the new owner's primary calendar
 * with the previous organizer and guests invited (so it still shows on their
 * calendars, now as guests), and the original is deleted — which also clears
 * every guest's old copy. The app row is repointed in place so its id (and the
 * going/duty state hanging off it) survives. App-only manual events just change
 * owner. Owner/parent only. */
export async function changeEventOwner(
  eventId: string,
  newOwnerEmail: string,
): Promise<{ ok: true; warning?: string } | { error: string }> {
  await requireParent();
  const admin = createAdminClient();

  const { data: ev } = await admin
    .from("calendar_events")
    .select(
      "id, member_email, source_type, calendar_source_id, external_id, organizer_email, title, location, description, start_time, end_time, all_day",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) return { error: "Event not found." };
  if (ev.member_email === newOwnerEmail) return { ok: true };

  const { data: famRows } = await admin
    .from("family_members")
    .select("email, name, role");
  const family = new Map((famRows ?? []).map((m) => [m.email as string, m]));
  const newOwner = family.get(newOwnerEmail);
  if (!newOwner) return { error: "Unknown family member." };
  const ownerName = (newOwner.name as string | null) ?? newOwnerEmail;

  // App-only event: ownership is just the row's member.
  if (ev.source_type === "manual") {
    const { error } = await admin
      .from("calendar_events")
      .update({ member_email: newOwnerEmail })
      .eq("id", eventId);
    if (error) return { error: error.message };
    await settleDutiesForNewOwner(admin, eventId, newOwner.role as string);
    revalidatePath("/calendar");
    return { ok: true };
  }

  if (
    ev.source_type !== "google" ||
    !ev.external_id?.startsWith("google:") ||
    !ev.calendar_source_id
  ) {
    return { error: "Only Google and app-only events can be reassigned." };
  }

  // Where the event should live: the new owner's primary calendar.
  const dest = await getMemberPrimary(admin, newOwnerEmail);
  if (!dest) {
    return { error: `${ownerName} doesn't have a Google calendar set up yet.` };
  }

  // Where it lives now: the row's source calendar + a credential that can
  // delete from it (delegation for managed members, OAuth otherwise).
  const src = await googleTarget(admin, ev.calendar_source_id);
  if (!src) return { error: "This calendar is no longer connected." };
  const fromCred = src.cred;
  const oldGoogleId = ev.external_id.slice("google:".length);

  // Already on the right calendar (e.g. a shared calendar synced for several
  // members) — just re-attribute the row, no Google churn.
  if (src.googleCalendarId === dest.calendarId) {
    const { error } = await admin
      .from("calendar_events")
      .update({ member_email: newOwnerEmail })
      .eq("id", eventId);
    if (error) return { error: error.message };
    await settleDutiesForNewOwner(admin, eventId, newOwner.role as string);
    revalidatePath("/calendar");
    return { ok: true };
  }

  // The new guest list: everyone already invited, plus the previous organizer
  // (when they're family — Jenny stays on the event she created) and anyone
  // toggled "going", minus the new owner (they're the organizer now).
  const current = await getGoogleEvent(fromCred, src.googleCalendarId, oldGoogleId);
  const byEmail = new Map<string, { email: string; responseStatus?: string }>();
  for (const a of current?.attendees ?? []) {
    if (a.email) {
      byEmail.set(a.email.toLowerCase(), {
        email: a.email,
        responseStatus: a.responseStatus,
      });
    }
  }
  const oldOrganizer = (ev.organizer_email as string | null) ?? src.memberEmail;
  if (oldOrganizer && family.has(oldOrganizer)) {
    byEmail.set(oldOrganizer, { email: oldOrganizer, responseStatus: "accepted" });
  }
  const { data: goingRows } = await admin
    .from("event_attendees")
    .select("member_email")
    .eq("event_id", eventId)
    .eq("going", true);
  for (const r of goingRows ?? []) {
    const email = (r.member_email as string).toLowerCase();
    if (!byEmail.has(email)) byEmail.set(email, { email, responseStatus: "accepted" });
  }
  byEmail.delete(newOwnerEmail.toLowerCase());
  byEmail.delete(dest.calendarId.toLowerCase());

  // Create on the new calendar first — if this fails, nothing has changed.
  // Invites land on guests' calendars without email noise (sendUpdates none).
  const created = await insertGoogleEvent(
    dest.cred,
    dest.calendarId,
    {
      ...eventToGoogleBody({
        title: ev.title as string,
        location: ev.location as string | null,
        description: ev.description as string | null,
        startTime: ev.start_time as string,
        endTime: ev.end_time as string | null,
        allDay: ev.all_day as boolean,
      }),
      attendees: [...byEmail.values()],
    },
    { sendUpdates: "none" },
  );

  // Repoint the row at the new Google event, keeping its id so event_attendees
  // and duty assignments survive. The new owner's primary calendar is normally a
  // synced source — attach to it so the next sync upserts in place.
  const { data: destSrc } = await admin
    .from("calendar_sources")
    .select("id")
    .eq("source_type", "google")
    .eq("google_calendar_id", dest.calendarId)
    .eq("member_email", newOwnerEmail)
    .limit(1)
    .maybeSingle();
  const { error: updateError } = await admin
    .from("calendar_events")
    .update({
      member_email: newOwnerEmail,
      calendar_source_id: destSrc?.id ?? null,
      external_id: `google:${created.id}`,
      organizer_email:
        created.organizer?.email?.toLowerCase() ?? newOwnerEmail.toLowerCase(),
    })
    .eq("id", eventId);
  if (updateError) {
    // Roll the orphan back so sync doesn't ingest a duplicate.
    await deleteGoogleEvent(dest.cred, dest.calendarId, created.id, {
      sendUpdates: "none",
    }).catch(() => {});
    return { error: updateError.message };
  }

  // Other members' synced copies of the OLD event collapse into this row's
  // logical event today; the delete below cancels them on Google, so drop the
  // rows now rather than leaving cancelled ghosts until the next sync.
  await admin
    .from("calendar_events")
    .delete()
    .eq("external_id", `google:${oldGoogleId}`)
    .neq("id", eventId);

  // Record the invited family members as going so the avatars are right
  // immediately (sync would converge anyway via their guest copies).
  const invitedFamily = [...byEmail.keys()].filter((e) => family.has(e));
  if (invitedFamily.length) {
    await admin.from("event_attendees").upsert(
      invitedFamily.map((email) => ({
        event_id: eventId,
        member_email: email,
        going: true,
      })),
      { onConflict: "event_id,member_email" },
    );
  }
  await admin
    .from("event_attendees")
    .delete()
    .eq("event_id", eventId)
    .eq("member_email", newOwnerEmail);

  await settleDutiesForNewOwner(admin, eventId, newOwner.role as string);

  // Delete the original last — it's the most forgiving step (already-gone is
  // success), and everything above already points at the new event.
  let warning: string | undefined;
  try {
    await deleteGoogleEvent(fromCred, src.googleCalendarId, oldGoogleId, {
      sendUpdates: "none",
    });
  } catch {
    const fromName = src.memberEmail
      ? family.get(src.memberEmail)?.name ?? src.memberEmail
      : "the original";
    warning = `Moved to ${ownerName}'s calendar, but the original couldn't be removed from ${fromName}'s calendar — delete it there manually.`;
  }

  revalidatePath("/calendar");
  return warning ? { ok: true, warning } : { ok: true };
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
  const admin = createAdminClient();

  const { error } = await admin
    .from("event_attendees")
    .upsert(
      { event_id: eventId, member_email: memberEmail, going },
      { onConflict: "event_id,member_email" },
    );
  if (error) return { error: error.message };

  let warning: string | undefined;
  if (importerEnabled()) {
    try {
      await syncEventGuests(admin, eventId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // Google forbids guests on events it auto-created from Gmail (and some
      // other special types). Save the in-app state but tell the user why no
      // invite went out.
      if (/eventtyperestriction|fromgmail/i.test(msg)) {
        warning =
          "Saved here, but Google won't add guests to this event (it was created from Gmail).";
      }
      // Other failures are best-effort: state is saved and re-asserted on sync.
    }
  }

  // Going reshapes any drive block this member holds on the event (round trip
  // ↔ one-way leg) — reconcile after the response, same as duty taps. Gated on
  // an actual assignment so plain attendance toggles stay free.
  const { data: heldDuty } = await admin
    .from("event_duty_assignments")
    .select("id")
    .eq("event_id", eventId)
    .eq("assignee_email", memberEmail)
    .limit(1)
    .maybeSingle();
  if (heldDuty) {
    after(() =>
      queueDriveWork(async () => {
        try {
          await reconcileEventDrive(admin, eventId);
          revalidatePath("/calendar");
        } catch (err) {
          // best-effort: the next sweep reshapes the block
          console.error(
            `[drive] reconcile failed after going change (event ${eventId}):`,
            err instanceof Error ? err.message : err,
          );
        }
      }),
    );
  }

  revalidatePath("/calendar");
  return warning ? { ok: true, warning } : { ok: true };
}

// --- Drop-off / pick-up duty ------------------------------------------------

/** A duty's saved state: assigned to a parent, explicitly not needed (N/A), or
 * unset (null — no row). */
export type DutyState = { assignee: string | null; isNa: boolean } | null;

/** Set (or clear) who's doing drop-off / pick-up for a kid's event. Only the
 * DB write (the source of truth) happens before the response — every Google
 * call (drive-block create/move/delete) runs via after(), so taps never block
 * on the Calendar API. The cron sweep is the safety net if the deferred work
 * dies. Owner/parent only. */
export async function setEventDuty(
  eventId: string,
  duty: Duty,
  state: DutyState,
): Promise<{ ok: true } | { error: string }> {
  await requireParent();
  const admin = createAdminClient();

  const { data: ev } = await admin
    .from("calendar_events")
    .select("id, member_email, all_day, drive_source_event_id, location")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) return { error: "Event not found." };
  if (ev.all_day || ev.drive_source_event_id) {
    return { error: "Drop-off/pick-up only applies to timed events." };
  }
  const { data: logistics } = await admin
    .from("calendar_logistics_settings")
    .select("home_address")
    .eq("id", 1)
    .maybeSingle();
  if (isHomeLocation(ev.location as string | null, logistics?.home_address)) {
    return { error: "This event is at home — no drive needed." };
  }
  const { data: owner } = await admin
    .from("family_members")
    .select("role")
    .eq("email", ev.member_email ?? "")
    .maybeSingle();
  if (owner?.role !== "kid") {
    return { error: "Drop-off/pick-up only applies to kids' events." };
  }
  if (state?.assignee) {
    const { data: assignee } = await admin
      .from("family_members")
      .select("role")
      .eq("email", state.assignee)
      .maybeSingle();
    if (!assignee || assignee.role === "kid") {
      return { error: "Only a parent can be assigned." };
    }
  }

  const { data: existing } = await admin
    .from("event_duty_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("event_id", eventId)
    .eq("duty", duty)
    .maybeSingle();

  // Unset: delete the row now; the Google teardown runs after the response,
  // working from the captured ledger (the deleted row's pointers live on in
  // `row`). The follow-up reconcile expands a sibling that had been folded
  // into a combined block back to its own round trip.
  if (state === null) {
    if (existing) {
      const row = existing as unknown as DutyAssignmentRow;
      await admin.from("event_duty_assignments").delete().eq("id", row.id);
      after(() =>
        queueDriveWork(async () => {
          try {
            await deleteDriveEvent(admin, row);
            await reconcileEventDrive(admin, eventId);
            revalidatePath("/calendar");
          } catch (err) {
            // best-effort: the next sweep finishes the job
            console.error(
              `[drive] teardown failed after duty clear (event ${eventId}):`,
              err instanceof Error ? err.message : err,
            );
          }
        }),
      );
    }
    revalidatePath("/calendar");
    return { ok: true };
  }

  const { data: row, error } = await admin
    .from("event_duty_assignments")
    .upsert(
      {
        event_id: eventId,
        duty,
        assignee_email: state.assignee,
        is_na: state.assignee ? false : state.isNa,
      },
      { onConflict: "event_id,duty" },
    )
    .select("id")
    .single();
  if (error || !row) return { error: error?.message ?? "Couldn't save." };

  // Event-level reconcile (both duties together, so giving one parent the
  // second duty can collapse two round trips into one combined block) runs
  // after the response — the tap shouldn't wait on the Calendar API.
  after(() =>
    queueDriveWork(async () => {
      try {
        await reconcileEventDrive(admin, eventId);
        revalidatePath("/calendar");
      } catch (err) {
        // best-effort: state is saved; the next sweep writes/moves the block
        console.error(
          `[drive] reconcile failed after duty change (event ${eventId}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }),
  );

  revalidatePath("/calendar");
  return { ok: true };
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
