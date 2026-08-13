"use server";

import { createClient } from "@/lib/supabase/server";
import { localDate, getUserTimezone } from "@/lib/date-utils";
import { getSections } from "@/app/practice/repertoire/section-actions";
import type {
  TimeSummaryEntry,
  LessonTimeSummary,
  FeedDay,
  TaskWithDetails,
  TaskRecordingDisplay,
  PieceKind,
  PieceSectionWithChildren,
  SectionStatus,
  StatusChange,
} from "@/lib/types";

/**
 * Get time summaries for multiple dates from practice_tasks.
 */
async function getTimeSummariesForDates(
  dates: string[]
): Promise<Map<string, TimeSummaryEntry[]>> {
  const supabase = await createClient();
  const result = new Map<string, TimeSummaryEntry[]>();
  if (dates.length === 0) return result;

  const { data: tasks } = await supabase
    .from("practice_tasks")
    .select("piece_id, date, timer_seconds, timer_remaining_seconds")
    .in("date", dates);

  if (!tasks || tasks.length === 0) {
    for (const d of dates) result.set(d, []);
    return result;
  }

  // Collect all piece IDs and fetch names + kind
  const allPieceIds = new Set<string>();
  for (const t of tasks) {
    if (t.piece_id) allPieceIds.add(t.piece_id);
  }

  let pieceInfo: Record<string, { name: string; kind: PieceKind }> = {};
  if (allPieceIds.size > 0) {
    const { data: pieces } = await supabase
      .from("pieces")
      .select("id, name, kind")
      .in("id", [...allPieceIds]);
    if (pieces) {
      pieceInfo = Object.fromEntries(
        pieces.map((p) => [p.id, { name: p.name, kind: p.kind as PieceKind }])
      );
    }
  }

  // Group by date, then by piece_id
  const dateGroups = new Map<string, Map<string, TimeSummaryEntry>>();

  for (const task of tasks) {
    const elapsed = task.timer_seconds - task.timer_remaining_seconds;
    if (elapsed <= 0) continue;

    const key = task.piece_id ?? "__general__";
    if (!dateGroups.has(task.date)) dateGroups.set(task.date, new Map());
    const groups = dateGroups.get(task.date)!;

    const existing = groups.get(key);
    if (existing) {
      existing.total_seconds += elapsed;
    } else {
      const info = task.piece_id ? pieceInfo[task.piece_id] : null;
      groups.set(key, {
        piece_id: task.piece_id ?? "__general__",
        piece_name: info?.name ?? "General",
        kind: info?.kind ?? "piece",
        total_seconds: elapsed,
      });
    }
  }

  for (const date of dates) {
    const groups = dateGroups.get(date);
    if (!groups) {
      result.set(date, []);
    } else {
      result.set(
        date,
        Array.from(groups.values()).sort(
          (a, b) => b.total_seconds - a.total_seconds
        )
      );
    }
  }

  return result;
}

/**
 * Aggregate time summaries across a date range.
 */
export async function getTimeSummaryForDateRange(
  startDate: string,
  endDate: string
): Promise<LessonTimeSummary> {
  const supabase = await createClient();

  const startMs = new Date(startDate + "T12:00:00").getTime();
  const endMs = new Date(endDate + "T12:00:00").getTime();
  const calendarDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);

  const { data: tasks } = await supabase
    .from("practice_tasks")
    .select("piece_id, date, timer_seconds, timer_remaining_seconds")
    .gte("date", startDate)
    .lte("date", endDate);

  if (!tasks || tasks.length === 0) {
    return { entries: [], totalSeconds: 0, dayCount: 0, calendarDays };
  }

  const distinctDates = new Set(
    tasks
      .filter((t) => t.timer_seconds - t.timer_remaining_seconds > 0)
      .map((t) => t.date)
  );

  const allPieceIds = new Set<string>();
  for (const t of tasks) {
    if (t.piece_id) allPieceIds.add(t.piece_id);
  }

  let pieceInfo: Record<string, { name: string; kind: PieceKind }> = {};
  if (allPieceIds.size > 0) {
    const { data: pieces } = await supabase
      .from("pieces")
      .select("id, name, kind")
      .in("id", [...allPieceIds]);
    if (pieces) {
      pieceInfo = Object.fromEntries(
        pieces.map((p) => [p.id, { name: p.name, kind: p.kind as PieceKind }])
      );
    }
  }

  const groups = new Map<string, TimeSummaryEntry>();
  const pieceDaySets = new Map<string, Set<string>>();

  for (const task of tasks) {
    const elapsed = task.timer_seconds - task.timer_remaining_seconds;
    if (elapsed <= 0) continue;

    const key = task.piece_id ?? "__general__";
    const existing = groups.get(key);
    if (existing) {
      existing.total_seconds += elapsed;
    } else {
      const info = task.piece_id ? pieceInfo[task.piece_id] : null;
      groups.set(key, {
        piece_id: task.piece_id ?? "__general__",
        piece_name: info?.name ?? "General",
        kind: info?.kind ?? "piece",
        total_seconds: elapsed,
        day_count: 0,
      });
    }
    let dateSet = pieceDaySets.get(key);
    if (!dateSet) {
      dateSet = new Set<string>();
      pieceDaySets.set(key, dateSet);
    }
    dateSet.add(task.date);
  }

  for (const [key, entry] of groups) {
    entry.day_count = pieceDaySets.get(key)?.size ?? 0;
  }

  const summaryEntries = Array.from(groups.values()).sort(
    (a, b) => b.total_seconds - a.total_seconds
  );
  const totalSeconds = summaryEntries.reduce((sum, e) => sum + e.total_seconds, 0);

  return {
    entries: summaryEntries,
    totalSeconds,
    dayCount: distinctDates.size,
    calendarDays,
  };
}

/**
 * Fetch tasks with joined piece/section details for a set of dates.
 */
async function getTasksWithDetailsForDates(
  dates: string[]
): Promise<Map<string, TaskWithDetails[]>> {
  const supabase = await createClient();
  const result = new Map<string, TaskWithDetails[]>();
  if (dates.length === 0) return result;

  // practice_recordings embed: only the columns the task-row list renders
  // (U6). Alignment is included — spans/totalMeasures are rendered and small.
  const { data: tasks } = await supabase
    .from("practice_tasks")
    .select(
      "*, pieces(name, composer, kind), piece_sections(label, status), practice_recordings(id, kind, status, audio_path, transcription_path, duration_seconds, trim_start, trim_end, title, error_message, created_at, alignment)"
    )
    .in("date", dates)
    .order("date", { ascending: false })
    .order("session_number", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("created_at", {
      referencedTable: "practice_recordings",
      ascending: true,
    });

  for (const date of dates) result.set(date, []);

  for (const row of tasks ?? []) {
    const piece = row.pieces as unknown as {
      name: string;
      composer: string | null;
      kind: PieceKind;
    } | null;
    const section = row.piece_sections as unknown as {
      label: string;
      status: number;
    } | null;
    const recordings = (row.practice_recordings ??
      []) as unknown as TaskRecordingDisplay[];

    const task: TaskWithDetails = {
      ...row,
      piece_name: piece?.name ?? null,
      piece_composer: piece?.composer ?? null,
      piece_kind: (piece?.kind as PieceKind) ?? null,
      section_label: section?.label ?? null,
      section_status: (section?.status as SectionStatus) ?? null,
      recordings,
      pieces: undefined,
      piece_sections: undefined,
      practice_recordings: undefined,
    } as TaskWithDetails;

    result.get(row.date)!.push(task);
  }

  return result;
}

/**
 * Section trees for the pieces whose tasks carry recordings with alignment
 * spans — only those pieces need span → section mapping in the day view
 * (KTD5). Deduped per piece across all tasks/dates in the page.
 */
async function getSectionsForAlignedPieces(
  tasksByDate: Map<string, TaskWithDetails[]>
): Promise<Record<string, PieceSectionWithChildren[]>> {
  const pieceIds = new Set<string>();
  for (const tasks of tasksByDate.values()) {
    for (const task of tasks) {
      if (!task.piece_id) continue;
      if (
        task.recordings.some((r) => (r.alignment?.spans.length ?? 0) > 0)
      ) {
        pieceIds.add(task.piece_id);
      }
    }
  }
  if (pieceIds.size === 0) return {};

  const ids = [...pieceIds];
  const trees = await Promise.all(ids.map((id) => getSections(id)));
  const out: Record<string, PieceSectionWithChildren[]> = {};
  ids.forEach((id, i) => {
    out[id] = trees[i];
  });
  return out;
}

/**
 * Fetch a page of feed data, cursor-based by date descending.
 */
export async function getFeedPage(
  cursor?: string,
  limit = 7
): Promise<{ items: FeedDay[]; nextCursor: string | null }> {
  const supabase = await createClient();

  // Get distinct dates that have practice tasks
  let query = supabase
    .from("practice_tasks")
    .select("date")
    .order("date", { ascending: false })
    .limit(limit * 5); // over-fetch to get enough distinct dates

  if (cursor) {
    query = query.lt("date", cursor);
  }

  const { data: taskDates } = await query;

  const dateSet = new Set<string>();
  for (const t of taskDates ?? []) dateSet.add(t.date);

  const allDates = Array.from(dateSet)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit);

  if (allDates.length === 0) {
    return { items: [], nextCursor: null };
  }

  // Fetch tasks, time summaries, and snapshots in parallel
  const [tasksByDate, timeSummaryMap, { data: allSnapshots }] = await Promise.all([
    getTasksWithDetailsForDates(allDates),
    getTimeSummariesForDates(allDates),
    supabase
      .from("section_status_snapshots")
      .select("piece_id, section_id, old_status, new_status, snapshot_date")
      .in("snapshot_date", allDates)
      .order("created_at", { ascending: true }),
  ]);

  // Build snapshot section labels
  const snapshotSectionIds = [
    ...new Set((allSnapshots ?? []).map((s) => s.section_id)),
  ];

  let sectionLabelMap = new Map<string, string>();
  if (snapshotSectionIds.length > 0) {
    const { data: sectionLabels } = await supabase
      .from("piece_sections")
      .select("id, label")
      .in("id", snapshotSectionIds);
    sectionLabelMap = new Map(
      (sectionLabels ?? []).map((s) => [s.id, s.label])
    );
  }

  // Group snapshots by date → piece_id
  const statusChangesByDatePiece = new Map<
    string,
    Record<string, StatusChange[]>
  >();
  for (const snap of allSnapshots ?? []) {
    const date = snap.snapshot_date;
    if (!statusChangesByDatePiece.has(date))
      statusChangesByDatePiece.set(date, {});
    const byPiece = statusChangesByDatePiece.get(date)!;
    if (!byPiece[snap.piece_id]) byPiece[snap.piece_id] = [];

    const label = sectionLabelMap.get(snap.section_id) ?? "?";
    const existing = byPiece[snap.piece_id].find(
      (c) => c.sectionLabel === label
    );
    if (existing) {
      existing.newStatus = snap.new_status as SectionStatus;
    } else {
      byPiece[snap.piece_id].push({
        sectionLabel: label,
        oldStatus: snap.old_status as SectionStatus,
        newStatus: snap.new_status as SectionStatus,
      });
    }
  }

  // Filter out net-zero changes
  for (const [date, byPiece] of statusChangesByDatePiece) {
    for (const pieceId of Object.keys(byPiece)) {
      byPiece[pieceId] = byPiece[pieceId].filter(
        (c) => c.oldStatus !== c.newStatus
      );
      if (byPiece[pieceId].length === 0) delete byPiece[pieceId];
    }
    if (Object.keys(byPiece).length === 0)
      statusChangesByDatePiece.delete(date);
  }

  // Sections for pieces whose recordings carry alignment spans (U6/KTD5)
  const sectionsByPiece = await getSectionsForAlignedPieces(tasksByDate);

  // Build feed days
  const items: FeedDay[] = allDates.map((date) => {
    const dayTasks = tasksByDate.get(date) ?? [];
    const dayItem: FeedDay = {
      date,
      tasks: dayTasks,
      timeSummary: timeSummaryMap.get(date) ?? [],
    };

    const dayStatusChanges = statusChangesByDatePiece.get(date);
    if (dayStatusChanges) {
      dayItem.statusChangesByPiece = dayStatusChanges;
    }

    const daySections: Record<string, PieceSectionWithChildren[]> = {};
    for (const t of dayTasks) {
      if (t.piece_id && sectionsByPiece[t.piece_id]) {
        daySections[t.piece_id] = sectionsByPiece[t.piece_id];
      }
    }
    if (Object.keys(daySections).length > 0) {
      dayItem.sectionsByPiece = daySections;
    }

    return dayItem;
  });

  // Check for more data
  const lastDate = allDates[allDates.length - 1];
  const { count: moreCount } = await supabase
    .from("practice_tasks")
    .select("id", { count: "exact", head: true })
    .lt("date", lastDate);

  return {
    items,
    nextCursor: (moreCount ?? 0) > 0 ? lastDate : null,
  };
}

/**
 * Get today's time summary from practice_tasks.
 */
export async function getTodaySummary(): Promise<TimeSummaryEntry[]> {
  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);
  const result = await getTimeSummariesForDates([today]);
  return result.get(today) ?? [];
}

/**
 * Create a new task.
 */
export async function createTask(
  pieceId: string | null,
  options?: {
    sectionId?: string | null;
    metronomeSpeed?: number | null;
    date?: string;
    text?: string;
    timerSeconds?: number;
  }
): Promise<{ id: string }> {
  const supabase = await createClient();

  // Get next sort_order
  let sortQuery = supabase
    .from("practice_tasks")
    .select("sort_order")
    .eq("completed", false)
    .order("sort_order", { ascending: false })
    .limit(1);

  if (pieceId) {
    sortQuery = sortQuery.eq("piece_id", pieceId);
  } else {
    sortQuery = sortQuery.is("piece_id", null);
  }

  if (options?.date) {
    sortQuery = sortQuery.eq("date", options.date);
  }

  const { data: maxRow } = await sortQuery.single();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("practice_tasks")
    .insert({
      piece_id: pieceId,
      section_id: options?.sectionId ?? null,
      metronome_speed: options?.metronomeSpeed ?? null,
      sort_order: nextOrder,
      text: options?.text ?? "",
      timer_seconds: options?.timerSeconds ?? 900,
      timer_remaining_seconds: options?.timerSeconds ?? 900,
      ...(options?.date ? { date: options.date } : {}),
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create task");

  return { id: data.id };
}
