// Agent API: create a todo project (mirrors createProject in the UI's server
// actions, except the agent must say who the members are — it has no "self").
// Renaming, completing, and deleting projects stay in the app; the agent's
// job is filing tasks, and a misplaced project delete takes its tasks with it.

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";
import { isFamilyMember } from "@/lib/agent/todos";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!agentAuthorized(req)) return agentUnauthorized();

  let body: { name?: unknown; member_emails?: unknown; area_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const memberEmails = Array.isArray(body.member_emails)
    ? [...new Set(
        body.member_emails
          .filter((e): e is string => typeof e === "string")
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      )]
    : [];
  if (!name || memberEmails.length === 0) {
    return NextResponse.json(
      { error: "name and at least one member_emails entry are required." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  for (const email of memberEmails) {
    if (!(await isFamilyMember(admin, email))) {
      return NextResponse.json(
        { error: `No family member with email ${email}. See /api/agent/todos/context.` },
        { status: 400 },
      );
    }
  }

  const areaId =
    typeof body.area_id === "string" && body.area_id.trim()
      ? body.area_id.trim()
      : null;
  if (areaId) {
    const { data: area } = await admin
      .from("todo_areas")
      .select("id")
      .eq("id", areaId)
      .maybeSingle();
    if (!area) {
      return NextResponse.json(
        { error: `No area ${areaId}. See /api/agent/todos/context.` },
        { status: 400 },
      );
    }
  }

  const { data: last } = await admin
    .from("todo_projects")
    .select("sort_order")
    .is("completed_at", null)
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await admin
    .from("todo_projects")
    .insert({ name, area_id: areaId, sort_order: (last?.sort_order ?? 0) + 1 })
    .select("id")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Couldn't create the project." },
      { status: 500 },
    );
  }

  const { error: memberError } = await admin
    .from("todo_project_members")
    .insert(
      memberEmails.map((email) => ({
        project_id: data.id,
        member_email: email,
      })),
    );
  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}
