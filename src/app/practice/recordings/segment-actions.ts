"use server";

import { createClient } from "@/lib/supabase/server";

const BUCKET = "task-audio";

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
