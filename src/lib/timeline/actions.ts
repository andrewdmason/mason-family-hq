"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/members/auth";
import type { DatePrecision, TimelineCategory, TimelineProminence } from "@/lib/types";

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

export async function createTimelineEntry(input: TimelineEntryInput): Promise<void> {
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
