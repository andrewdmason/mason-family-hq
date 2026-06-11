// Core calendar mutations, shared by the signed-in server actions
// (src/app/(calendar)/calendar/actions.ts, which wrap these with requireParent)
// and the token-authenticated agent API (src/app/api/agent/calendar/*). No auth
// here — callers are responsible for it. All writes go through the service-role
// client; Google/TeamSnap side effects match what the UI does.

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  insertGoogleEvent,
  patchGoogleEvent,
  deleteGoogleEvent,
  getGoogleEvent,
  eventToGoogleBody,
  type GoogleCredential,
} from "@/lib/calendar/google";
import {
  credForMember,
  syncEventGuests,
  importerEnabled,
  getMemberPrimary,
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
import { allDayInstant, isHomeLocation } from "@/lib/calendar/calendar-utils";

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
  cred: GoogleCredential;
};

/** Resolve a calendar source to a Google write target, or null if it isn't a
 * (writable) Google source. Managed members (kids, who never sign in) write via
 * domain-wide delegation; connected members via their own OAuth token. */
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

export async function createCalendarEvent(
  input: ManualEventInput,
): Promise<string> {
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
  if (error || !data)
    throw new Error(error?.message ?? "Couldn't create the event.");
  revalidatePath("/calendar");
  return data.id as string;
}

export async function updateCalendarEvent(
  id: string,
  input: ManualEventInput,
): Promise<void> {
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

export async function deleteCalendarEvent(id: string): Promise<void> {
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
    await deleteDriveEvent(admin, a as unknown as DutyAssignmentRow).catch(
      () => {},
    );
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
 * owner. */
export async function changeCalendarEventOwner(
  eventId: string,
  newOwnerEmail: string,
): Promise<{ ok: true; warning?: string } | { error: string }> {
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

/** Toggle whether a family member is "going" to an event. Stored in
 * event_attendees (the durable source of truth, survives re-sync) and reconciled
 * to the event's real Google guest list when it's a materialized event. Binary —
 * distinct from TeamSnap's player RSVP. */
export async function setGoing(
  eventId: string,
  memberEmail: string,
  going: boolean,
): Promise<{ ok: true; warning?: string } | { error: string }> {
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

/** A duty's saved state: assigned to a parent, explicitly not needed (N/A), or
 * unset (null — no row). */
export type DutyState = { assignee: string | null; isNa: boolean } | null;

/** Set (or clear) who's doing drop-off / pick-up for a kid's event. Only the
 * DB write (the source of truth) happens before the response — every Google
 * call (drive-block create/move/delete) runs via after(), so callers never
 * block on the Calendar API. The cron sweep is the safety net if the deferred
 * work dies. */
export async function setDuty(
  eventId: string,
  duty: Duty,
  state: DutyState,
): Promise<{ ok: true } | { error: string }> {
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
  // after the response — the caller shouldn't wait on the Calendar API.
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
