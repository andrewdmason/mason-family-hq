"use server";

import { createClient } from "@/lib/supabase/server";

export type Recording = {
  taskId: string;
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
  taskText: string;
};

export async function getRecordings(pieceId?: string): Promise<Recording[]> {
  const supabase = await createClient();

  let query = supabase
    .from("practice_tasks")
    .select(
      "id, date, text, audio_path, audio_duration_seconds, audio_trim_start_seconds, audio_trim_end_seconds, audio_title, created_at, pieces(name, composer, works(name)), piece_sections(label)"
    )
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
    const section = row.piece_sections as unknown as {
      label: string;
    } | null;
    return {
      taskId: row.id,
      audioPath: row.audio_path as string,
      durationSeconds: row.audio_duration_seconds ?? 0,
      trimStartSeconds: row.audio_trim_start_seconds,
      trimEndSeconds: row.audio_trim_end_seconds,
      audioTitle: row.audio_title,
      date: row.date,
      createdAt: row.created_at,
      pieceName: piece?.name ?? null,
      pieceComposer: piece?.composer ?? null,
      workName: piece?.works?.name ?? null,
      sectionLabel: section?.label ?? null,
      taskText: row.text,
    };
  });
}
