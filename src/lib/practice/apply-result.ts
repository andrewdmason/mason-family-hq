import type { SupabaseClient } from "@supabase/supabase-js";
import type { PracticeAlignmentResult } from "@/lib/types";

// Apply the worker's callback to an open session (plan U8). Two job shapes
// arrive here, distinguished by the result body:
//
// - transcription-only (initial processing: mode "segment", no references):
//   { transcriptionMidiB64?, transcriptionError?, spans: [], totalMeasures: 0 }
//   Stores the MIDI and settles `status` — ready, or failed with the audio
//   kept and the session reprocessable (R14/R15: no recognition, no log
//   writes — AE6).
//
// - recognition (the on-demand "link to pieces" job: mode absent):
//   full PracticeAlignmentResult (+ transcription). Stores result.segments as
//   linking PROPOSALS and settles `link_status`; it never writes tasks — only
//   explicit acceptance does (KTD9, see link-actions.ts).
//
// The audio object and recording_path are NEVER touched on any path (KTD8).

const SESSION_MIDI_BUCKET = "practice-session-midi";

export type WorkerResult = Partial<PracticeAlignmentResult> & {
  transcriptionMidiB64?: string | null;
  transcriptionError?: string | null;
  /** Present (empty) on transcription-only results; ignored for sessions. */
  spans?: unknown;
  totalMeasures?: number;
};

export async function applySessionResult(
  supabase: SupabaseClient,
  sessionId: string,
  result: WorkerResult
): Promise<"ready" | "failed" | "linked" | "stale"> {
  const { data: session } = await supabase
    .from("practice_sessions")
    .select("id, recording_path")
    .eq("id", sessionId)
    .single();
  if (!session) throw new Error("Session not found");

  // Store the transcribed performance MIDI. recording_path stays put (audio
  // is kept — KTD8), so the MIDI path is stable across reprocesses/re-links.
  let transcriptionPath: string | null = null;
  if (result.transcriptionMidiB64 && session.recording_path) {
    const midiBytes = Buffer.from(result.transcriptionMidiB64, "base64");
    const path = session.recording_path.replace(/\.[^./]+$/, ".mid");
    const { error: upErr } = await supabase.storage
      .from(SESSION_MIDI_BUCKET)
      .upload(path, midiBytes, { contentType: "audio/midi", upsert: true });
    // Throw so the callback routes the failure (markSessionFailed) and a
    // retry can re-store; the audio is untouched either way.
    if (upErr) throw new Error(`MIDI store failed: ${upErr.message}`);
    transcriptionPath = path;
  }

  // Recognition-shaped result = the link job: segments become proposals.
  if (Array.isArray(result.segments)) {
    // The callback spreads its whole POST body in here, so pick ONLY the
    // recognition payload — spreading `result` would persist the envelope
    // (secret, ok, sessionId, transcription blobs) into the jsonb column.
    // NOTE: rows written before this fix may carry the leaked WORKER_SECRET
    // in `result`; cleaning those rows and rotating the secret is a deploy
    // note (deliberately not a migration here).
    const storedResult: PracticeAlignmentResult = {
      segments: result.segments,
      confidence: result.confidence ?? 0,
      windows: result.windows ?? [],
    };
    // Guarded to link_status='linking' (the lease kickoffSessionProcessing
    // takes, committed before the worker POST) so a stale link callback can't
    // overwrite a session that already settled or re-leased.
    const { data: linked } = await supabase
      .from("practice_sessions")
      .update({
        status: "ready",
        confidence: result.confidence ?? null,
        result: storedResult,
        audio_retained: true,
        link_status: "linked",
        link_error: null,
        ...(transcriptionPath ? { transcription_path: transcriptionPath } : {}),
      })
      .eq("id", sessionId)
      .eq("link_status", "linking")
      .select("id");
    if (!linked?.length) {
      console.warn(`[callback] stale link result for session ${sessionId}; ignored`);
      return "stale";
    }
    return "linked";
  }

  // Transcription-only result: settle the session's own status machine. A
  // missing MIDI lands 'failed' (audio kept, reprocessable — the regression
  // fix for the old delete-on-failed-transcription behavior). Guarded to
  // 'processing' — kickoffSessionProcessing awaits the claim_practice_session
  // RPC (its own committed request) before posting the job, so a legitimate
  // callback always finds 'processing'; anything else is stale.
  const transcribed = Boolean(result.transcriptionMidiB64);
  const { data: settled } = await supabase
    .from("practice_sessions")
    .update(
      transcribed
        ? {
            status: "ready",
            error_message: null,
            audio_retained: true,
            transcription_path: transcriptionPath,
          }
        : {
            status: "failed",
            error_message: String(
              result.transcriptionError ?? "Transcription failed"
            ).slice(0, 500),
            audio_retained: true,
          }
    )
    .eq("id", sessionId)
    .eq("status", "processing")
    .select("id");
  if (!settled?.length) {
    console.warn(
      `[callback] stale transcription result for session ${sessionId}; ignored`
    );
    return "stale";
  }
  return transcribed ? "ready" : "failed";
}

/**
 * Route a worker/apply failure to the right state machine: while a link job
 * is in flight (link_status='linking') the failure lands on
 * link_status/link_error and leaves the session's own status alone (the
 * session stays ready and playable — a failed link shows quietly with retry);
 * anything else is the initial transcription job failing. Audio untouched.
 */
export async function markSessionFailed(
  supabase: SupabaseClient,
  sessionId: string,
  message: string
): Promise<void> {
  const clipped = message.slice(0, 500);
  const { data: session } = await supabase
    .from("practice_sessions")
    .select("link_status")
    .eq("id", sessionId)
    .maybeSingle();
  if (session?.link_status === "linking") {
    await supabase
      .from("practice_sessions")
      .update({ link_status: "failed", link_error: clipped })
      .eq("id", sessionId);
  } else {
    await supabase
      .from("practice_sessions")
      .update({ status: "failed", error_message: clipped })
      .eq("id", sessionId);
  }
}
