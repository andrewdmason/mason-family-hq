"use server";

import { createClient } from "@/lib/supabase/server";

const BUCKET = "task-audio";

// The legacy single-slot write path (attachTaskAudio / updateTaskAudioTrim /
// updateTaskAudioTitle / deleteTaskAudio, upserting over {uid}/{taskId}.{ext})
// was removed in U7: recordings persist to practice_recordings via
// src/app/practice/recordings/recording-actions.ts, and the practice_tasks
// audio_* columns are frozen (KTD1) — readable, never written again.

export async function createSignedPlaybackUrl(
  audioPath: string
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(audioPath, 60 * 60);
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create signed playback URL");
  }
  return data.signedUrl;
}
