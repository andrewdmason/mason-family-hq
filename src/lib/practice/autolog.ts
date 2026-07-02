import type { SupabaseClient } from "@supabase/supabase-js";
import type { PracticeSegment } from "@/lib/types";
import { generatePieceNarrative } from "./narrative";

// Task writer for the open-session linking flow (plan U8/KTD9). This module
// used to be Listen's auto-logger (writeSessionTasks: delete-and-rewrite the
// whole session's tasks from the recognition result). Linking inverted that:
// recognition segments are now PROPOSALS, and only explicit user acceptance
// writes a task — one ordinary completed practice_task per accepted proposal,
// tagged with the session. Nothing here ever deletes; re-links replace the
// proposal pool (practice_sessions.result), never accepted tasks.

/**
 * Stable content key for a recognition proposal: identifies "this stretch of
 * this piece" across renders and re-links (segment array indices don't
 * survive a re-link; this does, as long as recognition lands the same span).
 * Stored on accepted_segments so accepted proposals are filtered out of the
 * pool and acceptance is idempotent.
 */
export function proposalKey(seg: {
  pieceId: string | null;
  startSec: number;
  endSec: number;
}): string {
  return `${seg.pieceId}:${seg.startSec.toFixed(1)}:${seg.endSec.toFixed(1)}`;
}

/**
 * Write the completed practice_task for one accepted proposal (F4/R16):
 * same row shape the auto-logger produced (duration in the timer columns, a
 * teacher-legible narrative, session_id tag), but one insert per acceptance —
 * no reconciliation against anything. Returns the new task's id.
 */
export async function writeAcceptedSegmentTask(
  supabase: SupabaseClient,
  sessionId: string,
  seg: PracticeSegment,
  opts: { date: string; sessionNumber: number }
): Promise<string> {
  if (!seg.pieceId) throw new Error("Proposal has no piece");
  const seconds = Math.max(0, seg.endSec - seg.startSec);
  const minutes = Math.max(1, Math.round(seconds / 60));
  const text = await generatePieceNarrative({
    sections: seg.region ? [{ name: seg.region, minutes }] : [],
    handsSeparate: seg.handsSeparate,
  });

  const { data: maxRow } = await supabase
    .from("practice_tasks")
    .select("sort_order")
    .eq("date", opts.date)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;

  const { data, error } = await supabase
    .from("practice_tasks")
    .insert(taskRow(seg.pieceId, seconds, text, sessionId, opts, sortOrder))
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to write task");
  }
  return data.id as string;
}

function taskRow(
  pieceId: string,
  seconds: number,
  text: string,
  sessionId: string,
  opts: { date: string; sessionNumber: number },
  sortOrder: number
): Record<string, unknown> {
  const elapsed = Math.max(1, Math.round(seconds));
  // Encode measured duration in the timer columns: elapsed = timer_seconds - remaining.
  return {
    piece_id: pieceId,
    date: opts.date,
    text,
    timer_seconds: elapsed,
    timer_remaining_seconds: 0,
    completed: true,
    completed_at: new Date().toISOString(),
    session_id: sessionId,
    session_number: opts.sessionNumber,
    sort_order: sortOrder,
  };
}
