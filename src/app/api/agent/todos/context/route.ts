// Agent API: the facts an agent needs before doing todos work — family
// members (names → emails), the live projects (with their member lists and
// open-task counts), and the areas projects file under.

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string;
  name: string;
  area_id: string | null;
  todo_project_members: { member_email: string }[];
};

export async function GET(req: NextRequest) {
  if (!agentAuthorized(req)) return agentUnauthorized();

  const admin = createAdminClient();
  const [{ data: members }, { data: projects }, { data: areas }, { data: open }] =
    await Promise.all([
      admin
        .from("family_members")
        .select("email, name, role")
        .order("role")
        .order("name"),
      admin
        .from("todo_projects")
        .select("id, name, area_id, todo_project_members(member_email)")
        .is("completed_at", null)
        .is("deleted_at", null)
        .order("sort_order"),
      admin.from("todo_areas").select("id, name").order("sort_order"),
      admin
        .from("todo_tasks")
        .select("project_id")
        .not("project_id", "is", null)
        .is("completed_at", null)
        .is("deleted_at", null),
    ]);

  const openByProject = new Map<string, number>();
  for (const row of (open ?? []) as { project_id: string }[]) {
    openByProject.set(row.project_id, (openByProject.get(row.project_id) ?? 0) + 1);
  }
  const areaNames = new Map(
    ((areas ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]),
  );

  return NextResponse.json({
    members: members ?? [],
    projects: ((projects ?? []) as ProjectRow[]).map((p) => ({
      id: p.id,
      name: p.name,
      area: p.area_id ? (areaNames.get(p.area_id) ?? null) : null,
      member_emails: p.todo_project_members.map((m) => m.member_email),
      open_tasks: openByProject.get(p.id) ?? 0,
    })),
    areas: areas ?? [],
    buckets: ["inbox", "today", "anytime", "someday"],
  });
}
