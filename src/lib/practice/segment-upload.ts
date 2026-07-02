// Client-side segment upload + kickoff, shared by the capture controller's
// segment finalization (U4) and the recovery sweep's re-uploads (U5/KTD6).
// Everything degrades to a quiet console.warn — the row/buffer combination
// lets the sweep recover any stuck state, and nothing here may ever block or
// break the timer (R17).

import { createClient } from "@/lib/supabase/client";
import { supportedContentType } from "@/lib/practice/capture";
import { markSegmentUploaded } from "@/app/practice/recordings/segment-actions";
import { deleteSegment } from "@/lib/practice/segment-buffer";

const BUCKET = "task-audio";
const UPLOAD_ATTEMPTS = 3;
const UPLOAD_RETRY_BASE_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded-retry upload of a segment blob to its signed URL. */
async function uploadSegmentBlob(
  path: string,
  token: string,
  blob: Blob,
  ext: string
): Promise<boolean> {
  // The SDK ignores the contentType option for Blob bodies and uses the
  // blob's own .type, so re-wrap with a bucket-supported type.
  const contentType = supportedContentType(blob.type, ext);
  const upload =
    blob.type === contentType ? blob : new Blob([blob], { type: contentType });
  const supabase = createClient();

  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt++) {
    try {
      const { error } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(path, token, upload, { upsert: true });
      if (!error) return true;
      throw new Error(error.message);
    } catch (err) {
      if (attempt === UPLOAD_ATTEMPTS - 1) {
        console.warn(
          "[capture] segment upload failed; row stays 'recorded', buffer kept for the sweep",
          err
        );
        return false;
      }
      await sleep(UPLOAD_RETRY_BASE_MS * 2 ** attempt);
    }
  }
  return false;
}

/** Processing kickoff for an 'uploaded' segment. keepalive lets the POST
 * survive a tab close right after stop; any failure just leaves the row
 * 'uploaded' for the sweep to re-kick (the lease makes duplicates safe). */
export async function kickoffSegment(recordingId: string): Promise<void> {
  try {
    const res = await fetch("/practice/session/api/process", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recordingId }),
    });
    if (!res.ok) {
      console.warn(`[capture] kickoff responded ${res.status}; sweep will re-kick`);
    }
  } catch (err) {
    console.warn("[capture] kickoff failed; sweep will re-kick", err);
  }
}

/**
 * Upload a buffered blob for an existing 'recorded' row, flip it to
 * 'uploaded', clear the IndexedDB buffer entry, and kick off processing.
 * Returns whether the upload+mark confirmed (kickoff is always best-effort —
 * the sweep re-kicks 'uploaded' rows without needing the blob).
 */
export async function finishSegmentUpload(opts: {
  recordingId: string;
  path: string;
  token: string;
  blob: Blob;
  ext: string;
  durationSeconds: number;
  /** IndexedDB buffer key to clear once the upload confirms (null = none). */
  bufferId: string | null;
}): Promise<boolean> {
  const uploaded = await uploadSegmentBlob(
    opts.path,
    opts.token,
    opts.blob,
    opts.ext
  );
  if (!uploaded) return false;

  try {
    await markSegmentUploaded(opts.recordingId, opts.durationSeconds);
  } catch (err) {
    console.warn(
      "[capture] markSegmentUploaded failed; buffer kept, sweep re-uploads",
      err
    );
    return false;
  }

  // The upload is confirmed — the buffer has done its job. The sweep re-kicks
  // 'uploaded' rows without needing the blob.
  if (opts.bufferId) {
    try {
      await deleteSegment(opts.bufferId);
    } catch {
      /* ignore */
    }
  }

  await kickoffSegment(opts.recordingId);
  return true;
}
