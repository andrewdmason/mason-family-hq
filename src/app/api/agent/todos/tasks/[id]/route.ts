// Agent API: read / edit / complete / delete a single todo task. PATCH covers
// everything the UI does to a task — retitle, notes, bucket moves, reassign,
// file into a project, snooze, complete — with the same semantics as the
// server actions in src/app/(todos)/todos/actions.ts.

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";
import {
  AGENT_TASK_COLUMNS,
  ensureProjectMember,
  getProjectNames,
  isFamilyMember,
  isTodoBucket,
  serializeTask,
  type AgentTaskRow,
} from "@/lib/agent/todos";
import { plainTextToNotesHtml } from "@/lib/todos/notes";
import type { TodoBucket } from "@/lib/todos/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function fetchTask(id: string): Promise<AgentTaskRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("todo_tasks")
    .select(AGENT_TASK_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  return (data as AgentTaskRow | null) ?? null;
}

export async function GET(req: NextRequest, { params }: Params) {
  if (!agentAuthorized(req)) return agentUnauthorized();
  const { id } = await params;

  const task = await fetchTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }
  const projectNames = await getProjectNames(createAdminClient());
  return NextResponse.json({ task: serializeTask(task, projectNames) });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  if (!agentAuthorized(req)) return agentUnauthorized();
  const { id } = await params;

  const task = await fetchTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const restoring = body.deleted === false;
  if (task.deleted_at && !restoring) {
    return NextResponse.json(
      { error: 'This task is deleted. PATCH {"deleted": false} to restore it first.' },
      { status: 409 },
    );
  }

  if ("bucket" in body && !isTodoBucket(body.bucket)) {
    return NextResponse.json(
      { error: "bucket must be inbox, today, anytime, or someday." },
      { status: 400 },
    );
  }
  const snoozeKey = "snoozed_until" in body;
  const snoozedUntil =
    typeof body.snoozed_until === "string" ? body.snoozed_until : null;
  if (snoozeKey && body.snoozed_until !== null && !snoozedUntil) {
    return NextResponse.json(
      { error: "snoozed_until must be an ISO datetime or null." },
      { status: 400 },
    );
  }
  if (snoozedUntil && Number.isNaN(new Date(snoozedUntil).getTime())) {
    return NextResponse.json(
      { error: "snoozed_until must be an ISO datetime." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const update: Record<string, unknown> = {};
  if (restoring) update.deleted_at = null;

  if ("title" in body) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json(
        { error: "title can't be empty." },
        { status: 400 },
      );
    }
    update.title = title;
  }

  // Notes replace wholesale, as plain text (null/"" clears them).
  if ("notes" in body) {
    update.notes_html =
      typeof body.notes === "string" ? plainTextToNotesHtml(body.notes) : null;
  }

  // Reassignment: hand-offs land in the new assignee's Inbox unseen (the
  // triage ritual + bell ping) — unless the task is in a project, which is
  // already triaged; then the assignee just joins the project's members.
  const assigneeEmail =
    typeof body.assignee_email === "string"
      ? body.assignee_email.trim().toLowerCase()
      : null;
  const reassigning = !!assigneeEmail && assigneeEmail !== task.assignee_email;
  if (reassigning) {
    if (!(await isFamilyMember(admin, assigneeEmail))) {
      return NextResponse.json(
        { error: `No family member with email ${assigneeEmail}. See /api/agent/todos/context.` },
        { status: 400 },
      );
    }
    update.assignee_email = assigneeEmail;
    update.assignee_seen_at = null;
  }

  let projectId = task.project_id;
  let addedProjectMember = false;
  if ("project_id" in body) {
    projectId =
      typeof body.project_id === "string" && body.project_id.trim()
        ? body.project_id.trim()
        : null;
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
    }
    update.project_id = projectId;
  }

  // Bucket, in precedence order: explicit move > reassignment's Inbox landing
  // > Inbox→Anytime auto-triage when filing into a project. Explicit bucket
  // moves clear any snooze, like the app's setTaskBucket.
  let bucket: TodoBucket = task.bucket;
  if (isTodoBucket(body.bucket)) {
    bucket = body.bucket;
    if (!snoozeKey) update.snoozed_until = null;
    // An explicit move to the Inbox un-triages: the project goes with it
    // (the app's moveTaskToInbox) — unless this PATCH also sets a project,
    // which wins below.
    if (bucket === "inbox" && projectId && !("project_id" in body)) {
      projectId = null;
      update.project_id = null;
    }
  } else if (reassigning && !projectId) {
    bucket = "inbox";
  } else if (projectId && task.bucket === "inbox") {
    bucket = "anytime";
  }
  // A task in a project can't sit in the Inbox (covers PATCHes that set both).
  if (projectId && bucket === "inbox") bucket = "anytime";
  if (bucket !== task.bucket) update.bucket = bucket;

  if (projectId) {
    addedProjectMember = await ensureProjectMember(
      admin,
      projectId,
      (update.assignee_email as string | undefined) ?? task.assignee_email,
    );
  }

  if (snoozeKey) {
    update.snoozed_until = snoozedUntil;
    // Waking a snoozed task by hand lands in Today (clearSnooze semantics),
    // unless this PATCH also says where it should go.
    if (!snoozedUntil && task.snoozed_until && !isTodoBucket(body.bucket)) {
      update.bucket = "today";
    }
  }

  if (body.completed === true) {
    const completedBy =
      typeof body.completed_by_email === "string" && body.completed_by_email.trim()
        ? body.completed_by_email.trim().toLowerCase()
        : ((update.assignee_email as string | undefined) ?? task.assignee_email);
    if (!(await isFamilyMember(admin, completedBy))) {
      return NextResponse.json(
        { error: `No family member with email ${completedBy}.` },
        { status: 400 },
      );
    }
    update.completed_at = new Date().toISOString();
    update.completed_by_email = completedBy;
    update.snoozed_until = null;
  } else if (body.completed === false) {
    update.completed_at = null;
    update.completed_by_email = null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update — see the skill doc for PATCH fields." },
      { status: 400 },
    );
  }

  const { data, error } = await admin
    .from("todo_tasks")
    .update(update)
    .eq("id", id)
    .select(AGENT_TASK_COLUMNS)
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Couldn't update the task." },
      { status: 500 },
    );
  }

  const projectNames = await getProjectNames(admin);
  return NextResponse.json({
    ok: true,
    task: serializeTask(data as AgentTaskRow, projectNames),
    ...(addedProjectMember
      ? { note: "Added the assignee to the project's members." }
      : {}),
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (!agentAuthorized(req)) return agentUnauthorized();
  const { id } = await params;

  const task = await fetchTask(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }
  if (task.deleted_at) {
    return NextResponse.json({ ok: true, already_deleted: true });
  }

  // Soft delete, same as the app (there is no Trash UI, so the undo path
  // matters): PATCH {"deleted": false} brings it back.
  const admin = createAdminClient();
  const { error } = await admin
    .from("todo_tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    undo: `PATCH /api/agent/todos/tasks/${id} {"deleted": false}`,
  });
}
