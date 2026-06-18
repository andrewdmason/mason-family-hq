import type { SupabaseClient } from "@supabase/supabase-js";
import { writeSessionTasks } from "./autolog";
import type { PracticeAlignmentResult } from "@/lib/types";

const RECORDING_BUCKET = "task-audio";
const SESSION_MIDI_BUCKET = "practice-session-midi";

export type WorkerResult = PracticeAlignmentResult & {
  transcriptionMidiB64?: string | null;
};

/**
 * Apply the alignment worker's result to a session: write one task per recognized
 * piece, store the transcribed MIDI, delete the audio, and mark the session ready.
 * Shared by the async callback route (and reusable for any sync path).
 */
export async function applySessionResult(
  supabase: SupabaseClient,
  sessionId: string,
  result: WorkerResult
): Promise<number> {
  const { data: session } = await supabase
    .from("practice_sessions")
    .select("id, date, session_number, recording_path")
    .eq("id", sessionId)
    .single();
  if (!session) throw new Error("Session not found");

  const taskCount = await writeSessionTasks(supabase, sessionId, result, {
    date: session.date,
    sessionNumber: session.session_number,
  });

  // Store the transcribed performance MIDI, then ALWAYS delete the recording.
  let transcriptionPath: string | null = null;
  if (result.transcriptionMidiB64 && session.recording_path) {
    const midiBytes = Buffer.from(result.transcriptionMidiB64, "base64");
    const path = session.recording_path.replace(/\.(m4a|webm)$/, ".mid");
    const { error: upErr } = await supabase.storage
      .from(SESSION_MIDI_BUCKET)
      .upload(path, midiBytes, { contentType: "audio/midi", upsert: true });
    if (!upErr) transcriptionPath = path;
  }
  if (session.recording_path) {
    await supabase.storage.from(RECORDING_BUCKET).remove([session.recording_path]);
  }

  // Don't persist the base64 blob in the row — the MIDI lives in storage.
  const { transcriptionMidiB64: _omit, ...storedResult } = result;
  void _omit;

  await supabase
    .from("practice_sessions")
    .update({
      status: "ready",
      confidence: result.confidence,
      result: storedResult,
      audio_retained: false,
      recording_path: null,
      transcription_path: transcriptionPath,
    })
    .eq("id", sessionId);

  return taskCount;
}
