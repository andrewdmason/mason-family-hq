"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * A Recordings-tab row: one kind='performance' practice_recordings row (U7).
 * Auto/manual practice recordings never appear here (R11/AE5); pre-merge
 * single-slot task audio was backfilled as kind='performance' by 00160, so
 * everything recorded before the merge is still listed.
 *
 * `taskId`/`sectionLabel`/`taskText` are nullable now — performances recorded
 * straight from the tab have no task.
 */
export type Recording = {
  id: string;
  taskId: string | null;
  pieceId: string | null;
  audioPath: string;
  durationSeconds: number;
  trimStartSeconds: number | null;
  trimEndSeconds: number | null;
  audioTitle: string | null;
  date: string;
  createdAt: string;
  pieceName: string | null;
  pieceComposer: string | null;
  workName: string | null;
  sectionLabel: string | null;
  taskText: string | null;
};

export async function getRecordings(pieceId?: string): Promise<Recording[]> {
  const supabase = await createClient();

  let query = supabase
    .from("practice_recordings")
    .select(
      "id, task_id, piece_id, date, audio_path, duration_seconds, trim_start, trim_end, title, created_at, pieces(name, composer, works(name)), practice_tasks(text, piece_sections(label))"
    )
    .eq("kind", "performance")
    .not("audio_path", "is", null);

  if (pieceId) query = query.eq("piece_id", pieceId);

  const { data, error } = await query.order("created_at", {
    ascending: false,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const piece = row.pieces as unknown as {
      name: string;
      composer: string | null;
      works: { name: string } | null;
    } | null;
    const task = row.practice_tasks as unknown as {
      text: string;
      piece_sections: { label: string } | null;
    } | null;
    return {
      id: row.id as string,
      taskId: row.task_id,
      pieceId: row.piece_id,
      audioPath: row.audio_path as string,
      durationSeconds: row.duration_seconds ?? 0,
      trimStartSeconds: row.trim_start,
      trimEndSeconds: row.trim_end,
      audioTitle: row.title,
      date: row.date,
      createdAt: row.created_at,
      pieceName: piece?.name ?? null,
      pieceComposer: piece?.composer ?? null,
      workName: piece?.works?.name ?? null,
      sectionLabel: task?.piece_sections?.label ?? null,
      taskText: task?.text ?? null,
    };
  });
}
