"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "task-audio";
const MIDI_BUCKET = "practice-session-midi";

/**
 * Create the practice_recordings row for an auto-captured timer segment and
 * hand back a signed upload URL (plan U4/KTD6). The row is born at status
 * 'recorded' — the blob still lives only in the client's IndexedDB buffer —
 * and a successful upload flips it to 'uploaded' via markSegmentUploaded.
 *
 * `pieceId` comes from the timer's ActiveTaskMeta and can be null on legacy
 * restores; fall back to the task's own piece_id server-side.
 *
 * Path convention (00160): {uid}/recordings/{recordingId}.{ext}
 */
export async function createSegmentRecording(
  taskId: string,
  pieceId: string | null,
  ext: string
): Promise<{ recordingId: string; path: string; token: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // The segment belongs on the task's date (which may not be today — e.g.
  // finishing yesterday's plan after midnight). Missing task/date falls back
  // to the column default (CURRENT_DATE).
  const { data: task } = await supabase
    .from("practice_tasks")
    .select("date, piece_id")
    .eq("id", taskId)
    .maybeSingle();

  const recordingId = crypto.randomUUID();
  const safeExt = (ext.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "m4a").toLowerCase();
  const path = `${user.id}/recordings/${recordingId}.${safeExt}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create upload URL");
  }

  const { error: insErr } = await supabase.from("practice_recordings").insert({
    id: recordingId,
    kind: "auto",
    task_id: taskId,
    piece_id: pieceId ?? task?.piece_id ?? null,
    audio_path: path,
    status: "recorded",
    ...(task?.date ? { date: task.date } : {}),
  });
  if (insErr) throw new Error(insErr.message);

  return { recordingId, path, token: data.token };
}

/**
 * Flip a segment 'recorded' -> 'uploaded' once its audio object exists. The
 * status guard makes this a no-op for any other state, so a stale client
 * can't drag a row backwards out of processing/ready.
 */
export async function markSegmentUploaded(
  recordingId: string,
  durationSeconds: number
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("practice_recordings")
    .update({
      status: "uploaded",
      duration_seconds: Math.max(0, Math.round(durationSeconds)),
    })
    .eq("id", recordingId)
    .eq("status", "recorded");
  if (error) throw new Error(error.message);
}

/**
 * Delete a recording: storage objects first (audio in task-audio, transcribed
 * MIDI in practice-session-midi when present), then the row (plan U6).
 *
 * This is the ONLY delete path for practice_recordings and it is only ever
 * invoked by explicit user actions — the task-row menu, the Recordings tab
 * (via deleteRecording), and the audio dialog's re-record replacement (via
 * attachRecording). The processing pipeline never deletes rows or audio
 * (KTD8).
 */
export async function deleteSegment(
  recordingId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: rec, error: loadError } = await supabase
    .from("practice_recordings")
    .select("id, audio_path, transcription_path")
    .eq("id", recordingId)
    .maybeSingle();
  if (loadError) return { ok: false, error: loadError.message };
  if (!rec) return { ok: false, error: "Recording not found" };

  const row = rec as {
    id: string;
    audio_path: string | null;
    transcription_path: string | null;
  };

  // Storage objects go first so a failure never leaves orphaned objects
  // behind a deleted row. remove() tolerates already-missing objects, but a
  // hard storage error aborts before the row delete.
  if (row.audio_path) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .remove([row.audio_path]);
    if (error) return { ok: false, error: error.message };
  }
  if (row.transcription_path) {
    const { error } = await supabase.storage
      .from(MIDI_BUCKET)
      .remove([row.transcription_path]);
    if (error) return { ok: false, error: error.message };
  }

  const { error: deleteError } = await supabase
    .from("practice_recordings")
    .delete()
    .eq("id", recordingId);
  if (deleteError) return { ok: false, error: deleteError.message };

  revalidatePath("/practice");
  return { ok: true };
}

/**
 * Signed URL that triggers a browser download (Content-Disposition:
 * attachment) for a recording's audio object.
 */
export async function createSignedSegmentDownloadUrl(
  audioPath: string
): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(audioPath, 60 * 60, { download: true });
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create signed download URL");
  }
  return data.signedUrl;
}
