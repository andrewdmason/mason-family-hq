// Sync Blackbaud assignments into school_assignments. Writes go through the
// service-role client (bypasses RLS), mirroring the calendar's TeamSnap sync.
//
// A single connected parent session can read every child, so we pair each kid
// (blackbaud_students) with a connection (blackbaud_connections) on the same
// school host. With no connection yet, sync is a graceful no-op — the app still
// renders, just empty, until a parent connects their portal session.

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getConnection,
  getStudentAssignments,
  BlackbaudSessionError,
  type BlackbaudConnection,
  type NormalizedAssignment,
} from "./myschoolapp";

export type SyncResult = {
  kidEmail: string;
  synced: number;
  error?: string;
};

type StudentRow = {
  member_email: string;
  blackbaud_student_id: string;
  school_host: string;
};

type ConnectionRow = { member_email: string; school_host: string };

/** Persist one student's normalized assignments, upserting on external_id. */
async function upsertAssignments(
  kidEmail: string,
  assignments: NormalizedAssignment[],
): Promise<number> {
  if (assignments.length === 0) return 0;
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const rows = assignments.map((a) => ({
    kid_email: kidEmail,
    external_id: a.externalId,
    title: a.title,
    short_description: a.shortDescription,
    long_description: a.longDescription,
    course: a.course,
    assignment_type: a.assignmentType,
    date_assigned: a.dateAssigned,
    due_date: a.dueDate,
    due_time: a.dueTime,
    status: a.status,
    max_points: a.maxPoints,
    points_earned: a.pointsEarned,
    source_type: "blackbaud" as const,
    raw: a.raw,
    last_synced_at: now,
  }));
  const { error } = await supabase
    .from("school_assignments")
    .upsert(rows, { onConflict: "external_id" });
  if (error) throw new Error(`Upsert failed: ${error.message}`);
  return rows.length;
}

/** Pick the connection that should read a given student (same host, else any). */
function connectionFor(
  student: StudentRow,
  connections: ConnectionRow[],
): ConnectionRow | null {
  return (
    connections.find((c) => c.school_host === student.school_host) ??
    connections[0] ??
    null
  );
}

/** Sync every mapped student that has a usable parent connection. */
export async function syncAllAssignments(): Promise<SyncResult[]> {
  const supabase = createAdminClient();
  const [{ data: students }, { data: connections }] = await Promise.all([
    supabase
      .from("blackbaud_students")
      .select("member_email, blackbaud_student_id, school_host"),
    supabase.from("blackbaud_connections").select("member_email, school_host"),
  ]);

  if (!students?.length || !connections?.length) return [];

  const results: SyncResult[] = [];
  // Resolve each parent connection once (cookie lookup), reuse across kids.
  const connCache = new Map<string, BlackbaudConnection>();

  for (const student of students as StudentRow[]) {
    const pick = connectionFor(student, connections as ConnectionRow[]);
    if (!pick) {
      results.push({ kidEmail: student.member_email, synced: 0 });
      continue;
    }
    try {
      let conn = connCache.get(pick.member_email);
      if (!conn) {
        conn = await getConnection(pick.member_email);
        connCache.set(pick.member_email, conn);
      }
      const assignments = await getStudentAssignments(
        conn,
        student.blackbaud_student_id,
      );
      const synced = await upsertAssignments(student.member_email, assignments);
      results.push({ kidEmail: student.member_email, synced });
    } catch (err) {
      const message =
        err instanceof BlackbaudSessionError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      results.push({ kidEmail: student.member_email, synced: 0, error: message });
    }
  }

  // Stamp sync bookkeeping on the connections we used.
  const usedEmails = [...connCache.keys()];
  if (usedEmails.length) {
    await supabase
      .from("blackbaud_connections")
      .update({ last_synced_at: new Date().toISOString(), sync_error: null })
      .in("member_email", usedEmails);
  }

  return results;
}

/** Whether any parent has connected a portal session yet. */
export async function hasAnyConnection(): Promise<boolean> {
  const supabase = createAdminClient();
  const { count } = await supabase
    .from("blackbaud_connections")
    .select("member_email", { count: "exact", head: true });
  return (count ?? 0) > 0;
}
