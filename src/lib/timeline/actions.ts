"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/members/auth";
import type { DatePrecision, JournalMediaType, TimelineCategory, TimelineProminence } from "@/lib/types";

export type TimelineEntryInput = {
  title: string;
  description: string;
  category: TimelineCategory;
  prominence: TimelineProminence;
  location: string | null;
  /** Free-form: "1986" | "1999-06" | "2006-03-17". */
  start: string;
  end: string | null;
  approximate: boolean;
  /** Emails of the family members who are subjects of this event. */
  subjectEmails: string[];
};

// "1986" -> year/1986-01-01 ; "1999-06" -> month/1999-06-01 ; "2006-03-17" -> day
function parseDate(raw: string): { date: string; precision: DatePrecision } {
  const v = raw.trim();
  if (/^\d{4}$/.test(v)) return { date: `${v}-01-01`, precision: "year" };
  if (/^\d{4}-\d{2}$/.test(v)) return { date: `${v}-01`, precision: "month" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { date: v, precision: "day" };
  throw new Error(`Couldn't read the date "${raw}". Use a year, year-month, or year-month-day.`);
}

/** Throw unless the caller is a provisioned family member; the timeline is shared. */
async function requireFamilyMember(): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const { data } = await supabase
    .from("family_members")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Not authorized");
}

type Admin = ReturnType<typeof createAdminClient>;

/** Map family-member email -> their people-row id. */
async function familyPersonIdByEmail(admin: Admin): Promise<Map<string, string>> {
  const { data } = await admin.from("people").select("id, member_email").not("member_email", "is", null);
  const map = new Map<string, string>();
  for (const p of data ?? []) map.set((p.member_email as string).toLowerCase(), p.id as string);
  return map;
}

function entryColumns(input: TimelineEntryInput) {
  const start = parseDate(input.start);
  const end = input.end && input.end.trim() ? parseDate(input.end) : null;
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    category: input.category,
    prominence: input.prominence,
    location: input.location?.trim() || null,
    start_date: start.date,
    start_precision: start.precision,
    end_date: end?.date ?? null,
    end_precision: end?.precision ?? null,
    approximate: input.approximate,
  };
}

export async function createTimelineEntry(input: TimelineEntryInput): Promise<string> {
  await requireFamilyMember();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("timeline_entries")
    .insert(entryColumns(input))
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't create the event.");
  const id = data.id as string;

  const idByEmail = await familyPersonIdByEmail(admin);
  const rows = input.subjectEmails
    .map((email) => idByEmail.get(email.toLowerCase()))
    .filter((pid): pid is string => !!pid)
    .map((pid) => ({ timeline_entry_id: id, person_id: pid, role: "subject" }));
  if (rows.length > 0) {
    const { error: insErr } = await admin.from("timeline_entry_people").insert(rows);
    if (insErr) throw new Error(insErr.message);
  }

  revalidatePath("/timeline");
  return id;
}

export async function updateTimelineEntry(id: string, input: TimelineEntryInput): Promise<void> {
  await requireFamilyMember();
  const admin = createAdminClient();

  const { error } = await admin.from("timeline_entries").update(entryColumns(input)).eq("id", id);
  if (error) throw new Error(error.message);

  // Rebuild the family-member subject rows (leaving external mentions untouched).
  const idByEmail = await familyPersonIdByEmail(admin);
  const familyIds = [...idByEmail.values()];

  if (familyIds.length > 0) {
    await admin
      .from("timeline_entry_people")
      .delete()
      .eq("timeline_entry_id", id)
      .eq("role", "subject")
      .in("person_id", familyIds);
  }
  const rows = input.subjectEmails
    .map((email) => idByEmail.get(email.toLowerCase()))
    .filter((pid): pid is string => !!pid)
    .map((pid) => ({ timeline_entry_id: id, person_id: pid, role: "subject" }));
  if (rows.length > 0) {
    const { error: insErr } = await admin
      .from("timeline_entry_people")
      .upsert(rows, { onConflict: "timeline_entry_id,person_id" });
    if (insErr) throw new Error(insErr.message);
  }

  revalidatePath("/timeline");
}

export async function deleteTimelineEntry(id: string): Promise<void> {
  await requireFamilyMember();
  const admin = createAdminClient();
  // Joins cascade; linked journal entries keep their content (FK is SET NULL).
  const { error } = await admin.from("timeline_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/timeline");
}

// ---------------------------------------------------------------------------
// Direct photos pinned to an event (no journal post). Files live in the shared
// `journal-photos` bucket under {uid}/timeline/{eventId}/..., so a member only
// uploads/signs their own (per-user folder storage RLS); the account owner signs
// everyone's via the admin client (mirrors getEntriesPhotos).
// ---------------------------------------------------------------------------

const PHOTOS_BUCKET = "journal-photos";

/** Sign upload URLs for a photo being pinned to a timeline event. */
export async function createTimelinePhotoUploadUrls(
  timelineEntryId: string,
  photoId: string,
  ext: string
): Promise<{ originalPath: string; originalToken: string; displayPath: string; displayToken: string }> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const originalPath = `${userId}/timeline/${timelineEntryId}/${photoId}-original.${safeExt}`;
  const displayPath = `${userId}/timeline/${timelineEntryId}/${photoId}-display.jpg`;

  const original = await supabase.storage.from(PHOTOS_BUCKET).createSignedUploadUrl(originalPath);
  if (original.error || !original.data) throw new Error(original.error?.message ?? "Failed to create upload URL");
  const display = await supabase.storage.from(PHOTOS_BUCKET).createSignedUploadUrl(displayPath);
  if (display.error || !display.data) throw new Error(display.error?.message ?? "Failed to create upload URL");

  return {
    originalPath: original.data.path,
    originalToken: original.data.token,
    displayPath: display.data.path,
    displayToken: display.data.token,
  };
}

/** Record a pinned photo row once its bytes are uploaded. */
export async function attachTimelinePhoto(
  timelineEntryId: string,
  originalPath: string,
  displayPath: string,
  mediaType: JournalMediaType = "photo"
): Promise<string> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const { data, error } = await supabase
    .from("timeline_entry_photos")
    .insert({
      timeline_entry_id: timelineEntryId,
      user_id: userId,
      original_path: originalPath,
      display_path: displayPath,
      media_type: mediaType,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to attach photo");
  revalidatePath("/timeline");
  return data.id as string;
}

/** Remove one of your pinned photos (its storage files too). */
export async function deleteTimelinePhoto(photoId: string): Promise<void> {
  const supabase = await createClient();
  await requireUserId(supabase);
  // RLS scopes this select/delete to the caller's own rows.
  const { data: row } = await supabase
    .from("timeline_entry_photos")
    .select("original_path, display_path")
    .eq("id", photoId)
    .maybeSingle();
  if (row) {
    await supabase.storage
      .from(PHOTOS_BUCKET)
      .remove([row.original_path as string, row.display_path as string]);
  }
  const { error } = await supabase.from("timeline_entry_photos").delete().eq("id", photoId);
  if (error) throw new Error(error.message);
  revalidatePath("/timeline");
}

/** Signed display URLs for the pinned photos of each event. Owner signs all via
 * admin (cross-member); other members sign only their own (RLS). Videos also get
 * a signed URL for the original file so the lightbox can play them. */
export async function getTimelineEntriesPhotos(
  timelineEntryIds: string[]
): Promise<Record<string, { id: string; displayUrl: string; videoUrl: string | null; mediaType: JournalMediaType }[]>> {
  const result: Record<string, { id: string; displayUrl: string; videoUrl: string | null; mediaType: JournalMediaType }[]> = {};
  if (timelineEntryIds.length === 0) return result;
  // The timeline is shared: the table's read policy lets any family member read
  // every photo row, but the journal-photos bucket's per-user folder RLS only
  // lets a member sign files in their OWN folder. So sign with admin for every
  // viewer — otherwise a non-owner sees only the photos they personally pinned,
  // never other members' (e.g. the owner's). Reading with admin can't widen
  // visibility here because the rows are already family-readable.
  const client = createAdminClient();
  const { data: rows } = await client
    .from("timeline_entry_photos")
    .select("id, timeline_entry_id, display_path, original_path, media_type")
    .in("timeline_entry_id", timelineEntryIds)
    .order("created_at", { ascending: true });
  if (!rows || rows.length === 0) return result;

  const { data: signed } = await client.storage
    .from(PHOTOS_BUCKET)
    .createSignedUrls(rows.map((r) => r.display_path as string), 60 * 60);

  // Videos need a signed URL for the original file so the lightbox can play it.
  const videoRows = rows.filter((r) => r.media_type === "video");
  const { data: signedVideo } = videoRows.length
    ? await client.storage
        .from(PHOTOS_BUCKET)
        .createSignedUrls(videoRows.map((r) => r.original_path as string), 60 * 60)
    : { data: null };
  const videoUrlById = new Map<string, string>();
  videoRows.forEach((r, i) => {
    const url = signedVideo?.[i]?.signedUrl;
    if (url) videoUrlById.set(r.id as string, url);
  });

  rows.forEach((row, i) => {
    const id = row.timeline_entry_id as string;
    (result[id] ??= []).push({
      id: row.id as string,
      displayUrl: signed?.[i]?.signedUrl ?? "",
      videoUrl: videoUrlById.get(row.id as string) ?? null,
      mediaType: (row.media_type as JournalMediaType) ?? "photo",
    });
  });
  return result;
}
