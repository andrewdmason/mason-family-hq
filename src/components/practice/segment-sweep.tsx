"use client";

// Opportunistic segment recovery on practice-page load (plan U5/KTD6).
// Mounted beside the CaptureController in the practice layout; renders
// nothing. On mount (throttled per tab) it:
//   (a) reconciles the IndexedDB buffer: re-uploads blobs whose rows are
//       still 'recorded' (including recreating rows that never got created),
//       prunes entries whose rows moved on or vanished;
//   (b) calls sweepStuckSegments() so the server re-kicks stuck 'uploaded'
//       rows, watchdog-fails dead 'processing' rows, and ages out abandoned
//       'recorded' rows this client holds no blob for.
// Best-effort throughout — a sweep failure must never surface (R17).

import { useEffect } from "react";
import { createSegmentRecording } from "@/app/practice/recordings/segment-actions";
import {
  createSegmentUploadUrl,
  getSegmentStatuses,
  sweepStuckSegments,
} from "@/app/practice/recordings/sweep-actions";
import { finishSegmentUpload } from "@/lib/practice/segment-upload";
import {
  deleteSegment,
  listSegments,
  putSegment,
  type BufferedSegment,
} from "@/lib/practice/segment-buffer";
import type { PracticeRecordingStatus } from "@/lib/types";

/** Layout remounts (nav away and back) shouldn't re-sweep constantly. */
const SWEEP_THROTTLE_MS = 60_000;
let lastSweepAt = 0;
let sweepInFlight = false;

/** Re-upload one buffered blob. Rows that never got created (row-creation
 * failed at capture time) are created now; rows still at 'recorded' get a
 * fresh signed URL for their existing path. */
async function recoverBufferedSegment(seg: BufferedSegment): Promise<void> {
  if (!seg.recordingId) {
    if (!seg.taskId) {
      // Auto segments always carry a task; a task-less orphan is unrecoverable.
      await deleteSegment(seg.id);
      return;
    }
    const { recordingId, path, token } = await createSegmentRecording(
      seg.taskId,
      seg.pieceId,
      seg.ext
    );
    try {
      await putSegment({ ...seg, recordingId });
    } catch {
      /* best-effort */
    }
    await finishSegmentUpload({
      recordingId,
      path,
      token,
      blob: seg.blob,
      ext: seg.ext,
      durationSeconds: seg.durationSeconds,
      bufferId: seg.id,
    });
    return;
  }

  const signed = await createSegmentUploadUrl(seg.recordingId);
  if (!signed) return; // row moved on between status check and now
  await finishSegmentUpload({
    recordingId: seg.recordingId,
    path: signed.path,
    token: signed.token,
    blob: seg.blob,
    ext: seg.ext,
    durationSeconds: seg.durationSeconds,
    bufferId: seg.id,
  });
}

async function runSweep(): Promise<void> {
  let buffered: BufferedSegment[] = [];
  try {
    buffered = await listSegments();
  } catch {
    buffered = []; // IndexedDB unavailable — server-side sweep still runs
  }

  const withRow = buffered.filter(
    (s): s is BufferedSegment & { recordingId: string } => s.recordingId != null
  );

  let statuses: Record<string, PracticeRecordingStatus | null> = {};
  let statusesKnown = false;
  if (withRow.length) {
    try {
      statuses = await getSegmentStatuses(withRow.map((s) => s.recordingId));
      statusesKnown = true;
    } catch (err) {
      console.warn("[sweep] status lookup failed", err);
    }
  }

  // Server sweep first, telling it every row we still hold a blob for so the
  // abandoned-'recorded' ager leaves them alone (we re-upload just below).
  try {
    await sweepStuckSegments(withRow.map((s) => s.recordingId));
  } catch (err) {
    console.warn("[sweep] server sweep failed", err);
  }

  for (const seg of buffered) {
    try {
      if (seg.recordingId) {
        if (!statusesKnown) continue; // can't tell — keep for the next sweep
        const status = statuses[seg.recordingId] ?? null;
        if (status !== "recorded") {
          // Row moved on (uploaded/processing/ready/failed/skipped) or is
          // gone — the buffer's job is done either way.
          await deleteSegment(seg.id);
          continue;
        }
      }
      await recoverBufferedSegment(seg);
    } catch (err) {
      console.warn("[sweep] buffered segment recovery failed", err);
    }
  }
}

export function SegmentSweep() {
  useEffect(() => {
    if (sweepInFlight || Date.now() - lastSweepAt < SWEEP_THROTTLE_MS) return;
    sweepInFlight = true;
    lastSweepAt = Date.now();
    void runSweep().finally(() => {
      sweepInFlight = false;
    });
  }, []);
  return null;
}
