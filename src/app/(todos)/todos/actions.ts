"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import sanitizeHtml from "sanitize-html";
import { createClient } from "@/lib/supabase/server";
import { plainTextToNotesHtml } from "@/lib/todos/notes";
import {
  getProjectLoggedTasks,
  getSelfEmail,
  markInboxSeen,
} from "@/lib/todos/queries";
import { loadShellData, type TodosShellData } from "@/lib/todos/shell-data";
import {
  TASK_COLUMNS,
  taskFromRow,
  type TodoBucket,
  type TodoTask,
  type TodoTaskRow,
} from "@/lib/todos/types";

/**
 * Mutations for the Todos app. Every action resolves the *real* signed-in
 * member for creator/completed-by stamps — the person switcher changes whose
 * list you're looking at, never who you are. RLS is household-wide ("Family
 * access"), so these don't need ownership filters; the FK constraints validate
 * member emails.
 *
 * Task/project actions deliberately do NOT revalidatePath: every consumer
 * reconciles client-side (useReconciler's drained refresh), and the
 * todos + home pages are force-dynamic, so revalidation here would only bolt
 * a full page re-render onto every mutation's POST. Keeping the actions lean
 * is what makes optimistic bursts (multi-select drops) cheap in production.
 */

async function ctx() {
  const supabase = await createClient();
  const selfEmail = await getSelfEmail(supabase);
  return { supabase, selfEmail };
}

/**
 * Opening your own Inbox acknowledges the tasks others put there (clears the
 * bell). Full page loads handle this server-side ([view]/page.tsx); the views
 * shell calls this on instant client-side switches, which never re-run the
 * page.
 */
export async function acknowledgeInbox(): Promise<void> {
  const { supabase, selfEmail } = await ctx();
  await markInboxSeen(supabase, selfEmail);
}

/**
 * The shell's whole data set, re-read on demand.
 *
 * The reconciler used to ask for freshness with router.refresh(), which re-runs
 * the *route*. That is unsafe here: the shell switches destinations with a bare
 * history.pushState (instant, no server roundtrip), so after any switch the
 * URL names a different route than the one Next's router has a tree for — and a
 * refresh against a mismatched URL is handled as a navigation, remounting the
 * whole screen. Mid-typing that reads as the page glitching: the draft you were
 * writing in vanishes and focus lands on the body.
 *
 * Fetching the same payload through an action instead keeps the mounted shell
 * mounted — it just receives newer props — so freshness never costs the user
 * their place. (It's also less work: no header/layout re-render per mutation.)
 */
export async function loadShellSnapshot(as?: string): Promise<TodosShellData> {
  return loadShellData(as);
}

export async function createTask(input: {
  title: string;
  assigneeEmail: string;
  bucket: TodoBucket;
  projectId?: string | null;
  /** The section within projectId — the inline draft inherits it from the
   * row it was summoned below. Ignored without a project. */
  sectionId?: string | null;
  /** Plain text (e.g. the ingest path) — converted to paragraph HTML. */
  notes?: string;
  /** Rich HTML (the quick-add modal's Tiptap notes) — sanitized like edits. */
  notesHtml?: string;
  /** Snooze straight from creation (the quick-add modal's When picker). */
  snoozedUntil?: string;
  /** Inline "New" creates an untitled draft, opened for editing in place
   * (discarded by the client if it's closed still empty). */
  draft?: boolean;
  /** Where the task lands in its list. Inline "New" goes on top, like
   * Things; captures (modal, ingest) append. */
  position?: "top" | "bottom";
  /** Explicit fractional position (the inline draft slotting in below a
   * selected row) — the client computed the midpoint; wins over position. */
  sortOrder?: number;
}): Promise<TodoTask> {
  const { supabase, selfEmail } = await ctx();
  const title = input.title.trim();
  if (!title && !input.draft) throw new Error("Task title is required");
  // A task in a project can't be in the Inbox — having a project IS triage.
  if (input.projectId && input.bucket === "inbox") input.bucket = "anytime";

  const sectionId = input.projectId ? (input.sectionId ?? null) : null;

  // Top wants the list's MIN (ascending), bottom its MAX (descending). The
  // list is the one the task will render in: the project's task list when it
  // has a project (ordered across all assignees), else the assignee's bucket.
  let sortOrder = input.sortOrder;
  if (sortOrder == null) {
    const top = input.position === "top";
    let edgeQuery = supabase
      .from("todo_tasks")
      .select("sort_order")
      .is("completed_at", null)
      .is("deleted_at", null);
    edgeQuery = input.projectId
      ? edgeQuery.eq("project_id", input.projectId)
      : edgeQuery.eq("assignee_email", input.assigneeEmail).eq("bucket", input.bucket);
    const { data: edge } = await edgeQuery
      .order("sort_order", { ascending: top })
      .limit(1)
      .maybeSingle();
    sortOrder = edge ? (top ? edge.sort_order - 1 : edge.sort_order + 1) : 1;
  }

  const { data, error } = await supabase
    .from("todo_tasks")
    .insert({
      title,
      notes_html: input.notesHtml
        ? sanitizeNotesHtml(input.notesHtml)
        : input.notes
          ? plainTextToNotesHtml(input.notes)
          : null,
      bucket: input.bucket,
      assignee_email: input.assigneeEmail,
      creator_email: selfEmail,
      project_id: input.projectId ?? null,
      section_id: sectionId,
      snoozed_until: input.snoozedUntil ?? null,
      sort_order: sortOrder,
      // Your own captures never need an "unseen" state.
      assignee_seen_at: input.assigneeEmail === selfEmail ? new Date().toISOString() : null,
    })
    .select(TASK_COLUMNS)
    .single();
  if (error) throw error;

  return taskFromRow(data as TodoTaskRow);
}

export async function updateTaskTitle(taskId: string, title: string): Promise<void> {
  const { supabase } = await ctx();
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Task title is required");
  const { error } = await supabase
    .from("todo_tasks")
    .update({ title: trimmed })
    .eq("id", taskId);
  if (error) throw error;
}

// Tiptap output for the notes field: basic blocks, marks, links, and the
// task-list structure (ul[data-type=taskList] > li > label > input[checkbox]).
const NOTES_SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "h1", "h2", "h3", "ul", "ol", "li", "a", "strong", "b", "em", "i",
    "s", "u", "code", "pre", "blockquote", "br", "hr", "label", "input",
    "div", "span",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    ul: ["data-type"],
    li: ["data-type", "data-checked"],
    input: ["type", "checked", "disabled"],
    div: [],
    span: [],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
};

function sanitizeNotesHtml(html: string): string | null {
  const clean = sanitizeHtml(html, NOTES_SANITIZE);
  // Tiptap's empty document still serializes as "<p></p>" — store NULL.
  const isEmpty = clean.replace(/<[^>]*>/g, "").trim() === "";
  return isEmpty ? null : clean;
}

export async function updateTaskNotes(taskId: string, html: string): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_tasks")
    .update({ notes_html: sanitizeNotesHtml(html) })
    .eq("id", taskId);
  if (error) throw error;
}

/**
 * Send a task back to the Inbox — the un-triage. Inbox means "no decision
 * yet", so this clears the project and any snooze along with it (a task in a
 * project can't be in the Inbox).
 */
export async function moveTaskToInbox(taskId: string): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_tasks")
    .update({
      bucket: "inbox",
      project_id: null,
      section_id: null,
      snoozed_until: null,
    })
    .eq("id", taskId);
  if (error) throw error;
}

/** Move a task between Inbox / Today / Anytime / Someday (clears any snooze). */
export async function setTaskBucket(taskId: string, bucket: TodoBucket): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_tasks")
    .update({ bucket, snoozed_until: null })
    .eq("id", taskId);
  if (error) throw error;
}

/**
 * Hand a task to another member. Handing it to someone else drops it in their
 * Inbox unseen (triage ritual + bell ping); taking it yourself keeps the
 * bucket and needs no notification.
 */
export async function reassignTask(taskId: string, assigneeEmail: string): Promise<void> {
  const { supabase, selfEmail } = await ctx();
  const toSelf = assigneeEmail === selfEmail;
  const { error } = await supabase
    .from("todo_tasks")
    .update(
      toSelf
        ? { assignee_email: assigneeEmail, assignee_seen_at: new Date().toISOString() }
        : { assignee_email: assigneeEmail, bucket: "inbox", assignee_seen_at: null }
    )
    .eq("id", taskId);
  if (error) throw error;
}

/** Snooze until a moment (ISO). The lazy sweep pops it into Today afterwards. */
export async function snoozeTask(taskId: string, untilIso: string): Promise<void> {
  const { supabase } = await ctx();
  const until = new Date(untilIso);
  if (Number.isNaN(until.getTime())) throw new Error("Invalid snooze time");
  const { error } = await supabase
    .from("todo_tasks")
    .update({ snoozed_until: until.toISOString() })
    .eq("id", taskId);
  if (error) throw error;
}

/** Wake a snoozed task by hand — same landing spot as the sweep: Today. */
export async function clearSnooze(taskId: string): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_tasks")
    .update({ snoozed_until: null, bucket: "today" })
    .eq("id", taskId);
  if (error) throw error;
}

export async function completeTask(taskId: string): Promise<void> {
  const { supabase, selfEmail } = await ctx();
  const { error } = await supabase
    .from("todo_tasks")
    .update({
      completed_at: new Date().toISOString(),
      completed_by_email: selfEmail,
      snoozed_until: null,
    })
    .eq("id", taskId);
  if (error) throw error;
}

/** Logbook → back to the living list it was completed from. */
export async function uncompleteTask(taskId: string): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_tasks")
    .update({ completed_at: null, completed_by_email: null })
    .eq("id", taskId);
  if (error) throw error;
}

/**
 * A project's completed ("logged") tasks, fetched on demand when the
 * ProjectLogged toggle is first expanded. Lazy so the views shell's initial
 * payload never carries every project's history — the one slice of project data
 * that isn't already in the active superset.
 */
export async function getProjectLogged(projectId: string): Promise<TodoTask[]> {
  const { supabase } = await ctx();
  return getProjectLoggedTasks(supabase, projectId);
}

/** Batch soft delete for multi-selection — confirmed via modal, no undo toast. */
export async function deleteTasks(taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_tasks")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", taskIds);
  if (error) throw error;
}

/** Soft delete — the undo toast calls restoreTask; there is no Trash UI. */
export async function deleteTask(taskId: string): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_tasks")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", taskId);
  if (error) throw error;
}

export async function restoreTask(taskId: string): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_tasks")
    .update({ deleted_at: null })
    .eq("id", taskId);
  if (error) throw error;
}

// ============================================================
// Ordering (fractional index; see src/lib/todos/sort.ts)
// ============================================================

export async function setTaskSortOrder(taskId: string, sortOrder: number): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_tasks")
    .update({ sort_order: sortOrder })
    .eq("id", taskId);
  if (error) throw error;
}

/** Reset a list's positions to 1..n when midpoints run out of precision. */
export async function renormalizeTaskOrder(orderedIds: string[]): Promise<void> {
  const { supabase } = await ctx();
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("todo_tasks").update({ sort_order: index + 1 }).eq("id", id)
    )
  );
}

export async function setProjectSortOrder(projectId: string, sortOrder: number): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_projects")
    .update({ sort_order: sortOrder })
    .eq("id", projectId);
  if (error) throw error;
}

export async function setAreaSortOrder(areaId: string, sortOrder: number): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_areas")
    .update({ sort_order: sortOrder })
    .eq("id", areaId);
  if (error) throw error;
}

// ============================================================
// Projects & areas
// ============================================================

/** Move a task into a project (or out, with null). The picker only offers
 * projects the task's assignee belongs to, keeping the membership rule.
 * Filing an Inbox task into a project triages it — it becomes Anytime
 * (a task in a project can't be in the Inbox). Always lands in the project's
 * unsectioned top area: the old section belonged to the old project, and
 * re-filing into the same project is the gesture for "out of its section". */
export async function setTaskProject(taskId: string, projectId: string | null): Promise<void> {
  const { supabase } = await ctx();
  const { data: current } = await supabase
    .from("todo_tasks")
    .select("bucket")
    .eq("id", taskId)
    .maybeSingle();
  const autoTriage = !!projectId && current?.bucket === "inbox";
  const { error } = await supabase
    .from("todo_tasks")
    .update(
      autoTriage
        ? { project_id: projectId, section_id: null, bucket: "anytime" }
        : { project_id: projectId, section_id: null }
    )
    .eq("id", taskId);
  if (error) throw error;
}

// ============================================================
// Sections (Things-style headings inside a project; migration 00169)
// ============================================================

/** Bottom of the list a task will render in: the tasks in one section of a
 * project (or its unsectioned top area). Mirrors createTask's edge query. */
async function sectionBottom(
  supabase: Awaited<ReturnType<typeof ctx>>["supabase"],
  projectId: string,
  sectionId: string | null
): Promise<number> {
  let query = supabase
    .from("todo_tasks")
    .select("sort_order")
    .eq("project_id", projectId)
    .is("completed_at", null)
    .is("deleted_at", null);
  query = sectionId
    ? query.eq("section_id", sectionId)
    : query.is("section_id", null);
  const { data: edge } = await query
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  return edge ? edge.sort_order + 1 : 1;
}

/**
 * File a task into a section (or, with null, back into its project's
 * unsectioned top area). The section carries its project, so this doubles as
 * a cross-project move — with the same Inbox triage rule as setTaskProject.
 *
 * Without `sortOrder` the task appends to the bottom of wherever it lands,
 * which is what "drop it on that heading" and the Move menu mean. A drag that
 * lands the row between two others passes the position it computed.
 */
export async function setTaskSection(
  taskId: string,
  sectionId: string | null,
  sortOrder?: number
): Promise<void> {
  const { supabase } = await ctx();
  const { data: current } = await supabase
    .from("todo_tasks")
    .select("bucket, project_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!current) return;

  if (!sectionId) {
    if (!current.project_id) return;
    const { error } = await supabase
      .from("todo_tasks")
      .update({
        section_id: null,
        sort_order:
          sortOrder ?? (await sectionBottom(supabase, current.project_id, null)),
      })
      .eq("id", taskId);
    if (error) throw error;
    return;
  }

  const { data: section } = await supabase
    .from("todo_sections")
    .select("id, project_id")
    .eq("id", sectionId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!section) throw new Error("Section not found");

  const { error } = await supabase
    .from("todo_tasks")
    .update({
      project_id: section.project_id,
      section_id: section.id,
      sort_order:
        sortOrder ??
        (await sectionBottom(supabase, section.project_id, section.id)),
      ...(current.bucket === "inbox" ? { bucket: "anytime" } : {}),
    })
    .eq("id", taskId);
  if (error) throw error;
}

/** New sections append to the bottom of the project — they accrete as the
 * work grows, so a new one never shoves itself above what's organized. */
export async function createSection(
  projectId: string,
  name: string
): Promise<{ id: string; sortOrder: number }> {
  const { supabase } = await ctx();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Section name is required");

  const { data: last } = await supabase
    .from("todo_sections")
    .select("sort_order")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (last?.sort_order ?? 0) + 1;

  const { data, error } = await supabase
    .from("todo_sections")
    .insert({ project_id: projectId, name: trimmed, sort_order: sortOrder })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id as string, sortOrder };
}

export async function renameSection(sectionId: string, name: string): Promise<void> {
  const { supabase } = await ctx();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Section name is required");
  const { error } = await supabase
    .from("todo_sections")
    .update({ name: trimmed })
    .eq("id", sectionId);
  if (error) throw error;
}

/**
 * Delete a section but keep its to-dos: they merge upward into the preceding
 * section, or into the project's unsectioned top area when there isn't one. A
 * section is a label, not a container of value — so this never prompts, and
 * the undo toast (restoreSection) puts both the heading and its to-dos back.
 */
export async function deleteSection(
  sectionId: string
): Promise<{ deletedAt: string; movedTaskIds: string[] }> {
  const { supabase } = await ctx();
  const { data: section } = await supabase
    .from("todo_sections")
    .select("id, project_id, sort_order")
    .eq("id", sectionId)
    .maybeSingle();
  if (!section) return { deletedAt: new Date().toISOString(), movedTaskIds: [] };

  const { data: preceding } = await supabase
    .from("todo_sections")
    .select("id")
    .eq("project_id", section.project_id)
    .is("deleted_at", null)
    .neq("id", sectionId)
    .lt("sort_order", section.sort_order)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Completed to-dos move too, so un-completing one from the Logbook lands it
  // where its neighbors went rather than pointing at a deleted heading.
  const { data: moved, error: taskError } = await supabase
    .from("todo_tasks")
    .update({ section_id: preceding?.id ?? null })
    .eq("section_id", sectionId)
    .is("deleted_at", null)
    .select("id");
  if (taskError) throw taskError;

  const deletedAt = new Date().toISOString();
  const { error } = await supabase
    .from("todo_sections")
    .update({ deleted_at: deletedAt })
    .eq("id", sectionId);
  if (error) throw error;

  return { deletedAt, movedTaskIds: ((moved ?? []) as { id: string }[]).map((t) => t.id) };
}

/** Undo a section delete: the heading comes back and reclaims the to-dos that
 * merged upward out of it. */
export async function restoreSection(
  sectionId: string,
  taskIds: string[]
): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_sections")
    .update({ deleted_at: null })
    .eq("id", sectionId);
  if (error) throw error;
  if (taskIds.length === 0) return;
  const { error: taskError } = await supabase
    .from("todo_tasks")
    .update({ section_id: sectionId })
    .in("id", taskIds);
  if (taskError) throw taskError;
}

export async function setSectionSortOrder(
  sectionId: string,
  sortOrder: number
): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_sections")
    .update({ sort_order: sortOrder })
    .eq("id", sectionId);
  if (error) throw error;
}

/** Reset a project's section positions to 1..n when midpoints run dry. */
export async function renormalizeSectionOrder(orderedIds: string[]): Promise<void> {
  const { supabase } = await ctx();
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("todo_sections").update({ sort_order: index + 1 }).eq("id", id)
    )
  );
}

export async function createProject(name: string): Promise<{ id: string }> {
  const { supabase, selfEmail } = await ctx();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Project name is required");

  const { data: last } = await supabase
    .from("todo_projects")
    .select("sort_order")
    .is("completed_at", null)
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("todo_projects")
    .insert({ name: trimmed, sort_order: (last?.sort_order ?? 0) + 1 })
    .select("id")
    .single();
  if (error) throw error;

  // Creator starts as sole member.
  const { error: memberError } = await supabase
    .from("todo_project_members")
    .insert({ project_id: data.id, member_email: selfEmail });
  if (memberError) throw memberError;

  return { id: data.id };
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  const { supabase } = await ctx();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Project name is required");
  const { error } = await supabase
    .from("todo_projects")
    .update({ name: trimmed })
    .eq("id", projectId);
  if (error) throw error;
}

export async function setProjectArea(projectId: string, areaId: string | null): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_projects")
    .update({ area_id: areaId })
    .eq("id", projectId);
  if (error) throw error;
}

export async function addProjectMember(projectId: string, memberEmail: string): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_project_members")
    .upsert(
      { project_id: projectId, member_email: memberEmail },
      { onConflict: "project_id,member_email", ignoreDuplicates: true }
    );
  if (error) throw error;
}

/**
 * Remove a member — blocked while they still have active tasks assigned in
 * the project (reassign those first), so a project never holds tasks owned by
 * a non-member.
 */
export async function removeProjectMember(
  projectId: string,
  memberEmail: string
): Promise<{ blocked?: string }> {
  const { supabase } = await ctx();

  const { count } = await supabase
    .from("todo_tasks")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("assignee_email", memberEmail)
    .is("completed_at", null)
    .is("deleted_at", null);
  if ((count ?? 0) > 0) {
    return {
      blocked: `Reassign their ${count} open task${count === 1 ? "" : "s"} in this project first.`,
    };
  }

  const { error } = await supabase
    .from("todo_project_members")
    .delete()
    .eq("project_id", projectId)
    .eq("member_email", memberEmail);
  if (error) throw error;
  return {};
}

/**
 * Complete a project: files it in the Logbook and completes any still-open
 * tasks with it (the UI confirms when there are any).
 */
export async function completeProject(projectId: string): Promise<void> {
  const { supabase, selfEmail } = await ctx();
  const now = new Date().toISOString();

  const { error: taskError } = await supabase
    .from("todo_tasks")
    .update({ completed_at: now, completed_by_email: selfEmail, snoozed_until: null })
    .eq("project_id", projectId)
    .is("completed_at", null)
    .is("deleted_at", null);
  if (taskError) throw taskError;

  const { error } = await supabase
    .from("todo_projects")
    .update({ completed_at: now, completed_by_email: selfEmail })
    .eq("id", projectId);
  if (error) throw error;
}

/** Logbook → bring a completed project back (its tasks stay completed). */
export async function uncompleteProject(projectId: string): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_projects")
    .update({ completed_at: null, completed_by_email: null })
    .eq("id", projectId);
  if (error) throw error;
}

/**
 * Soft-delete a project and its active tasks together; restoreProject brings
 * both back (it only restores tasks stamped at the same deleted_at moment, so
 * tasks deleted earlier stay deleted).
 */
export async function deleteProject(projectId: string): Promise<{ deletedAt: string }> {
  const { supabase } = await ctx();
  const deletedAt = new Date().toISOString();

  const { error: taskError } = await supabase
    .from("todo_tasks")
    .update({ deleted_at: deletedAt })
    .eq("project_id", projectId)
    .is("deleted_at", null);
  if (taskError) throw taskError;

  const { error } = await supabase
    .from("todo_projects")
    .update({ deleted_at: deletedAt })
    .eq("id", projectId);
  if (error) throw error;
  // No revalidate here: the project page stays mounted through the undo
  // window (revalidating would immediately re-render it into a 404). The
  // undo path and the post-undo-window navigation both refresh explicitly.
  return { deletedAt };
}

export async function restoreProject(projectId: string, deletedAt: string): Promise<void> {
  const { supabase } = await ctx();

  const { error: taskError } = await supabase
    .from("todo_tasks")
    .update({ deleted_at: null })
    .eq("project_id", projectId)
    .eq("deleted_at", deletedAt);
  if (taskError) throw taskError;

  const { error } = await supabase
    .from("todo_projects")
    .update({ deleted_at: null })
    .eq("id", projectId);
  if (error) throw error;
}

// ============================================================
// API tokens (ingest endpoint auth; see migration 00131)
// ============================================================

/**
 * Mint a personal API token for /api/todo/ingest. The raw token is returned
 * exactly once (shown in the settings UI, never again); only its SHA-256 hex
 * digest is stored.
 */
export async function createApiToken(
  name: string
): Promise<{ id: string; token: string }> {
  const { supabase, selfEmail } = await ctx();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Token name is required");

  const token = `todo_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { data, error } = await supabase
    .from("todo_api_tokens")
    .insert({ member_email: selfEmail, name: trimmed, token_hash: tokenHash })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create token");

  revalidatePath("/todos/settings");
  return { id: data.id as string, token };
}

export async function revokeApiToken(tokenId: string): Promise<void> {
  const { supabase } = await ctx();
  const { error } = await supabase
    .from("todo_api_tokens")
    .delete()
    .eq("id", tokenId);
  if (error) throw error;
  revalidatePath("/todos/settings");
}

// ============================================================
// Attachments (todo-images bucket; see migrations 00130 + 00132)
// ============================================================

const ATTACHMENTS_BUCKET = "todo-images";

/**
 * Sign upload URLs for one attachment. Images get an original + downscaled
 * display pair; other files store just the original.
 */
export async function createTaskAttachmentUploadUrls(
  taskId: string,
  attachmentId: string,
  ext: string,
  kind: "image" | "file"
): Promise<{
  originalPath: string;
  originalToken: string;
  displayPath: string | null;
  displayToken: string | null;
}> {
  const { supabase } = await ctx();
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const originalPath = `${taskId}/${attachmentId}-original.${safeExt}`;

  const original = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(originalPath);
  if (original.error || !original.data) {
    throw new Error(original.error?.message ?? "Failed to create upload URL");
  }

  if (kind !== "image") {
    return {
      originalPath: original.data.path,
      originalToken: original.data.token,
      displayPath: null,
      displayToken: null,
    };
  }

  const displayPath = `${taskId}/${attachmentId}-display.jpg`;
  const display = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(displayPath);
  if (display.error || !display.data) {
    throw new Error(display.error?.message ?? "Failed to create upload URL");
  }

  return {
    originalPath: original.data.path,
    originalToken: original.data.token,
    displayPath: display.data.path,
    displayToken: display.data.token,
  };
}

export async function attachTaskAttachment(
  taskId: string,
  input: {
    originalPath: string;
    displayPath: string | null;
    kind: "image" | "file";
    fileName: string;
    mimeType: string | null;
  }
): Promise<string> {
  const { supabase, selfEmail } = await ctx();
  const { data, error } = await supabase
    .from("todo_task_attachments")
    .insert({
      task_id: taskId,
      original_path: input.originalPath,
      display_path: input.displayPath,
      kind: input.kind,
      file_name: input.fileName,
      mime_type: input.mimeType,
      uploaded_by_email: selfEmail,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to attach file");
  return data.id as string;
}

export async function deleteTaskAttachment(attachmentId: string): Promise<void> {
  const { supabase } = await ctx();
  const { data: attachment } = await supabase
    .from("todo_task_attachments")
    .select("original_path, display_path")
    .eq("id", attachmentId)
    .maybeSingle();
  if (!attachment) return;

  const { error } = await supabase
    .from("todo_task_attachments")
    .delete()
    .eq("id", attachmentId);
  if (error) throw error;

  await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .remove(
      [attachment.original_path, attachment.display_path].filter(
        (p): p is string => !!p
      )
    );
}

export async function createArea(name: string): Promise<{ id: string }> {
  const { supabase } = await ctx();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Area name is required");

  const { data: last } = await supabase
    .from("todo_areas")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("todo_areas")
    .insert({ name: trimmed, sort_order: (last?.sort_order ?? 0) + 1 })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}
