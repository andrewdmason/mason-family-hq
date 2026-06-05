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
  memberEmail: string | null;
  title: string;
  location: string | null;
  description: string | null;
  startTime: string; // ISO
  endTime: string | null; // ISO
  allDay: boolean;
};

function eventColumns(input: ManualEventInput) {
  return {
    member_email: input.memberEmail,
    title: input.title.trim(),
    location: input.location?.trim() || null,
    description: input.description?.trim() || null,
    start_time: input.startTime,
    end_time: input.endTime,
    all_day: input.allDay,
    source_type: "manual" as const,
  };
}

export async function createManualEvent(input: ManualEventInput): Promise<string> {
  await requireParent();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calendar_events")
    .insert(eventColumns(input))
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
  const { error } = await admin
    .from("calendar_events")
    .update(eventColumns(input))
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/calendar");
}

export async function deleteEvent(id: string): Promise<void> {
  await requireParent();
  const admin = createAdminClient();
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

/** Run a sync of all sources, then refresh the calendar. Called on load. */
export async function triggerSync(): Promise<void> {
  await requireUserId(await createClient()); // any signed-in member may trigger
  await runCalendarSync();
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

/** Add a TeamSnap team as a source for a kid, then sync it immediately. */
export async function addTeamsnapSource(input: {
  teamId: number;
  teamName: string;
  memberEmail: string | null;
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
