import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { KidAssignments, SchoolAssignment } from "./types";

export type BentleyConnectionStatus = {
  memberEmail: string;
  schoolHost: string;
  lastSyncedAt: string | null;
  syncError: string | null;
  createdAt: string;
};

/**
 * The caller's own Bentley connection, if any. RLS limits a member to their own
 * connection row, so this reflects whether the signed-in parent has connected.
 */
export async function getMyBentleyConnection(): Promise<BentleyConnectionStatus | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("blackbaud_connections")
    .select("member_email, school_host, last_synced_at, sync_error, created_at")
    .maybeSingle();
  if (!data) return null;
  return {
    memberEmail: data.member_email as string,
    schoolHost: data.school_host as string,
    lastSyncedAt: (data.last_synced_at as string | null) ?? null,
    syncError: (data.sync_error as string | null) ?? null,
    createdAt: data.created_at as string,
  };
}

/**
 * The viewer's assignments, grouped per kid. RLS does the scoping: a kid gets
 * only their own rows, a parent/owner gets every kid's. We resolve display names
 * from family_members and keep kids in a stable (oldest-first) order.
 */
export async function getAssignmentsForViewer(): Promise<KidAssignments[]> {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("school_assignments")
    .select(
      "id, kid_email, external_id, title, short_description, long_description, course, assignment_type, date_assigned, due_date, due_time, status, max_points, points_earned, source_type, last_synced_at, created_at, updated_at",
    )
    .order("due_date", { ascending: true, nullsFirst: false });

  const assignments = (rows ?? []) as SchoolAssignment[];

  // The kids we know about (have a Blackbaud mapping for), so a parent sees a
  // section per child even before any assignment has synced.
  const { data: students } = await supabase
    .from("blackbaud_students")
    .select("member_email");
  const mappedEmails = (students ?? []).map((s) => s.member_email as string);

  const emails = Array.from(
    new Set([...mappedEmails, ...assignments.map((a) => a.kid_email)]),
  );
  if (emails.length === 0) return [];

  const { data: members } = await supabase
    .from("family_members")
    .select("email, name, birthdate")
    .in("email", emails);

  const nameByEmail = new Map<string, string | null>();
  const birthByEmail = new Map<string, string | null>();
  for (const m of members ?? []) {
    nameByEmail.set(m.email as string, (m.name as string | null) ?? null);
    birthByEmail.set(m.email as string, (m.birthdate as string | null) ?? null);
  }

  // Oldest kid first (birthdate ascending), unknowns last.
  emails.sort((a, b) => {
    const ba = birthByEmail.get(a) ?? "9999";
    const bb = birthByEmail.get(b) ?? "9999";
    return ba.localeCompare(bb);
  });

  return emails.map((email) => ({
    kidEmail: email,
    kidName: nameByEmail.get(email) ?? null,
    assignments: assignments.filter((a) => a.kid_email === email),
  }));
}
