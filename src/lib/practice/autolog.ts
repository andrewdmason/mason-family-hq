import type { SupabaseClient } from "@supabase/supabase-js";
import { TECHNIQUE_PIECE_ID } from "@/lib/types";
import type { PracticeAlignmentResult } from "@/lib/types";
import { generatePieceNarrative } from "./narrative";

// Free-play stretches shorter than this are absorbed, not logged (R7).
const MIN_FREE_SECONDS = 120;

/**
 * Turn the worker's segments into practice_tasks: one task per recognized piece
 * (durations + a teacher-legible narrative), plus a single "free play" task on
 * the Technique system piece when the unmatched time is meaningful.
 *
 * Idempotent: clears any tasks previously written for this session before
 * inserting, so a re-run (or a retried call) never double-logs. The session
 * claim lease already gates concurrent runs; this guards re-processing.
 */
export async function writeSessionTasks(
  supabase: SupabaseClient,
  sessionId: string,
  result: PracticeAlignmentResult,
  opts: { date: string; sessionNumber: number }
): Promise<number> {
  const byPiece = new Map<
    string,
    { seconds: number; regions: Set<string>; handsSeparate: boolean }
  >();
  let freeSeconds = 0;

  for (const seg of result.segments) {
    const dur = Math.max(0, seg.endSec - seg.startSec);
    if (seg.kind === "piece" && seg.pieceId) {
      const g = byPiece.get(seg.pieceId) ?? {
        seconds: 0,
        regions: new Set<string>(),
        handsSeparate: false,
      };
      g.seconds += dur;
      if (seg.region) g.regions.add(seg.region);
      g.handsSeparate = g.handsSeparate || seg.handsSeparate;
      byPiece.set(seg.pieceId, g);
    } else {
      freeSeconds += dur;
    }
  }

  const pieceIds = [...byPiece.keys()];
  const names = new Map<string, string>();
  if (pieceIds.length) {
    const { data } = await supabase
      .from("pieces")
      .select("id, name")
      .in("id", pieceIds);
    for (const p of (data ?? []) as { id: string; name: string }[]) {
      names.set(p.id, p.name);
    }
  }

  // Idempotency: replace any prior tasks for this session.
  await supabase.from("practice_tasks").delete().eq("session_id", sessionId);

  const { data: maxRow } = await supabase
    .from("practice_tasks")
    .select("sort_order")
    .eq("date", opts.date)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  let sortOrder = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;

  const rows: Record<string, unknown>[] = [];
  for (const [pieceId, g] of byPiece) {
    const text = await generatePieceNarrative({
      pieceName: names.get(pieceId) ?? "this piece",
      totalSeconds: g.seconds,
      regions: [...g.regions],
      handsSeparate: g.handsSeparate,
    });
    rows.push(taskRow(pieceId, g.seconds, text, sessionId, opts, sortOrder++));
  }

  if (freeSeconds >= MIN_FREE_SECONDS) {
    const minutes = Math.round(freeSeconds / 60);
    rows.push(
      taskRow(
        TECHNIQUE_PIECE_ID,
        freeSeconds,
        `Free playing / warm-up (~${minutes} min) — no specific piece recognized.`,
        sessionId,
        opts,
        sortOrder++
      )
    );
  }

  if (rows.length) {
    const { error } = await supabase.from("practice_tasks").insert(rows);
    if (error) throw new Error(error.message);
  }
  return rows.length;
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
