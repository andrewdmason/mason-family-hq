"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { deleteSegment } from "@/app/practice/recordings/segment-actions";
import {
  createAudioUploadToken,
  safeAudioExt,
} from "@/lib/practice/storage";
import { localDate, getUserTimezone } from "@/lib/date-utils";
import type { PracticeRecordingKind, TaskRecordingDisplay } from "@/lib/types";

/**
 * Columns handed back to dialog callers after a save — the day-view display
 * slice plus the associations/date the Recordings tab needs to build its own
 * optimistic row.
 */
export type SavedRecording = TaskRecordingDisplay & {
  task_id: string | null;
  piece_id: string | null;
  date: string;
};

const SAVED_COLUMNS =
  "id, kind, status, audio_path, transcription_path, duration_seconds, trim_start, trim_end, title, error_message, created_at, alignment, task_id, piece_id, date";

/**
 * Mint a per-recording upload target for a deliberate (manual/performance)
 * take: a fresh recording id and a signed URL at the 00160 path convention
 * {uid}/recordings/{recordingId}.{ext}.
 *
 * Deliberately does NOT insert a practice_recordings row yet. Unlike auto
 * segments (which are born at 'recorded' so the sweep can rescue a crashed
 * upload), manual takes are foreground: the dialog uploads and then calls
 * attachRecording, which inserts the row directly at 'ready' (kind != 'auto'
 * is invisible to the sweep, so a dead 'recorded' row would linger forever as
 * a phantom "uploading…" line). An abandoned upload leaves at worst an
 * orphaned audio object — invisible everywhere and harmless.
 */
export async function createRecordingUpload(
  ext: string
): Promise<{ recordingId: string; path: string; token: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const recordingId = crypto.randomUUID();
  const path = `${user.id}/recordings/${recordingId}.${safeAudioExt(ext)}`;
  const token = await createAudioUploadToken(supabase, path);
  return { recordingId, path, token };
}

/**
 * Insert the practice_recordings row for an uploaded manual/performance take,
 * directly at status 'ready' (U5: only kind='auto' goes through the segment
 * status machine; the sweep never touches these).
 *
 * `replaceRecordingId` implements the dialog's re-record semantics: the
 * take being edited is superseded, so its row and storage objects are removed
 * once the new row is safely inserted (new-first ordering — a failure can
 * never lose the old take). The new row inherits the replaced row's kind so
 * re-recording a backfilled performance stays a performance even when the
 * dialog was opened from a task row.
 */
export async function attachRecording(input: {
  recordingId: string;
  kind: Extract<PracticeRecordingKind, "manual" | "performance">;
  taskId: string | null;
  pieceId: string | null;
  audioPath: string;
  durationSeconds: number;
  trimStartSeconds: number | null;
  trimEndSeconds: number | null;
  title: string | null;
  replaceRecordingId?: string | null;
}): Promise<SavedRecording> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Only accept paths createRecordingUpload mints ({uid}/recordings/…) — the
  // path comes back through the client, and an arbitrary value would let a
  // row point at someone else's storage object.
  if (!input.audioPath.startsWith(`${user.id}/recordings/`)) {
    throw new Error("Invalid audio path for this user");
  }

  // Task-linked takes belong on the task's date (which may not be today) and
  // fall back to the task's piece when the caller didn't know it.
  let taskDate: string | null = null;
  let taskPieceId: string | null = null;
  if (input.taskId) {
    const { data: task } = await supabase
      .from("practice_tasks")
      .select("date, piece_id")
      .eq("id", input.taskId)
      .maybeSingle();
    taskDate = (task?.date as string | null) ?? null;
    taskPieceId = (task?.piece_id as string | null) ?? null;
  }

  let kind: PracticeRecordingKind = input.kind;
  if (input.replaceRecordingId) {
    const { data: old } = await supabase
      .from("practice_recordings")
      .select("kind")
      .eq("id", input.replaceRecordingId)
      .maybeSingle();
    if (old?.kind === "manual" || old?.kind === "performance") {
      kind = old.kind;
    }
  }

  const { data, error } = await supabase
    .from("practice_recordings")
    .insert({
      id: input.recordingId,
      kind,
      task_id: input.taskId,
      piece_id: input.pieceId ?? taskPieceId,
      audio_path: input.audioPath,
      duration_seconds: Math.max(0, Math.round(input.durationSeconds)),
      trim_start: input.trimStartSeconds,
      trim_end: input.trimEndSeconds,
      title: input.title,
      status: "ready",
      // Task-less takes (tab performances) get the user's local "today" — the
      // column default is CURRENT_DATE, which is UTC on Vercel and rolls over
      // mid-evening. Same convention as task creation (task-actions.ts).
      date: taskDate ?? localDate(new Date(), await getUserTimezone()),
    })
    .select(SAVED_COLUMNS)
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to save recording");
  }

  // Best-effort cleanup of the superseded take. The new row is already saved,
  // so a cleanup failure must not surface as a save error; at worst the old
  // row reappears on refresh and can be deleted by hand.
  if (input.replaceRecordingId) {
    await deleteSegment(input.replaceRecordingId);
  }

  revalidatePath("/practice");
  revalidatePath("/practice/recordings");
  return data as unknown as SavedRecording;
}

export async function updateRecordingTrim(
  recordingId: string,
  trimStartSeconds: number | null,
  trimEndSeconds: number | null
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("practice_recordings")
    .update({ trim_start: trimStartSeconds, trim_end: trimEndSeconds })
    .eq("id", recordingId);
  if (error) throw new Error(error.message);
  revalidatePath("/practice");
  revalidatePath("/practice/recordings");
}

export async function updateRecordingTitle(
  recordingId: string,
  title: string | null
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("practice_recordings")
    .update({ title })
    .eq("id", recordingId);
  if (error) throw new Error(error.message);
  revalidatePath("/practice");
  revalidatePath("/practice/recordings");
}

/**
 * Explicit user deletion of a recording (row + audio object + transcription
 * object). Delegates to deleteSegment — the single delete path for
 * practice_recordings — and additionally revalidates the Recordings tab.
 */
export async function deleteRecording(
  recordingId: string
): Promise<{ ok: boolean; error?: string }> {
  const result = await deleteSegment(recordingId);
  if (result.ok) revalidatePath("/practice/recordings");
  return result;
}
