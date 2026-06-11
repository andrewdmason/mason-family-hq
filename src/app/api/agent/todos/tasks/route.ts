// Agent API: list + create todo tasks. Bearer-authenticated (see
// @/lib/agent/auth) — used by the family assistant, which has no browser
// session. List filters mirror the app's sidebar views; create mirrors
// createTask in the UI's server actions.

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";
import {
  AGENT_TASK_COLUMNS,
  appendSortOrder,
  ensureProjectMember,
  getProjectNames,
  isFamilyMember,
  isTodoBucket,
  serializeTask,
  sweepElapsedSnoozes,
  type AgentTaskRow,
} from "@/lib/agent/todos";
import { plainTextToNotesHtml } from "@/lib/todos/notes";

export const dynamic = "force-dynamic";

const VIEWS = [
  "inbox",
  "today",
  "anytime",
  "someday",
  "snoozed",
  "delegated",
  "logbook",
] as const;
type View = (typeof VIEWS)[number];

const LOGBOOK_LIMIT = 100;

export async function GET(req: NextRequest) {
  if (!agentAuthorized(req)) return agentUnauthorized();

  const url = new URL(req.url);
  const member = url.searchParams.get("member")?.trim().toLowerCase() || null;
  const project = url.searchParams.get("project")?.trim() || null;
  const q = url.searchParams.get("q")?.trim() || null;
  const viewParam = url.searchParams.get("view")?.trim().toLowerCase() || null;
  if (viewParam && !(VIEWS as readonly string[]).includes(viewParam)) {
    return NextResponse.json(
      { error: `view must be one of: ${VIEWS.join(", ")}.` },
      { status: 400 },
    );
  }
  const view = viewParam as View | null;
  if (view === "delegated" && !member) {
    return NextResponse.json(
      { error: "view=delegated needs a member (the delegator)." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  await sweepElapsedSnoozes(admin);

  let query = admin
    .from("todo_tasks")
    .select(AGENT_TASK_COLUMNS)
    .is("deleted_at", null);

  if (view === "logbook") {
    query = query
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(LOGBOOK_LIMIT);
  } else {
    query = query
      .is("completed_at", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
  }

  if (view === "snoozed") query = query.not("snoozed_until", "is", null);
  if (view && isTodoBucket(view)) {
    query = query.eq("bucket", view).is("snoozed_until", null);
  }
  // Delegated is the outbound ledger: tasks the member created for others.
  // Every other view (and the no-view default) filters by assignee.
  if (member) {
    query =
      view === "delegated"
        ? query.eq("creator_email", member).neq("assignee_email", member)
        : query.eq("assignee_email", member);
  }
  if (project) query = query.eq("project_id", project);
  if (q) query = query.ilike("title", `%${q.replace(/[%_]/g, "\\$&")}%`);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const projectNames = await getProjectNames(admin);
  return NextResponse.json({
    tasks: ((data ?? []) as AgentTaskRow[]).map((row) =>
      serializeTask(row, projectNames),
    ),
  });
}

export async function POST(req: NextRequest) {
  if (!agentAuthorized(req)) return agentUnauthorized();

  let body: {
    title?: unknown;
    assignee_email?: unknown;
    creator_email?: unknown;
    bucket?: unknown;
    project_id?: unknown;
    notes?: unknown;
    snoozed_until?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const assigneeEmail =
    typeof body.assignee_email === "string"
      ? body.assignee_email.trim().toLowerCase()
      : "";
  if (!title || !assigneeEmail) {
    return NextResponse.json(
      { error: "title and assignee_email are required." },
      { status: 400 },
    );
  }
  if ("bucket" in body && !isTodoBucket(body.bucket)) {
    return NextResponse.json(
      { error: "bucket must be inbox, today, anytime, or someday." },
      { status: 400 },
    );
  }
  const snoozedUntil =
    typeof body.snoozed_until === "string" ? body.snoozed_until : null;
  if (snoozedUntil && Number.isNaN(new Date(snoozedUntil).getTime())) {
    return NextResponse.json(
      { error: "snoozed_until must be an ISO datetime." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // The creator is whichever family member asked for the task (it drives the
  // "from X" chip and the delegated view); default to the assignee.
  const creatorEmail =
    typeof body.creator_email === "string" && body.creator_email.trim()
      ? body.creator_email.trim().toLowerCase()
      : assigneeEmail;
  for (const email of new Set([assigneeEmail, creatorEmail])) {
    if (!(await isFamilyMember(admin, email))) {
      return NextResponse.json(
        { error: `No family member with email ${email}. See /api/agent/todos/context.` },
        { status: 400 },
      );
    }
  }

  const projectId =
    typeof body.project_id === "string" && body.project_id.trim()
      ? body.project_id.trim()
      : null;
  let addedProjectMember = false;
  if (projectId) {
    const { data: proj } = await admin
      .from("todo_projects")
      .select("id")
      .eq("id", projectId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!proj) {
      return NextResponse.json(
        { error: `No project ${projectId}. See /api/agent/todos/context.` },
        { status: 400 },
      );
    }
    addedProjectMember = await ensureProjectMember(admin, projectId, assigneeEmail);
  }

  // A task in a project can't be in the Inbox — having a project IS triage.
  let bucket = isTodoBucket(body.bucket) ? body.bucket : "inbox";
  if (projectId && bucket === "inbox") bucket = "anytime";

  const sortOrder = await appendSortOrder(admin, {
    projectId,
    assigneeEmail,
    bucket,
  });
  const { data, error } = await admin
    .from("todo_tasks")
    .insert({
      title,
      notes_html:
        typeof body.notes === "string" ? plainTextToNotesHtml(body.notes) : null,
      bucket,
      assignee_email: assigneeEmail,
      creator_email: creatorEmail,
      project_id: projectId,
      snoozed_until: snoozedUntil,
      sort_order: sortOrder,
      // Self-assigned tasks never need an "unseen" state; tasks for someone
      // else land unseen so their Inbox bell pings, same as the app.
      assignee_seen_at:
        assigneeEmail === creatorEmail ? new Date().toISOString() : null,
    })
    .select(AGENT_TASK_COLUMNS)
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Couldn't create the task." },
      { status: 500 },
    );
  }

  const projectNames = await getProjectNames(admin);
  return NextResponse.json(
    {
      ok: true,
      task: serializeTask(data as AgentTaskRow, projectNames),
      ...(addedProjectMember
        ? { note: `Added ${assigneeEmail} to the project's members.` }
        : {}),
    },
    { status: 201 },
  );
}
