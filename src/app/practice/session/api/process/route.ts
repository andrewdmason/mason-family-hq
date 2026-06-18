import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { writeSessionTasks } from "@/lib/practice/autolog";
import type { PracticeAlignmentResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const RECORDING_BUCKET = "task-audio";
const MIDI_BUCKET = "piece-midi";
// Below this overall confidence we keep the audio so a rare miss can be checked (R3).
const LOW_CONFIDENCE = 0.7;

/**
 * Kick off processing for a recorded session (plan U7). Claims the session
 * (idempotency lease), calls the alignment worker, writes the per-piece tasks,
 * then deletes the audio (retaining it only on low confidence) and marks the
 * session ready/failed.
 *
 * v1 calls the worker synchronously — practice clips are short, so this fits the
 * function budget. When the worker moves to Modal for longer jobs, this becomes
 * "enqueue + return" and a sibling callback route writes the results.
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

  // Idempotency lease: only the caller that wins the claim does the work.
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
      .select("id, date, session_number, recording_path")
      .eq("id", sessionId)
      .single();
    if (!session?.recording_path) {
      throw new Error("Session has no recording");
    }

    const { data: recSigned, error: recErr } = await supabase.storage
      .from(RECORDING_BUCKET)
      .createSignedUrl(session.recording_path, 600);
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
        .createSignedUrl(r.midi_path, 600);
      if (signed) {
        references.push({ pieceId: r.piece_id, midiUrl: signed.signedUrl });
      }
    }

    const workerUrl = process.env.PRACTICE_WORKER_URL;
    if (!workerUrl) throw new Error("PRACTICE_WORKER_URL not configured");
    const res = await fetch(`${workerUrl}/align`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.WORKER_SECRET
          ? { "x-worker-secret": process.env.WORKER_SECRET }
          : {}),
      },
      body: JSON.stringify({ recordingUrl: recSigned.signedUrl, references }),
    });
    if (!res.ok) {
      throw new Error(`Worker error ${res.status}: ${await res.text()}`);
    }
    const result = (await res.json()) as PracticeAlignmentResult;

    const taskCount = await writeSessionTasks(supabase, sessionId, result, {
      date: session.date,
      sessionNumber: session.session_number,
    });

    const retain = (result.confidence ?? 0) < LOW_CONFIDENCE;
    if (!retain) {
      await supabase.storage
        .from(RECORDING_BUCKET)
        .remove([session.recording_path]);
    }

    await supabase
      .from("practice_sessions")
      .update({
        status: "ready",
        confidence: result.confidence,
        result,
        audio_retained: retain,
        recording_path: retain ? session.recording_path : null,
      })
      .eq("id", sessionId);

    return NextResponse.json({ status: "ready", taskCount, retain });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Processing failed";
    await supabase
      .from("practice_sessions")
      .update({ status: "failed", error_message: message })
      .eq("id", sessionId);
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
