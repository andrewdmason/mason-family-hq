import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/** The kids' school's Canvas. One school for now; the column allows more. */
export const CANVAS_BASE_URL = "https://bentleyschool.instructure.com";

export type CanvasStatus = {
  studentId: string;
  name: string;
  connected: boolean;
  canvasName: string | null;
  expiresAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  courses: number;
  assignments: number;
};

/**
 * Each kid's Canvas connection, for the parents' page: everything but the
 * key itself, which never leaves the server.
 */
export async function getCanvasStatuses(): Promise<CanvasStatus[]> {
  const db = createAdminClient();
  const [{ data: kids }, { data: conns }, { data: courses }, { data: assignments }] = await Promise.all([
    db.from("family_members").select("user_id, name, birthdate").eq("role", "kid").not("user_id", "is", null),
    db.from("canvas_connections").select("student_id, canvas_name, token_expires_at, last_synced_at, last_error"),
    db.from("canvas_courses").select("student_id"),
    db.from("canvas_assignments").select("student_id"),
  ]);
  return (kids ?? [])
    .sort((a, b) => String(a.birthdate).localeCompare(String(b.birthdate)))
    .map((kid) => {
      const c = conns?.find((x) => x.student_id === kid.user_id);
      return {
        studentId: kid.user_id as string,
        name: (kid.name as string) ?? "Kid",
        connected: Boolean(c),
        canvasName: c?.canvas_name ?? null,
        expiresAt: c?.token_expires_at ?? null,
        lastSyncedAt: c?.last_synced_at ?? null,
        lastError: c?.last_error ?? null,
        courses: courses?.filter((x) => x.student_id === kid.user_id).length ?? 0,
        assignments: assignments?.filter((x) => x.student_id === kid.user_id).length ?? 0,
      };
    });
}
