"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserTimezone } from "@/lib/date-utils";
import { localDate } from "@/lib/date-utils";
import {
  isUntouchedOccurrence,
  nextOccurrenceDate,
} from "@/lib/practice/repeat";
import type {
  PieceKind,
  PieceSection,
  PracticeTask,
  SectionStatus,
} from "@/lib/types";

export type TaskWithPiece = PracticeTask & {
  piece_name: string | null;
  piece_composer: string | null;
  section_label: string | null;
};

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Withdraw the occurrences a repeating item scheduled when it was archived,
 * but only the ones still untouched — once a copy has been started, timed or
 * archived in its own right it belongs to that day and is left alone.
 * Returns the ids removed so the caller can clear them from the view.
 */
async function deletePendingRepeatOccurrences(
  supabase: SupabaseClient,
  sourceTaskId: string
): Promise<string[]> {
  const { data: spawned } = await supabase
    .from("practice_tasks")
    .select("id, timer_seconds, timer_remaining_seconds, completed, started_at")
    .eq("repeat_source_task_id", sourceTaskId);

  const pending = (spawned ?? []).filter(isUntouchedOccurrence).map((t) => t.id);

  if (pending.length === 0) return [];

  await supabase.from("practice_tasks").delete().in("id", pending);
  return pending;
}

export async function getTasksForPieceAndDate(
  pieceId: string,
  date: string
): Promise<PracticeTask[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("practice_tasks")
    .select("*")
    .eq("piece_id", pieceId)
    .eq("date", date)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return (data ?? []) as PracticeTask[];
}

export async function getTasksForPiece(pieceId: string): Promise<PracticeTask[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("practice_tasks")
    .select("*")
    .eq("piece_id", pieceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return (data ?? []) as PracticeTask[];
}

export async function getTaskWithDetails(
  taskId: string
): Promise<(PracticeTask & {
  piece_name: string | null;
  piece_composer: string | null;
  piece_kind: PieceKind | null;
  section_label: string | null;
  section_status: SectionStatus | null;
}) | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("practice_tasks")
    .select(
      "*, pieces(name, composer, kind), piece_sections(label, status)"
    )
    .eq("id", taskId)
    .maybeSingle();

  if (!data) return null;
  const row = data as Record<string, unknown> & {
    pieces?: {
      name: string | null;
      composer: string | null;
      kind: PieceKind | null;
    } | null;
    piece_sections?: {
      label: string | null;
      status: SectionStatus | null;
    } | null;
  };
  return {
    ...(row as unknown as PracticeTask),
    piece_name: row.pieces?.name ?? null,
    piece_composer: row.pieces?.composer ?? null,
    piece_kind: row.pieces?.kind ?? null,
    section_label: row.piece_sections?.label ?? null,
    section_status: row.piece_sections?.status ?? null,
  };
}

export async function getTasksForDate(date: string): Promise<TaskWithPiece[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("practice_tasks")
    .select("*, pieces(name, composer), piece_sections(label)")
    .eq("date", date)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return ((data ?? []) as any[]).map((row) => ({
    ...row,
    piece_name: row.pieces?.name ?? null,
    piece_composer: row.pieces?.composer ?? null,
    section_label: row.piece_sections?.label ?? null,
    pieces: undefined,
    piece_sections: undefined,
  }));
}

export async function createTask(
  pieceId: string | null,
  sectionId: string | null,
  metronomeSpeed: number | null,
  date?: string,
  afterTaskId?: string | null,
  sessionNumber?: number,
  text?: string,
  timerSeconds?: number,
  repeat?: {
    intervalDays?: number | null;
    /** Set when this row is the next occurrence of a repeating item. */
    sourceTaskId?: string | null;
  }
): Promise<{ id: string; timer_seconds: number; timer_remaining_seconds: number }> {
  const supabase = await createClient();

  // Archiving a repeating item schedules its next occurrence. Toggling the
  // archive off and on again must not leave two copies behind, so clear any
  // untouched occurrence this same source already put on the board.
  if (repeat?.sourceTaskId) {
    await deletePendingRepeatOccurrences(supabase, repeat.sourceTaskId);
  }

  let nextOrder: number;
  let resolvedSession = sessionNumber ?? 1;

  if (afterTaskId) {
    // Insert directly below the given task: shift later siblings down by 1.
    const { data: target } = await supabase
      .from("practice_tasks")
      .select("sort_order, piece_id, date, session_number")
      .eq("id", afterTaskId)
      .single();

    if (!target) throw new Error("Anchor task not found");

    nextOrder = target.sort_order + 1;
    if (sessionNumber === undefined) resolvedSession = target.session_number;

    let shiftQuery = supabase
      .from("practice_tasks")
      .select("id, sort_order")
      .eq("date", target.date)
      .gte("sort_order", nextOrder);
    shiftQuery = target.piece_id
      ? shiftQuery.eq("piece_id", target.piece_id)
      : shiftQuery.is("piece_id", null);

    const { data: toShift } = await shiftQuery;
    if (toShift && toShift.length > 0) {
      await Promise.all(
        toShift.map((row) =>
          supabase
            .from("practice_tasks")
            .update({ sort_order: row.sort_order + 1 })
            .eq("id", row.id)
        )
      );
    }
  } else {
    // No anchor: append at end of the day. Piece grouping is by piece_id, so
    // a new task for an existing piece still lands inside its group; a task
    // for a piece not yet on the day becomes a new group at the bottom.
    const resolvedDate =
      date ?? localDate(new Date(), await getUserTimezone());

    const { data: maxRow } = await supabase
      .from("practice_tasks")
      .select("sort_order")
      .eq("date", resolvedDate)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    nextOrder = (maxRow?.sort_order ?? -1) + 1;
  }

  const { data, error } = await supabase
    .from("practice_tasks")
    .insert({
      piece_id: pieceId,
      section_id: sectionId,
      metronome_speed: metronomeSpeed,
      sort_order: nextOrder,
      session_number: resolvedSession,
      ...(date ? { date } : {}),
      ...(text ? { text } : {}),
      ...(timerSeconds !== undefined
        ? { timer_seconds: timerSeconds, timer_remaining_seconds: timerSeconds }
        : {}),
      ...(repeat?.intervalDays !== undefined
        ? { repeat_interval_days: repeat.intervalDays }
        : {}),
      ...(repeat?.sourceTaskId
        ? { repeat_source_task_id: repeat.sourceTaskId }
        : {}),
    })
    .select("id, timer_seconds, timer_remaining_seconds")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create task");

  revalidatePath("/practice");
  return {
    id: data.id,
    timer_seconds: data.timer_seconds,
    timer_remaining_seconds: data.timer_remaining_seconds,
  };
}

export async function updateTaskSession(taskId: string, sessionNumber: number) {
  const supabase = await createClient();

  await supabase
    .from("practice_tasks")
    .update({ session_number: sessionNumber })
    .eq("id", taskId);
}

export async function updateTasksSession(
  taskIds: string[],
  sessionNumber: number
) {
  if (taskIds.length === 0) return;
  const supabase = await createClient();

  await supabase
    .from("practice_tasks")
    .update({ session_number: sessionNumber })
    .in("id", taskIds);
}

export async function updateTaskField(
  taskId: string,
  field: "text" | "metronome_speed" | "timer_seconds" | "timer_remaining_seconds",
  value: string | number | null
) {
  const supabase = await createClient();

  // Skip revalidation for goal edits — the client holds optimistic state and
  // also writes a recomputed timer_remaining_seconds via updateTaskRemaining
  // so accrued time is preserved.
  if (field === "timer_seconds") {
    await supabase
      .from("practice_tasks")
      .update({ timer_seconds: value as number })
      .eq("id", taskId);
    return;
  }

  await supabase
    .from("practice_tasks")
    .update({ [field]: value })
    .eq("id", taskId);

  revalidatePath("/practice");
}

/**
 * Set a task's section and (optionally) its metronome in one write.
 * Pass `metronomeSpeed: undefined` to leave metronome unchanged.
 */
export async function updateTaskSection(
  taskId: string,
  sectionId: string | null,
  metronomeSpeed: number | null | undefined
) {
  const supabase = await createClient();

  const update: Record<string, unknown> = { section_id: sectionId };
  if (metronomeSpeed !== undefined) update.metronome_speed = metronomeSpeed;

  await supabase.from("practice_tasks").update(update).eq("id", taskId);
  revalidatePath("/practice");
}

/**
 * Flat leaf sections + piece target tempo for the task-row section picker.
 * Mirrors the flattening behavior of `flattenSections()`: a parent without
 * children is kept; a parent with children is replaced by its children.
 */
export async function getSectionPickerData(
  pieceId: string
): Promise<{ sections: PieceSection[]; pieceTargetTempo: number | null }> {
  const supabase = await createClient();

  const [sectionsRes, pieceRes] = await Promise.all([
    supabase
      .from("piece_sections")
      .select("*")
      .eq("piece_id", pieceId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("pieces")
      .select("target_tempo")
      .eq("id", pieceId)
      .single(),
  ]);

  const rows = (sectionsRes.data ?? []) as PieceSection[];
  const childrenByParent = new Map<string, PieceSection[]>();
  for (const r of rows) {
    if (r.parent_id) {
      const list = childrenByParent.get(r.parent_id) ?? [];
      list.push(r);
      childrenByParent.set(r.parent_id, list);
    }
  }

  const flat: PieceSection[] = [];
  for (const r of rows) {
    if (r.parent_id !== null) continue;
    const children = childrenByParent.get(r.id);
    if (!children || children.length === 0) {
      flat.push(r);
    } else {
      flat.push(...children.sort((a, b) => a.sort_order - b.sort_order));
    }
  }

  return {
    sections: flat,
    pieceTargetTempo: pieceRes.data?.target_tempo ?? null,
  };
}

export async function completeTask(taskId: string) {
  const supabase = await createClient();

  await supabase
    .from("practice_tasks")
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq("id", taskId);

  revalidatePath("/practice");
}

/**
 * Un-archiving a repeating item also takes back the occurrence that archiving
 * put on a future day — the point of undoing is to leave no trace.
 * Returns the withdrawn ids so the view can drop those rows too.
 */
export async function uncompleteTask(taskId: string): Promise<string[]> {
  const supabase = await createClient();

  await supabase
    .from("practice_tasks")
    .update({ completed: false, completed_at: null })
    .eq("id", taskId);

  const withdrawn = await deletePendingRepeatOccurrences(supabase, taskId);

  revalidatePath("/practice");
  return withdrawn;
}

/** Set or clear an item's rolling cadence. `null` makes it a one-off again. */
export async function updateTaskRepeat(
  taskId: string,
  intervalDays: number | null
): Promise<void> {
  const supabase = await createClient();

  await supabase
    .from("practice_tasks")
    .update({ repeat_interval_days: intervalDays })
    .eq("id", taskId);

  revalidatePath("/practice");
}

export async function deleteTask(taskId: string) {
  const supabase = await createClient();

  await supabase
    .from("practice_tasks")
    .delete()
    .eq("id", taskId);

  revalidatePath("/practice");
}

export async function duplicateTask(
  taskId: string,
  targetDate: string
): Promise<{ id: string; date: string }> {
  const supabase = await createClient();

  const { data: source } = await supabase
    .from("practice_tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (!source) throw new Error("Task not found");

  let sortQuery = supabase
    .from("practice_tasks")
    .select("sort_order")
    .eq("date", targetDate)
    .eq("completed", false)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (source.piece_id) {
    sortQuery = sortQuery.eq("piece_id", source.piece_id);
  } else {
    sortQuery = sortQuery.is("piece_id", null);
  }

  const { data: maxTask } = await sortQuery.single();
  const nextOrder = (maxTask?.sort_order ?? -1) + 1;

  const { data: newTask, error } = await supabase
    .from("practice_tasks")
    .insert({
      piece_id: source.piece_id,
      section_id: source.section_id,
      date: targetDate,
      text: source.text,
      metronome_speed: source.metronome_speed,
      timer_seconds: source.timer_seconds,
      timer_remaining_seconds: source.timer_seconds, // Reset timer
      sort_order: nextOrder,
    })
    .select("id")
    .single();

  if (error || !newTask) throw new Error(error?.message ?? "Failed to duplicate task");

  revalidatePath("/practice");
  return { id: newTask.id, date: targetDate };
}

/**
 * Save edits to the occurrence a repeating item scheduled when it was
 * archived. Everything the edit sheet can change moves in one write; the timer
 * hasn't run yet, so remaining tracks the goal. Moving the occurrence to a
 * different day re-appends it there, matching moveTaskToDate's placement.
 */
export async function updateFollowUpTask(
  taskId: string,
  input: {
    date: string;
    sessionNumber: number;
    sectionId: string | null;
    metronomeSpeed: number | null;
    timerSeconds: number;
    text: string;
  }
): Promise<void> {
  const supabase = await createClient();

  const { data: source } = await supabase
    .from("practice_tasks")
    .select("piece_id, date")
    .eq("id", taskId)
    .single();

  if (!source) throw new Error("Task not found");

  const update: Record<string, unknown> = {
    date: input.date,
    session_number: input.sessionNumber,
    section_id: input.sectionId,
    metronome_speed: input.metronomeSpeed,
    timer_seconds: input.timerSeconds,
    timer_remaining_seconds: input.timerSeconds,
    text: input.text,
  };

  if (source.date !== input.date) {
    let sortQuery = supabase
      .from("practice_tasks")
      .select("sort_order")
      .eq("date", input.date)
      .order("sort_order", { ascending: false })
      .limit(1);

    sortQuery = source.piece_id
      ? sortQuery.eq("piece_id", source.piece_id)
      : sortQuery.is("piece_id", null);

    const { data: maxRow } = await sortQuery.maybeSingle();
    update.sort_order = (maxRow?.sort_order ?? -1) + 1;
  }

  await supabase.from("practice_tasks").update(update).eq("id", taskId);

  revalidatePath("/practice");
}

async function writeTaskDate(
  supabase: SupabaseClient,
  taskId: string,
  targetDate: string
): Promise<void> {
  const { data: source } = await supabase
    .from("practice_tasks")
    .select("piece_id")
    .eq("id", taskId)
    .single();

  if (!source) throw new Error("Task not found");

  let sortQuery = supabase
    .from("practice_tasks")
    .select("sort_order")
    .eq("date", targetDate)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (source.piece_id) {
    sortQuery = sortQuery.eq("piece_id", source.piece_id);
  } else {
    sortQuery = sortQuery.is("piece_id", null);
  }

  const { data: maxRow } = await sortQuery.maybeSingle();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  await supabase
    .from("practice_tasks")
    .update({
      date: targetDate,
      session_number: 1,
      sort_order: nextOrder,
    })
    .eq("id", taskId);
}

export async function moveTaskToDate(
  taskId: string,
  targetDate: string
): Promise<void> {
  const supabase = await createClient();
  await writeTaskDate(supabase, taskId, targetDate);
  revalidatePath("/practice");
}

/*
 * Leftover cleanup writes. Deliberately no revalidatePath: the list is worked
 * through a click at a time with each change already on screen, and a route
 * re-render per click would queue behind the next click and repaint the list
 * from a snapshot that hasn't caught up. The log re-reads once the clicks stop.
 */

export async function archiveLeftover(taskId: string): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("practice_tasks")
    .update({ completed: true, completed_at: new Date().toISOString() })
    .eq("id", taskId);
}

export async function deleteLeftover(taskId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("practice_tasks").delete().eq("id", taskId);
}

export async function moveLeftoverToDate(
  taskId: string,
  targetDate: string
): Promise<void> {
  const supabase = await createClient();
  await writeTaskDate(supabase, taskId, targetDate);
}

export async function moveTasksToDate(
  taskIds: string[],
  targetDate: string
): Promise<void> {
  if (taskIds.length === 0) return;
  const supabase = await createClient();

  const { data: maxRow } = await supabase
    .from("practice_tasks")
    .select("sort_order")
    .eq("date", targetDate)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextSort = (maxRow?.sort_order ?? -1) + 1;

  await Promise.all(
    taskIds.map((id) =>
      supabase
        .from("practice_tasks")
        .update({
          date: targetDate,
          session_number: 1,
          sort_order: nextSort++,
        })
        .eq("id", id)
    )
  );

  revalidatePath("/practice");
}

export async function updateTaskRemaining(taskId: string, remainingSeconds: number) {
  const supabase = await createClient();

  await supabase
    .from("practice_tasks")
    .update({ timer_remaining_seconds: remainingSeconds })
    .eq("id", taskId);
}

export async function startTaskTimer(taskId: string) {
  const supabase = await createClient();

  await supabase
    .from("practice_tasks")
    .update({ started_at: new Date().toISOString() })
    .eq("id", taskId);
}

export async function stopTaskTimer(taskId: string, remainingSeconds: number) {
  const supabase = await createClient();

  await supabase
    .from("practice_tasks")
    .update({
      timer_remaining_seconds: remainingSeconds,
      ended_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  revalidatePath("/practice");
}

export async function getNextTaskForToday(
  pieceId?: string
): Promise<PracticeTask | null> {
  const supabase = await createClient();
  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  let query = supabase
    .from("practice_tasks")
    .select("*")
    .eq("date", today)
    .eq("completed", false)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1);

  if (pieceId) query = query.eq("piece_id", pieceId);

  const { data } = await query;

  return ((data ?? [])[0] as PracticeTask) ?? null;
}

/**
 * Archive a batch of leftovers — items left unfinished on earlier days — in one
 * write. Repeating ones come back the way a single archive brings them back:
 * one cadence after the day they were down for, or on `resumeDate` when that
 * day has already gone by. Pass `ids` for specific rows, or `before` for
 * everything unfinished dated before that day. Like the single leftover
 * writes above, it leaves the re-read to the log.
 */
export async function archiveLeftovers(input: {
  ids?: string[];
  before?: string;
  today: string;
  resumeDate: string | null;
}): Promise<void> {
  const { ids, before, today, resumeDate } = input;
  if (!ids?.length && !before) return;
  const supabase = await createClient();

  let repeatingQuery = supabase
    .from("practice_tasks")
    .select(
      "id, piece_id, section_id, date, text, metronome_speed, timer_seconds, session_number, repeat_interval_days"
    )
    .eq("completed", false)
    .not("repeat_interval_days", "is", null);
  repeatingQuery = ids?.length
    ? repeatingQuery.in("id", ids)
    : repeatingQuery.lt("date", before!);
  const { data: repeating } = await repeatingQuery;

  const completedAt = new Date().toISOString();
  let archiveQuery = supabase
    .from("practice_tasks")
    .update({ completed: true, completed_at: completedAt })
    .eq("completed", false);
  archiveQuery = ids?.length
    ? archiveQuery.in("id", ids)
    : archiveQuery.lt("date", before!);
  await archiveQuery;

  const occurrences = (repeating ?? []).flatMap((row) => {
    const date =
      nextOccurrenceDate(row.date, row.repeat_interval_days!, today) ??
      resumeDate;
    return date ? [{ row, date }] : [];
  });
  if (occurrences.length === 0) return;

  // Append each occurrence at the end of its day, as a single archive does.
  const targetDates = [...new Set(occurrences.map((o) => o.date))];
  const { data: sortRows } = await supabase
    .from("practice_tasks")
    .select("date, sort_order")
    .in("date", targetDates);
  const nextSortByDate = new Map<string, number>();
  for (const r of sortRows ?? []) {
    nextSortByDate.set(
      r.date,
      Math.max(nextSortByDate.get(r.date) ?? 0, r.sort_order + 1)
    );
  }

  await supabase.from("practice_tasks").insert(
    occurrences.map(({ row, date }) => {
      const sortOrder = nextSortByDate.get(date) ?? 0;
      nextSortByDate.set(date, sortOrder + 1);
      return {
        piece_id: row.piece_id,
        section_id: row.section_id,
        date,
        text: row.text,
        metronome_speed: row.metronome_speed,
        timer_seconds: row.timer_seconds,
        timer_remaining_seconds: row.timer_seconds,
        session_number: row.session_number,
        sort_order: sortOrder,
        repeat_interval_days: row.repeat_interval_days,
        repeat_source_task_id: row.id,
      };
    })
  );
}

export async function reorderTasks(taskIds: string[]) {
  const supabase = await createClient();

  const updates = taskIds.map((id, index) =>
    supabase
      .from("practice_tasks")
      .update({ sort_order: index })
      .eq("id", id)
  );

  await Promise.all(updates);
  revalidatePath("/practice");
}
