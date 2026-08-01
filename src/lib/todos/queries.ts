import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUserId } from "@/lib/members/auth";
import {
  TASK_COLUMNS,
  taskFromRow,
  type SidebarCounts,
  type TodoArea,
  type TodoMember,
  type TodoProject,
  type TodoSection,
  type TodoTask,
  type TodoTaskRow,
  type TodoView,
} from "@/lib/todos/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Wake elapsed snoozes: any snoozed task whose moment has passed pops into
 * Today. Runs lazily at the top of every todos page load (and the home-widget
 * fetch) instead of a cron — RLS is household-wide, so whoever loads a page
 * first normalizes everyone's tasks. After this sweep, every remaining
 * non-null snoozed_until is in the future, which keeps the view queries to
 * simple equality filters.
 */
export async function sweepElapsedSnoozes(supabase: Supabase): Promise<void> {
  await supabase
    .from("todo_tasks")
    .update({ bucket: "today", snoozed_until: null })
    .lte("snoozed_until", new Date().toISOString())
    .is("completed_at", null)
    .is("deleted_at", null);
}

/**
 * All family members, sidebar-ordered (self is resolved by the caller).
 * family_members RLS only exposes your own row, so this reads via the admin
 * client — same as the home dashboard's person widgets.
 */
export async function getTodoMembers(): Promise<TodoMember[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("family_members")
    .select("email, name, color")
    .order("created_at", { ascending: true });
  return (data ?? []) as TodoMember[];
}

/** The signed-in user's member email (the allowlist key for everything here). */
export async function getSelfEmail(supabase: Supabase): Promise<string> {
  const userId = await requireUserId(supabase);
  const { data } = await supabase
    .from("family_members")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();
  const email = data?.email as string | undefined;
  if (!email) throw new Error("Signed-in user is not a family member");
  return email;
}

/**
 * Stamp tasks-from-others as seen. Runs when a member opens their own Inbox
 * (never while impersonating someone), clearing their bell items; the
 * "from X" chip on the row persists regardless.
 */
export async function markInboxSeen(
  supabase: Supabase,
  memberEmail: string
): Promise<void> {
  await supabase
    .from("todo_tasks")
    .update({ assignee_seen_at: new Date().toISOString() })
    .eq("assignee_email", memberEmail)
    .is("assignee_seen_at", null)
    .is("completed_at", null)
    .is("deleted_at", null);
}

/**
 * Sidebar badge counts in one parallel sweep: inbox and today by bucket,
 * snoozed by a pending wake, delegated by created-for-someone-else. Runs
 * post-sweep, so bucket counts can assume elapsed snoozes already woke.
 */
export async function getSidebarCounts(
  supabase: Supabase,
  memberEmail: string
): Promise<SidebarCounts> {
  const open = () =>
    supabase
      .from("todo_tasks")
      .select("id", { count: "exact", head: true })
      .is("completed_at", null)
      .is("deleted_at", null);
  const bucketCount = (bucket: "inbox" | "today") =>
    open()
      .eq("assignee_email", memberEmail)
      .eq("bucket", bucket)
      .is("snoozed_until", null);
  const [inbox, today, snoozed, delegated] = await Promise.all([
    bucketCount("inbox"),
    bucketCount("today"),
    open().eq("assignee_email", memberEmail).not("snoozed_until", "is", null),
    open().eq("creator_email", memberEmail).neq("assignee_email", memberEmail),
  ]);
  return {
    inbox: inbox.count ?? 0,
    today: today.count ?? 0,
    snoozed: snoozed.count ?? 0,
    delegated: delegated.count ?? 0,
  };
}

/** Active tasks for one of the four bucket views, in manual order. */
async function getBucketTasks(
  supabase: Supabase,
  memberEmail: string,
  bucket: "inbox" | "today" | "anytime" | "someday"
): Promise<TodoTask[]> {
  const { data } = await supabase
    .from("todo_tasks")
    .select(TASK_COLUMNS)
    .eq("assignee_email", memberEmail)
    .eq("bucket", bucket)
    .is("snoozed_until", null)
    .is("completed_at", null)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return ((data ?? []) as TodoTaskRow[]).map(taskFromRow);
}

/** Snoozed tasks, soonest wake first. (Post-sweep these are all future.) */
async function getSnoozedTasks(
  supabase: Supabase,
  memberEmail: string
): Promise<TodoTask[]> {
  const { data } = await supabase
    .from("todo_tasks")
    .select(TASK_COLUMNS)
    .eq("assignee_email", memberEmail)
    .not("snoozed_until", "is", null)
    .is("completed_at", null)
    .is("deleted_at", null)
    .order("snoozed_until", { ascending: true });
  return ((data ?? []) as TodoTaskRow[]).map(taskFromRow);
}

/**
 * Open tasks this member created for *other* people — the outbound ledger
 * ("what have I put on everyone else's plates?"). Ordered by assignee so the
 * view can group by person.
 */
async function getDelegatedTasks(
  supabase: Supabase,
  memberEmail: string
): Promise<TodoTask[]> {
  const { data } = await supabase
    .from("todo_tasks")
    .select(TASK_COLUMNS)
    .eq("creator_email", memberEmail)
    .neq("assignee_email", memberEmail)
    .is("completed_at", null)
    .is("deleted_at", null)
    .order("assignee_email", { ascending: true })
    .order("sort_order", { ascending: true });
  return ((data ?? []) as TodoTaskRow[]).map(taskFromRow);
}

/**
 * Every member's active task set in one query — no member filter. The views
 * shell (todos-views.tsx) needs this so it can render any project (which shows
 * every assignee's tasks) from memory, the same way it already derives each
 * member view. Member-scoped views stay correct because deriveViewTasks filters
 * by assignee/creator. RLS is household-wide and a family's active set is small.
 */
export async function getAllActiveTasks(
  supabase: Supabase
): Promise<TodoTask[]> {
  const { data } = await supabase
    .from("todo_tasks")
    .select(TASK_COLUMNS)
    .is("completed_at", null)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return ((data ?? []) as TodoTaskRow[]).map(taskFromRow);
}

const LOGBOOK_PAGE = 100;

/** Completed tasks, newest first (the Logbook groups them by local date). */
export async function getLogbookTasks(
  supabase: Supabase,
  memberEmail: string
): Promise<TodoTask[]> {
  const { data } = await supabase
    .from("todo_tasks")
    .select(TASK_COLUMNS)
    .eq("assignee_email", memberEmail)
    .not("completed_at", "is", null)
    .is("deleted_at", null)
    .order("completed_at", { ascending: false })
    .limit(LOGBOOK_PAGE);
  return ((data ?? []) as TodoTaskRow[]).map(taskFromRow);
}

type ProjectRow = {
  id: string;
  name: string;
  area_id: string | null;
  sort_order: number;
  todo_project_members: { member_email: string }[];
};

/** All live (not completed/deleted) projects with their member lists. */
export async function getProjects(supabase: Supabase): Promise<TodoProject[]> {
  const { data } = await supabase
    .from("todo_projects")
    .select("id, name, area_id, sort_order, todo_project_members(member_email)")
    .is("completed_at", null)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return ((data ?? []) as ProjectRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    areaId: row.area_id,
    sortOrder: row.sort_order,
    memberEmails: row.todo_project_members.map((m) => m.member_email),
  }));
}

/**
 * Every live project's sections, in order. Small enough (a handful per
 * project) to hand the views shell wholesale alongside the projects, so
 * opening a project stays an in-memory filter.
 */
export async function getSections(supabase: Supabase): Promise<TodoSection[]> {
  const { data } = await supabase
    .from("todo_sections")
    .select("id, project_id, name, sort_order")
    .is("deleted_at", null)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (
    (data ?? []) as {
      id: string;
      project_id: string;
      name: string;
      sort_order: number;
    }[]
  ).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    sortOrder: row.sort_order,
  }));
}

export async function getAreas(supabase: Supabase): Promise<TodoArea[]> {
  const { data } = await supabase
    .from("todo_areas")
    .select("id, name, sort_order")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return ((data ?? []) as { id: string; name: string; sort_order: number }[]).map(
    (row) => ({ id: row.id, name: row.name, sortOrder: row.sort_order })
  );
}

/** A project's completed ("logged") tasks, newest first — behind the
 * Things-style "Show N logged items" toggle at the bottom of the project. */
export async function getProjectLoggedTasks(
  supabase: Supabase,
  projectId: string
): Promise<TodoTask[]> {
  const { data } = await supabase
    .from("todo_tasks")
    .select(TASK_COLUMNS)
    .eq("project_id", projectId)
    .not("completed_at", "is", null)
    .is("deleted_at", null)
    .order("completed_at", { ascending: false })
    .limit(200);
  return ((data ?? []) as TodoTaskRow[]).map(taskFromRow);
}

// A project's active tasks (every assignee, manual order) come from the
// household active set the views shell already holds — see deriveProjectTasks
// in lib/todos/derive.ts. No dedicated query: opening a project is a filter.

export type TodoTaskAttachment = {
  id: string;
  taskId: string;
  kind: "image" | "file";
  fileName: string | null;
  /** Signed URL, valid ~1h (pages are force-dynamic, so always fresh):
   * the display copy for images, the original for other files. */
  url: string;
};

/** Attachments for a set of tasks, with signed URLs, keyed by task id. */
export async function getTaskAttachments(
  supabase: Supabase,
  taskIds: string[]
): Promise<Record<string, TodoTaskAttachment[]>> {
  if (taskIds.length === 0) return {};
  const { data } = await supabase
    .from("todo_task_attachments")
    .select("id, task_id, kind, file_name, display_path, original_path")
    .in("task_id", taskIds)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as {
    id: string;
    task_id: string;
    kind: "image" | "file";
    file_name: string | null;
    display_path: string | null;
    original_path: string;
  }[];
  if (rows.length === 0) return {};

  const pathFor = (row: (typeof rows)[number]) =>
    row.kind === "image" && row.display_path
      ? row.display_path
      : row.original_path;

  const { data: signed } = await supabase.storage
    .from("todo-images")
    .createSignedUrls(rows.map(pathFor), 3600);
  const urlByPath = new Map(
    (signed ?? []).map((s) => [s.path, s.signedUrl] as const)
  );

  const byTask: Record<string, TodoTaskAttachment[]> = {};
  for (const row of rows) {
    const url = urlByPath.get(pathFor(row));
    if (!url) continue;
    (byTask[row.task_id] ??= []).push({
      id: row.id,
      taskId: row.task_id,
      kind: row.kind,
      fileName: row.file_name,
      url,
    });
  }
  return byTask;
}

export type LogbookProject = {
  id: string;
  name: string;
  completedAt: string;
};

/** Completed projects also file into the Logbook, on their completion date. */
export async function getLogbookProjects(
  supabase: Supabase
): Promise<LogbookProject[]> {
  const { data } = await supabase
    .from("todo_projects")
    .select("id, name, completed_at")
    .not("completed_at", "is", null)
    .is("deleted_at", null)
    .order("completed_at", { ascending: false })
    .limit(50);
  return ((data ?? []) as { id: string; name: string; completed_at: string }[]).map(
    (row) => ({ id: row.id, name: row.name, completedAt: row.completed_at })
  );
}

/** Tasks for any of the six views, post-sweep. */
export async function getViewTasks(
  supabase: Supabase,
  memberEmail: string,
  view: TodoView
): Promise<TodoTask[]> {
  switch (view) {
    case "snoozed":
      return getSnoozedTasks(supabase, memberEmail);
    case "delegated":
      return getDelegatedTasks(supabase, memberEmail);
    case "logbook":
      return getLogbookTasks(supabase, memberEmail);
    default:
      return getBucketTasks(supabase, memberEmail, view);
  }
}
