"use server";

// Recovery sweep + reprocess for practice segments (plan U5/KTD6). Every
// stuck state a dead tab can leave behind is recoverable from here:
//   recorded   — blob only ever lived client-side; the SegmentSweep component
//                re-uploads from its IndexedDB buffer (createSegmentUploadUrl)
//                and passes the recordingIds it still holds blobs for, so
//                only truly abandoned rows (>10min, no surviving blob) fail.
//   uploaded   — kickoff was lost (tab closed before/at the POST); re-kick.
//                The claim lease makes duplicate kickoffs collapse to one job.
//   processing — worker never called back; watchdog-fail after 45min.
// Failed/skipped rows are reprocessable (reprocessSegment). Audio is never
// deleted on any of these paths (KTD8).

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  kickoffSegmentProcessing,
  type SegmentKickoffOutcome,
} from "@/lib/practice/segment-kickoff";
import { workerCallbackUrl } from "@/lib/practice/worker";
import type { PracticeRecordingStatus } from "@/lib/types";

/** 'uploaded' rows younger than this are presumed to have an in-flight
 * kickoff from their own tab; older ones get re-kicked. */
const STUCK_UPLOADED_MS = 2 * 60 * 1000;
/** 'recorded' rows older than this with no surviving client blob have lost
 * their audio for good — the upload never completed. */
const ABANDONED_RECORDED_MS = 10 * 60 * 1000;
/** 'processing' rows whose claim is older than this never got a callback. */
const PROCESSING_WATCHDOG_MS = 45 * 60 * 1000;

/**
 * Row statuses for the client sweep's buffer reconciliation. Missing rows map
 * to null so the client can prune buffer entries whose rows are gone.
 */
export async function getSegmentStatuses(
  recordingIds: string[]
): Promise<Record<string, PracticeRecordingStatus | null>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const out: Record<string, PracticeRecordingStatus | null> = {};
  if (!recordingIds.length) return out;
  for (const id of recordingIds) out[id] = null;

  // The buffer holds at most a handful of segments — no .in() size risk.
  const { data } = await supabase
    .from("practice_recordings")
    .select("id, status")
    .in("id", recordingIds);
  for (const row of (data ?? []) as { id: string; status: PracticeRecordingStatus }[]) {
    out[row.id] = row.status;
  }
  return out;
}

/**
 * Fresh signed upload URL for a row still stuck at 'recorded', so the client
 * sweep can re-upload its buffered blob to the row's existing path. Returns
 * null when the row has moved on (or isn't the caller's).
 */
export async function createSegmentUploadUrl(
  recordingId: string
): Promise<{ path: string; token: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: rec } = await supabase
    .from("practice_recordings")
    .select("audio_path, status")
    .eq("id", recordingId)
    .maybeSingle();
  if (!rec || rec.status !== "recorded" || !rec.audio_path) return null;
  // Path convention is {uid}/recordings/{id}.{ext}; only re-sign own objects.
  if (!rec.audio_path.startsWith(`${user.id}/`)) return null;

  const { data, error } = await supabase.storage
    .from("task-audio")
    .createSignedUploadUrl(rec.audio_path, { upsert: true });
  if (error || !data) return null;
  return { path: rec.audio_path, token: data.token };
}

export type SweepResult = {
  /** Stuck 'uploaded' rows re-entered into kickoff, with each outcome. */
  rekicked: { recordingId: string; outcome: SegmentKickoffOutcome }[];
  /** 'processing' rows watchdog-failed ("worker never called back"). */
  timedOut: string[];
  /** 'recorded' rows aged out ("upload never completed"). */
  abandoned: string[];
};

/**
 * Server-side sweep, called by the SegmentSweep component on practice-page
 * load. `bufferedRecordingIds` are rows the client still holds blobs for —
 * they're protected from the abandoned-'recorded' ager because a re-upload is
 * about to happen. Scoped to kind='auto' (the timer-segment pipeline).
 */
export async function sweepStuckSegments(
  bufferedRecordingIds: string[] = []
): Promise<SweepResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const result: SweepResult = { rekicked: [], timedOut: [], abandoned: [] };
  const now = Date.now();

  // 1) Stuck 'uploaded' rows: kickoff was lost. Re-kick via the shared path;
  // the lease makes racing a live kickoff harmless.
  const { data: stuckUploaded } = await supabase
    .from("practice_recordings")
    .select("id")
    .eq("kind", "auto")
    .eq("status", "uploaded")
    .lt("updated_at", new Date(now - STUCK_UPLOADED_MS).toISOString());
  if (stuckUploaded?.length) {
    const callbackUrl = await workerCallbackUrl();
    for (const row of stuckUploaded as { id: string }[]) {
      const outcome = await kickoffSegmentProcessing(supabase, row.id, callbackUrl);
      result.rekicked.push({ recordingId: row.id, outcome });
    }
  }

  // 2) Watchdog: claimed but the worker never called back.
  const { data: timedOut } = await supabase
    .from("practice_recordings")
    .update({ status: "failed", error_message: "worker never called back" })
    .eq("kind", "auto")
    .eq("status", "processing")
    .lt("claimed_at", new Date(now - PROCESSING_WATCHDOG_MS).toISOString())
    .select("id");
  result.timedOut = ((timedOut ?? []) as { id: string }[]).map((r) => r.id);

  // 3) Abandoned 'recorded' rows: old enough that the upload clearly never
  // completed, and this client holds no blob to retry with.
  let abandonedQuery = supabase
    .from("practice_recordings")
    .update({ status: "failed", error_message: "upload never completed" })
    .eq("kind", "auto")
    .eq("status", "recorded")
    .lt("created_at", new Date(now - ABANDONED_RECORDED_MS).toISOString());
  if (bufferedRecordingIds.length) {
    abandonedQuery = abandonedQuery.not(
      "id",
      "in",
      `(${bufferedRecordingIds.map((id) => `"${id}"`).join(",")})`
    );
  }
  const { data: abandoned } = await abandonedQuery.select("id");
  result.abandoned = ((abandoned ?? []) as { id: string }[]).map((r) => r.id);

  if (result.rekicked.length || result.timedOut.length || result.abandoned.length) {
    revalidatePath("/practice");
  }
  return result;
}

/**
 * Reprocess a 'failed' or 'skipped' segment (R9, U6's affordance): reset the
 * row to 'uploaded' (clearing the error and lease), then run the same kickoff
 * as a fresh upload. Bypasses the too-short skip — reprocessing a 'skipped'
 * row is an explicit "process it anyway".
 */
export async function reprocessSegment(
  recordingId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { data: reset, error } = await supabase
    .from("practice_recordings")
    .update({ status: "uploaded", error_message: null, claimed_at: null })
    .eq("id", recordingId)
    .in("status", ["failed", "skipped"])
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!reset?.length) {
    return { ok: false, error: "Recording is not in a reprocessable state" };
  }

  const outcome = await kickoffSegmentProcessing(
    supabase,
    recordingId,
    await workerCallbackUrl(),
    { skipShortCheck: true }
  );
  revalidatePath("/practice");
  if (outcome.status === "failed") return { ok: false, error: outcome.error };
  return { ok: true };
}
