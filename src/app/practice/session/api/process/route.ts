import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const RECORDING_BUCKET = "task-audio";
const MIDI_BUCKET = "piece-midi";

/**
 * Kick off processing for a recorded session (async). Claims the session, signs
 * the recording + reference-MIDI URLs, and hands the job to the worker, which
 * processes in the background (minutes for long recordings) and POSTs the result
 * to the callback route. This returns immediately so nothing blocks on a long
 * Vercel function — the client polls the status route. (For local dev without an
 * async worker, point PRACTICE_WORKER_URL at a sync `/align` endpoint instead.)
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId } = (await request.json()) as { sessionId?: string };
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const { data: won, error: claimErr } = await supabase.rpc(
    "claim_practice_session",
    { p_session_id: sessionId }
  );
  if (claimErr) {
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }
  if (!won) {
    return NextResponse.json({ status: "already_processing" });
  }

  try {
    const { data: session } = await supabase
      .from("practice_sessions")
      .select("recording_path")
      .eq("id", sessionId)
      .single();
    if (!session?.recording_path) {
      throw new Error("Session has no recording");
    }

    const { data: recSigned, error: recErr } = await supabase.storage
      .from(RECORDING_BUCKET)
      .createSignedUrl(session.recording_path, 1800);
    if (recErr || !recSigned) {
      throw new Error(recErr?.message ?? "Could not sign recording URL");
    }

    const { data: refRows } = await supabase
      .from("practice_reference_midis")
      .select("piece_id, midi_path")
      .eq("status", "ready");
    const references = [];
    for (const r of (refRows ?? []) as { piece_id: string; midi_path: string }[]) {
      const { data: signed } = await supabase.storage
        .from(MIDI_BUCKET)
        .createSignedUrl(r.midi_path, 1800);
      if (signed) {
        references.push({ pieceId: r.piece_id, midiUrl: signed.signedUrl });
      }
    }

    const workerUrl = process.env.PRACTICE_WORKER_URL;
    if (!workerUrl) throw new Error("PRACTICE_WORKER_URL not configured");
    const callbackUrl = `${new URL(request.url).origin}/practice/session/api/callback`;

    const res = await fetch(workerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        recordingUrl: recSigned.signedUrl,
        references,
        callbackUrl,
        secret: process.env.WORKER_SECRET,
      }),
    });
    if (!res.ok) {
      throw new Error(`Worker kickoff ${res.status}: ${await res.text()}`);
    }

    return NextResponse.json({ status: "processing" });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to start processing";
    await supabase
      .from("practice_sessions")
      .update({ status: "failed", error_message: message })
      .eq("id", sessionId);
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
