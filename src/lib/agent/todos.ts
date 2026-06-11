// Data helpers for the agent-facing todos API (src/app/api/agent/todos/*).
// Mutation semantics deliberately mirror the signed-in UI's server actions
// (src/app/(todos)/todos/actions.ts) — bucket moves clear snoozes, Inbox means
// no project, reassignment lands in the new assignee's Inbox unseen — so a
// task behaves the same whether a person or the family assistant touched it.

import { createAdminClient } from "@/lib/supabase/admin";
import { type TodoBucket, type TodoTaskRow } from "@/lib/todos/types";

type AdminClient = ReturnType<typeof createAdminClient>;

export const TODO_BUCKETS: TodoBucket[] = [
  "inbox",
  "today",
  "anytime",
  "someday",
];

export function isTodoBucket(value: unknown): value is TodoBucket {
  return (
    typeof value === "string" && (TODO_BUCKETS as string[]).includes(value)
  );
}

/** TASK_COLUMNS plus deleted_at — the agent surfaces soft-deletes so it can
 * report (and undo) its own deletions; the UI never shows them. */
export const AGENT_TASK_COLUMNS =
  "id, title, notes_html, bucket, assignee_email, creator_email, project_id, snoozed_until, completed_at, completed_by_email, sort_order, assignee_seen_at, created_at, deleted_at";

export type AgentTaskRow = TodoTaskRow & { deleted_at: string | null };

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Notes are stored as sanitized Tiptap HTML; the agent reads and writes them
 * as plain text. Checklist items come out as "[ ] item" / "[x] item" lines. */
export function notesHtmlToText(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<li[^>]*data-checked="(true|false)"[^>]*>/g, (_, checked) =>
      checked === "true" ? "[x] " : "[ ] ",
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h1|h2|h3|div|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text || null;
}

export function serializeTask(
  row: AgentTaskRow,
  projectNames: Map<string, string>,
) {
  return {
    id: row.id,
    title: row.title,
    notes: notesHtmlToText(row.notes_html),
    bucket: row.bucket,
    assignee: row.assignee_email,
    creator: row.creator_email,
    project_id: row.project_id,
    project: row.project_id ? (projectNames.get(row.project_id) ?? null) : null,
    snoozed_until: row.snoozed_until,
    completed_at: row.completed_at,
    completed_by: row.completed_by_email,
    created_at: row.created_at,
    ...(row.deleted_at ? { deleted_at: row.deleted_at } : {}),
  };
}

/** id → name for live projects, for labeling tasks in responses. */
export async function getProjectNames(
  admin: AdminClient,
): Promise<Map<string, string>> {
  const { data } = await admin.from("todo_projects").select("id, name");
  return new Map(
    ((data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]),
  );
}

/** Append to the bottom of the list the task will render in: the project's
 * task list when it has one, else the assignee's bucket (the same edge query
 * as createTask in actions.ts, bottom position). */
export async function appendSortOrder(
  admin: AdminClient,
  target: {
    projectId: string | null;
    assigneeEmail: string;
    bucket: TodoBucket;
  },
): Promise<number> {
  let edgeQuery = admin
    .from("todo_tasks")
    .select("sort_order")
    .is("completed_at", null)
    .is("deleted_at", null);
  edgeQuery = target.projectId
    ? edgeQuery.eq("project_id", target.projectId)
    : edgeQuery
        .eq("assignee_email", target.assigneeEmail)
        .eq("bucket", target.bucket);
  const { data: edge } = await edgeQuery
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  return edge ? (edge.sort_order as number) + 1 : 1;
}

/** Does this email belong to a family member? (Friendlier than letting the
 * FK constraint produce a 500.) */
export async function isFamilyMember(
  admin: AdminClient,
  email: string,
): Promise<boolean> {
  const { data } = await admin
    .from("family_members")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  return !!data;
}

/**
 * Keep the membership invariant (a project never holds tasks assigned to a
 * non-member) by adding the assignee to the project when needed. Returns
 * whether a membership row was created, so responses can mention it.
 */
export async function ensureProjectMember(
  admin: AdminClient,
  projectId: string,
  memberEmail: string,
): Promise<boolean> {
  const { data: existing } = await admin
    .from("todo_project_members")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("member_email", memberEmail)
    .maybeSingle();
  if (existing) return false;
  const { error } = await admin
    .from("todo_project_members")
    .insert({ project_id: projectId, member_email: memberEmail });
  if (error) throw error;
  return true;
}

/** Same lazy snooze sweep the todos pages run (see lib/todos/queries.ts) —
 * elapsed snoozes pop into Today before the agent reads or reasons. */
export async function sweepElapsedSnoozes(admin: AdminClient): Promise<void> {
  await admin
    .from("todo_tasks")
    .update({ bucket: "today", snoozed_until: null })
    .lte("snoozed_until", new Date().toISOString())
    .is("completed_at", null)
    .is("deleted_at", null);
}
