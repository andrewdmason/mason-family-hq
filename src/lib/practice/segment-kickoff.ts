import type { SupabaseClient } from "@supabase/supabase-js";

// Segment processing kickoff (plan U5/KTD4/KTD6): claim the row's lease, sign
// its audio plus AT MOST the one reference MIDI of its own piece (known-piece
// alignment — no library-wide recognition), and hand the job to the worker in
// mode "segment". Shared by the process route (client kickoff after upload)
// and the sweep/reprocess server actions, so all three paths behave
// identically. The claim_practice_recording lease (00160) makes concurrent
// kickoffs collapse to one worker job.

const RECORDING_BUCKET = "task-audio";
const MIDI_BUCKET = "piece-midi";
const SIGNED_URL_TTL_SECONDS = 1800;

/** Heard audio shorter than this skips the worker entirely (KTD6 — the worker
 * has a ~2-minute cost floor). The audio is kept; status becomes 'skipped'
 * and the row stays reprocessable (reprocess bypasses this check). */
export const MIN_PROCESSABLE_SECONDS = 20;

export type SegmentKickoffOutcome =
  /** Claimed and handed to the worker; the callback will land the result. */
  | { status: "processing" }
  /** Too short to be worth a worker job; audio kept (KTD8). */
  | { status: "skipped" }
  /** Another kickoff already holds the lease (or the row isn't 'uploaded'). */
  | { status: "already_processing" }
  /** Kickoff error — the row is marked failed + error_message, reprocessable. */
  | { status: "failed"; error: string };

export async function kickoffSegmentProcessing(
  supabase: SupabaseClient,
  recordingId: string,
  callbackUrl: string,
  opts: { skipShortCheck?: boolean } = {}
): Promise<SegmentKickoffOutcome> {
  const { data: won, error: claimErr } = await supabase.rpc(
    "claim_practice_recording",
    { p_recording_id: recordingId }
  );
  if (claimErr) return { status: "failed", error: claimErr.message };
  if (!won) return { status: "already_processing" };

  try {
    const { data: rec } = await supabase
      .from("practice_recordings")
      .select("audio_path, piece_id, duration_seconds")
      .eq("id", recordingId)
      .single();
    if (!rec?.audio_path) throw new Error("Recording has no audio");

    if (
      !opts.skipShortCheck &&
      rec.duration_seconds != null &&
      rec.duration_seconds < MIN_PROCESSABLE_SECONDS
    ) {
      await supabase
        .from("practice_recordings")
        .update({ status: "skipped", error_message: null })
        .eq("id", recordingId)
        .eq("status", "processing");
      return { status: "skipped" };
    }

    const { data: recSigned, error: recErr } = await supabase.storage
      .from(RECORDING_BUCKET)
      .createSignedUrl(rec.audio_path, SIGNED_URL_TTL_SECONDS);
    if (recErr || !recSigned) {
      throw new Error(recErr?.message ?? "Could not sign recording URL");
    }

    // Exactly the segment's own piece's reference, and only when ready. No
    // reference = transcription-only job (spans come back empty — R8).
    const references: { pieceId: string; midiUrl: string }[] = [];
    if (rec.piece_id) {
      const { data: ref } = await supabase
        .from("practice_reference_midis")
        .select("piece_id, midi_path")
        .eq("piece_id", rec.piece_id)
        .eq("status", "ready")
        .maybeSingle();
      if (ref?.midi_path) {
        const { data: signed } = await supabase.storage
          .from(MIDI_BUCKET)
          .createSignedUrl(ref.midi_path, SIGNED_URL_TTL_SECONDS);
        if (signed) {
          references.push({ pieceId: ref.piece_id, midiUrl: signed.signedUrl });
        }
      }
    }

    const workerUrl = process.env.PRACTICE_WORKER_URL;
    if (!workerUrl) throw new Error("PRACTICE_WORKER_URL not configured");

    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recordingId,
        mode: "segment",
        recordingUrl: recSigned.signedUrl,
        references,
        callbackUrl,
        secret: process.env.WORKER_SECRET,
      }),
    });
    if (!res.ok) {
      throw new Error(`Worker kickoff ${res.status}: ${await res.text()}`);
    }

    return { status: "processing" };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to start processing";
    // Audio and row stay put (KTD8); 'failed' keeps the row reprocessable.
    await supabase
      .from("practice_recordings")
      .update({ status: "failed", error_message: message.slice(0, 500) })
      .eq("id", recordingId);
    return { status: "failed", error: message };
  }
}
