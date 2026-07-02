import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlignmentSpan, PracticeRecordingAlignment } from "@/lib/types";

// Apply the segment worker's callback to its practice_recordings row (plan
// U5/KTD8). Unlike the session apply path, the audio object is NEVER touched
// — success, transcription failure, and infra failure all keep the recording,
// and any non-ready outcome stays reprocessable (R9).

const SESSION_MIDI_BUCKET = "practice-session-midi";

/** The segment-mode callback body (services/practice-alignment/job.py,
 * `_run_segment`), minus the shared envelope (ok/secret/recordingId).
 * `ok: false` covers infra failures only; a transcription failure arrives as
 * ok:true + transcriptionError with the alignment still present. */
export type SegmentWorkerResult = {
  spans?: AlignmentSpan[];
  totalMeasures?: number;
  transcriptionMidiB64?: string | null;
  transcriptionError?: string | null;
};

/**
 * Store the transcription MIDI (when present) at
 * {uid}/recordings/{recordingId}.mid, write the alignment jsonb (empty spans /
 * totalMeasures 0 = "no alignment", rendered as simple absence — R8), and
 * settle the row's status. A missing transcription lands the row 'failed'
 * (with the worker's transcriptionError) so the reprocess affordance shows,
 * while still keeping whatever alignment came back.
 *
 * Only an in-flight row accepts the result: a stale/duplicate callback for a
 * row that already settled (or was reset for reprocessing) returns "stale"
 * and writes nothing.
 */
export async function applySegmentResult(
  supabase: SupabaseClient,
  recordingId: string,
  result: SegmentWorkerResult
): Promise<"ready" | "failed" | "stale"> {
  const { data: rec } = await supabase
    .from("practice_recordings")
    .select("id, audio_path")
    .eq("id", recordingId)
    .single();
  if (!rec) throw new Error("Recording not found");

  let transcriptionPath: string | null = null;
  if (result.transcriptionMidiB64) {
    // Path convention (00160) keys off the owner's uid, which prefixes the
    // audio path ({uid}/recordings/{id}.{ext}).
    const uid = rec.audio_path?.split("/")[0];
    if (!uid) throw new Error("Recording has no audio path to derive owner from");
    const midiBytes = Buffer.from(result.transcriptionMidiB64, "base64");
    const path = `${uid}/recordings/${recordingId}.mid`;
    const { error: upErr } = await supabase.storage
      .from(SESSION_MIDI_BUCKET)
      .upload(path, midiBytes, { contentType: "audio/midi", upsert: true });
    // A failed MIDI store throws so the callback marks the row failed and a
    // reprocess can retry; the audio is untouched either way (KTD8).
    if (upErr) throw new Error(`MIDI store failed: ${upErr.message}`);
    transcriptionPath = path;
  }

  const alignment: PracticeRecordingAlignment = {
    spans: result.spans ?? [],
    totalMeasures: result.totalMeasures ?? 0,
  };

  // Settle the row — guarded to 'processing' so only an in-flight row accepts
  // the result. kickoffSegmentProcessing awaits the claim_practice_recording
  // RPC (its own committed request) BEFORE posting the worker job, so every
  // legitimate callback — even from a synchronous local dev worker — finds
  // 'processing'; anything else is stale and must not overwrite a settled row.
  const transcribed = Boolean(result.transcriptionMidiB64);
  const { data: settled } = await supabase
    .from("practice_recordings")
    .update(
      transcribed
        ? {
            status: "ready",
            error_message: null,
            alignment,
            transcription_path: transcriptionPath,
          }
        : {
            status: "failed",
            error_message: String(
              result.transcriptionError ?? "Transcription failed"
            ).slice(0, 500),
            alignment,
          }
    )
    .eq("id", recordingId)
    .eq("status", "processing")
    .select("id");
  if (!settled?.length) {
    console.warn(`[callback] stale segment result for ${recordingId}; ignored`);
    return "stale";
  }

  return transcribed ? "ready" : "failed";
}
