import type { SupabaseClient } from "@supabase/supabase-js";

// Open-session processing kickoff (plan U8) — the session sibling of
// segment-kickoff.ts. Two jobs share this path, selected by opts.link:
//
// - default (initial processing / reprocess): TRANSCRIPTION-ONLY — worker
//   mode "segment" with NO references, so no recognition runs and nothing can
//   touch the log (R15/AE6). Claimed via the claim_practice_session lease
//   (uploaded -> processing, 00144).
//
// - link: true (the explicit "link to pieces" action, F4/R16): full session
//   recognition — mode absent, every ready reference supplied. Leased via a
//   guarded link_status update ('linking' can't be re-entered; the column is
//   NOT NULL, 00161, so .neq works), leaving the session's own status machine
//   alone. The callback stores result.segments as proposals; acceptance is a
//   separate, explicit step.
//
// Shared by the process route and the reprocess server action so both behave
// identically. Audio is never deleted on any path (KTD8).

const RECORDING_BUCKET = "task-audio";
const MIDI_BUCKET = "piece-midi";
const SIGNED_URL_TTL_SECONDS = 1800;

export type SessionKickoffOutcome =
  /** Claimed and handed to the worker; the callback will land the result. */
  | { status: "processing" }
  /** Another kickoff holds the lease, or the session isn't in a startable state. */
  | { status: "already_processing" }
  /** Kickoff error — recorded on the session (status or link_status), retryable. */
  | { status: "failed"; error: string };

export async function kickoffSessionProcessing(
  supabase: SupabaseClient,
  sessionId: string,
  callbackUrl: string,
  opts: { link?: boolean } = {}
): Promise<SessionKickoffOutcome> {
  const link = !!opts.link;

  if (link) {
    // Link lease: only a ready session can link, and 'linking' blocks
    // re-entry. (Single guarded UPDATE — no .or() on a mutation, see memory.)
    const { data: leased, error: leaseErr } = await supabase
      .from("practice_sessions")
      .update({ link_status: "linking", link_error: null })
      .eq("id", sessionId)
      .eq("status", "ready")
      .neq("link_status", "linking")
      .select("id");
    if (leaseErr) return { status: "failed", error: leaseErr.message };
    if (!leased?.length) return { status: "already_processing" };
  } else {
    const { data: won, error: claimErr } = await supabase.rpc(
      "claim_practice_session",
      { p_session_id: sessionId }
    );
    if (claimErr) return { status: "failed", error: claimErr.message };
    if (!won) return { status: "already_processing" };
  }

  try {
    const { data: session } = await supabase
      .from("practice_sessions")
      .select("recording_path")
      .eq("id", sessionId)
      .single();
    if (!session?.recording_path) {
      // Pre-U8 sessions had their audio deleted after processing; those can
      // never link or reprocess. The UI hides the affordances, but guard anyway.
      throw new Error("Session has no recording (audio was not retained)");
    }

    const { data: recSigned, error: recErr } = await supabase.storage
      .from(RECORDING_BUCKET)
      .createSignedUrl(session.recording_path, SIGNED_URL_TTL_SECONDS);
    if (recErr || !recSigned) {
      throw new Error(recErr?.message ?? "Could not sign recording URL");
    }

    // Link jobs recognize against every ready reference; initial processing
    // supplies none (transcription-only).
    const references: { pieceId: string; midiUrl: string }[] = [];
    if (link) {
      const { data: refRows } = await supabase
        .from("practice_reference_midis")
        .select("piece_id, midi_path")
        .eq("status", "ready");
      for (const r of (refRows ?? []) as { piece_id: string; midi_path: string }[]) {
        const { data: signed } = await supabase.storage
          .from(MIDI_BUCKET)
          .createSignedUrl(r.midi_path, SIGNED_URL_TTL_SECONDS);
        if (signed) {
          references.push({ pieceId: r.piece_id, midiUrl: signed.signedUrl });
        }
      }
    }

    const workerUrl = process.env.PRACTICE_WORKER_URL;
    if (!workerUrl) throw new Error("PRACTICE_WORKER_URL not configured");

    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        // mode absent = the worker's full session recognition pipeline.
        ...(link ? {} : { mode: "segment" }),
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
    if (link) {
      await supabase
        .from("practice_sessions")
        .update({ link_status: "failed", link_error: message.slice(0, 500) })
        .eq("id", sessionId);
    } else {
      await supabase
        .from("practice_sessions")
        .update({ status: "failed", error_message: message.slice(0, 500) })
        .eq("id", sessionId);
    }
    return { status: "failed", error: message };
  }
}
