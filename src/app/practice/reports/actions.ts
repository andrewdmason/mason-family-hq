"use server";

import { createClient } from "@/lib/supabase/server";
import { localDate } from "@/lib/date-utils";
import type {
  WeeklyPracticeData,
  PieceBreakdownData,
  StreakData,
  TrailingPracticeData,
  PieceKind,
  PieceWeeklyCumulativeData,
  PieceOption,
  CompletedAssignmentMarker,
  SectionStatus,
  SectionStatusSnapshot,
} from "@/lib/types";
import { SECTION_STATUS_PERCENTAGE } from "@/lib/types";

function getWeekStart(dateStr: string, weekStartDay: number = 1): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = (day - weekStartDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return localDate(d);
}

function weekLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Helper: compute elapsed seconds from a practice task.
 */
function taskElapsed(task: {
  timer_seconds: number;
  timer_remaining_seconds: number;
}): number {
  return Math.max(0, task.timer_seconds - task.timer_remaining_seconds);
}

/**
 * Last 13 weeks of total practice time per week.
 */
export async function getWeeklyPracticeData(
  weekStartDay: number = 1
): Promise<WeeklyPracticeData[]> {
  const supabase = await createClient();

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 13 * 7);
  const cutoffStr = localDate(cutoff);

  const { data: tasks } = await supabase
    .from("practice_tasks")
    .select("date, timer_seconds, timer_remaining_seconds")
    .gte("date", cutoffStr);

  const weekMap = new Map<string, number>();

  for (const task of tasks ?? []) {
    const elapsed = taskElapsed(task);
    if (elapsed <= 0) continue;
    const ws = getWeekStart(task.date, weekStartDay);
    weekMap.set(ws, (weekMap.get(ws) ?? 0) + elapsed);
  }

  const result: WeeklyPracticeData[] = [];
  const currentWeekStart = getWeekStart(localDate(now), weekStartDay);

  for (let i = 12; i >= 0; i--) {
    const d = new Date(currentWeekStart + "T00:00:00");
    d.setDate(d.getDate() - i * 7);
    const ws = localDate(d);
    result.push({
      weekStart: ws,
      weekLabel: weekLabel(ws),
      totalSeconds: weekMap.get(ws) ?? 0,
    });
  }

  return result;
}

/**
 * Practice volume as a trailing comparison: the last 7 days (today inclusive)
 * against the 7 days before that, plus per-day totals for the last 14 days. Used
 * by the Home practice widget so the headline and delta don't reset every Monday
 * the way a calendar-week view does.
 */
export async function getTrailingPracticeData(): Promise<TrailingPracticeData> {
  const supabase = await createClient();

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 13); // 14-day window, today inclusive
  const cutoffStr = localDate(cutoff);

  const { data: tasks } = await supabase
    .from("practice_tasks")
    .select("date, timer_seconds, timer_remaining_seconds")
    .gte("date", cutoffStr);

  const byDate = new Map<string, number>();
  for (const task of tasks ?? []) {
    const elapsed = taskElapsed(task);
    if (elapsed <= 0) continue;
    byDate.set(task.date, (byDate.get(task.date) ?? 0) + elapsed);
  }

  const today = localDate(now);
  const dailySeconds: number[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() - i);
    dailySeconds.push(byDate.get(localDate(d)) ?? 0);
  }

  const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
  return {
    currentSeconds: sum(dailySeconds.slice(7)),
    previousSeconds: sum(dailySeconds.slice(0, 7)),
    dailySeconds,
  };
}

/**
 * Time per piece for a given time range.
 */
export async function getPieceBreakdownData(
  range: "7d" | "30d" | "90d" | "all"
): Promise<PieceBreakdownData[]> {
  const supabase = await createClient();

  let query = supabase
    .from("practice_tasks")
    .select("piece_id, date, timer_seconds, timer_remaining_seconds");

  if (range !== "all") {
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    query = query.gte("date", localDate(cutoff));
  }

  const { data: tasks } = await query;

  if (!tasks || tasks.length === 0) return [];

  const groups = new Map<string, number>();

  for (const task of tasks) {
    const elapsed = taskElapsed(task);
    if (elapsed <= 0) continue;
    const key = task.piece_id ?? "__general__";
    groups.set(key, (groups.get(key) ?? 0) + elapsed);
  }

  const pieceIds = [...groups.keys()].filter((k) => k !== "__general__");

  let pieceInfo: Record<string, { name: string; kind: PieceKind }> = {};
  if (pieceIds.length > 0) {
    const { data: pieces } = await supabase
      .from("pieces")
      .select("id, name, kind")
      .in("id", pieceIds);
    if (pieces) {
      pieceInfo = Object.fromEntries(
        pieces.map((p) => [p.id, { name: p.name, kind: p.kind as PieceKind }])
      );
    }
  }

  return [...groups.entries()]
    .map(([pieceId, seconds]) => {
      const info = pieceInfo[pieceId];
      return {
        pieceId,
        label: info?.name ?? "General",
        totalSeconds: seconds,
        kind: info?.kind ?? ("piece" as PieceKind),
      };
    })
    .sort((a, b) => b.totalSeconds - a.totalSeconds);
}

/**
 * Current streak and this-week breakdown.
 */
export async function getStreakData(): Promise<StreakData> {
  const supabase = await createClient();

  // Get distinct dates with practice time
  const { data: tasks } = await supabase
    .from("practice_tasks")
    .select("date, timer_seconds, timer_remaining_seconds")
    .order("date", { ascending: false });

  const practicedDates = new Set<string>();
  for (const task of tasks ?? []) {
    if (taskElapsed(task) > 0) {
      practicedDates.add(task.date);
    }
  }

  const today = new Date();
  const todayStr = localDate(today);

  let currentStreak = 0;
  const d = new Date(today);

  if (!practicedDates.has(todayStr)) {
    d.setDate(d.getDate() - 1);
  }

  while (true) {
    const ds = localDate(d);
    if (practicedDates.has(ds)) {
      currentStreak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }

  const monday = getWeekStart(todayStr);
  const thisWeekDays: boolean[] = [];
  let daysPracticedThisWeek = 0;

  for (let i = 0; i < 7; i++) {
    const wd = new Date(monday + "T00:00:00");
    wd.setDate(wd.getDate() + i);
    const practiced = practicedDates.has(localDate(wd));
    thisWeekDays.push(practiced);
    if (practiced) daysPracticedThisWeek++;
  }

  return { currentStreak, daysPracticedThisWeek, thisWeekDays };
}

/**
 * Get all pieces that have practice time (for the piece selector).
 */
export async function getPiecesWithTimerData(): Promise<PieceOption[]> {
  const supabase = await createClient();

  const { data: tasks } = await supabase
    .from("practice_tasks")
    .select("piece_id, timer_seconds, timer_remaining_seconds")
    .not("piece_id", "is", null);

  if (!tasks || tasks.length === 0) return [];

  const pieceIds = [
    ...new Set(
      tasks
        .filter((t) => taskElapsed(t) > 0)
        .map((t) => t.piece_id!)
    ),
  ];

  if (pieceIds.length === 0) return [];

  const { data: pieces } = await supabase
    .from("pieces")
    .select("id, name, composer")
    .in("id", pieceIds)
    .order("name");

  return (pieces ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    composer: p.composer,
  }));
}

/**
 * Cumulative weekly practice time for a single piece.
 */
export async function getPieceCumulativeData(
  pieceId: string
): Promise<PieceWeeklyCumulativeData[]> {
  const supabase = await createClient();

  const { data: tasks } = await supabase
    .from("practice_tasks")
    .select("date, timer_seconds, timer_remaining_seconds")
    .eq("piece_id", pieceId);

  if (!tasks || tasks.length === 0) return [];

  const weekMap = new Map<string, number>();

  for (const task of tasks) {
    const elapsed = taskElapsed(task);
    if (elapsed <= 0) continue;
    const monday = getWeekStart(task.date);
    weekMap.set(monday, (weekMap.get(monday) ?? 0) + elapsed);
  }

  if (weekMap.size === 0) return [];

  const sortedWeeks = [...weekMap.keys()].sort();
  const firstMonday = sortedWeeks[0];
  const now = new Date();
  const lastMonday = getWeekStart(localDate(now));

  const allWeeks: string[] = [];
  const d = new Date(firstMonday + "T00:00:00");
  while (localDate(d) <= lastMonday) {
    allWeeks.push(localDate(d));
    d.setDate(d.getDate() + 7);
  }

  let cumulative = 0;
  return allWeeks.map((ws) => {
    const weekSec = weekMap.get(ws) ?? 0;
    cumulative += weekSec;
    return {
      weekStart: ws,
      weekLabel: weekLabel(ws),
      weekSeconds: weekSec,
      cumulativeSeconds: cumulative,
    };
  });
}

/**
 * Compute section completion % for each week.
 */
export async function getPieceCompletionByWeek(
  pieceId: string,
  weeks: string[]
): Promise<Map<string, number>> {
  if (weeks.length === 0) return new Map();

  const supabase = await createClient();

  const { data: allSections } = await supabase
    .from("piece_sections")
    .select("id, parent_id, status")
    .eq("piece_id", pieceId);

  if (!allSections || allSections.length === 0) return new Map();

  const parentIds = new Set(
    allSections.filter((s) => s.parent_id).map((s) => s.parent_id!)
  );
  const leafSections = allSections.filter((s) => !parentIds.has(s.id));

  if (leafSections.length === 0) return new Map();

  const { data: snapshots } = await supabase
    .from("section_status_snapshots")
    .select("*")
    .eq("piece_id", pieceId)
    .order("snapshot_date", { ascending: false })
    .order("created_at", { ascending: false });

  const allSnapshots = (snapshots ?? []) as SectionStatusSnapshot[];

  const leafIds = new Set(leafSections.map((s) => s.id));
  const totalSlots = leafSections.length;

  const statusAtPoint = new Map<string, SectionStatus>(
    leafSections.map((s) => [s.id, s.status as SectionStatus])
  );

  function computePct(statusMap: Map<string, SectionStatus>): number {
    let sum = 0;
    for (const status of statusMap.values()) {
      sum += SECTION_STATUS_PERCENTAGE[status] ?? 0;
    }
    return Math.round((sum / totalSlots) * 1000) / 10;
  }

  const sortedWeeks = [...weeks].sort().reverse();
  const result = new Map<string, number>();
  let snapshotIdx = 0;

  for (const weekStart of sortedWeeks) {
    const nextMonday = new Date(weekStart + "T00:00:00");
    nextMonday.setDate(nextMonday.getDate() + 7);
    const nextMondayStr = nextMonday.toISOString().slice(0, 10);

    while (
      snapshotIdx < allSnapshots.length &&
      allSnapshots[snapshotIdx].snapshot_date >= nextMondayStr
    ) {
      const snap = allSnapshots[snapshotIdx];
      if (leafIds.has(snap.section_id)) {
        statusAtPoint.set(snap.section_id, snap.old_status);
      }
      snapshotIdx++;
    }
    result.set(weekStart, computePct(statusAtPoint));
  }

  return result;
}

/**
 * Get completed assignments for a piece, grouped by week for chart markers.
 */
export async function getCompletedAssignmentsForPiece(
  pieceId: string,
  cumulativeData: PieceWeeklyCumulativeData[]
): Promise<CompletedAssignmentMarker[]> {
  const supabase = await createClient();

  const { data: assignments } = await supabase
    .from("assignments")
    .select("id, text, completed_at")
    .eq("piece_id", pieceId)
    .not("completed_at", "is", null);

  if (!assignments || assignments.length === 0) return [];

  const cumulativeMap = new Map(
    cumulativeData.map((d) => [
      d.weekStart,
      Math.round((d.cumulativeSeconds / 3600) * 10) / 10,
    ])
  );

  const weekGroups = new Map<
    string,
    { id: string; text: string; completedAt: string }[]
  >();

  for (const assignment of assignments) {
    const completedDate = assignment.completed_at!.slice(0, 10);
    const monday = getWeekStart(completedDate);
    const group = weekGroups.get(monday) ?? [];
    group.push({
      id: assignment.id,
      text: assignment.text,
      completedAt: assignment.completed_at!,
    });
    weekGroups.set(monday, group);
  }

  return [...weekGroups.entries()]
    .map(([ws, groupAssignments]) => ({
      weekStart: ws,
      weekLabel: weekLabel(ws),
      cumulativeHours: cumulativeMap.get(ws) ?? 0,
      assignments: groupAssignments,
    }))
    .filter((m) => cumulativeMap.has(m.weekStart));
}
