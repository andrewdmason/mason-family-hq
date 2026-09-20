"use server";

import { createClient } from "@/lib/supabase/server";
import { localDate, getUserTimezone } from "@/lib/date-utils";
import type { TimeSummaryEntry, PieceKind } from "@/lib/types";

/**
 * Get today's time summary from practice_tasks.
 */
export async function getTodaySummary(): Promise<TimeSummaryEntry[]> {
  const supabase = await createClient();
  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  const { data: tasks } = await supabase
    .from("practice_tasks")
    .select("piece_id, timer_seconds, timer_remaining_seconds")
    .eq("date", today);

  if (!tasks || tasks.length === 0) return [];

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
      });
    }
  }

  return Array.from(groups.values()).sort(
    (a, b) => b.total_seconds - a.total_seconds
  );
}
