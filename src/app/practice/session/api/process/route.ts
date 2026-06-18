import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { writeSessionTasks } from "@/lib/practice/autolog";
import type { PracticeAlignmentResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const RECORDING_BUCKET = "task-audio";
const MIDI_BUCKET = "piece-midi";
const SESSION_MIDI_BUCKET = "practice-session-midi";

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
    const result = (await res.json()) as PracticeAlignmentResult & {
      transcriptionMidiB64?: string | null;
    };

    const taskCount = await writeSessionTasks(supabase, sessionId, result, {
      date: session.date,
      sessionNumber: session.session_number,
    });

    // Store the transcribed performance MIDI (tiny, less sensitive than audio),
    // then ALWAYS delete the recording — we keep the MIDI instead.
    let transcriptionPath: string | null = null;
    if (result.transcriptionMidiB64) {
      const midiBytes = Buffer.from(result.transcriptionMidiB64, "base64");
      const path = session.recording_path.replace(/\.(m4a|webm)$/, ".mid");
      const { error: upErr } = await supabase.storage
        .from(SESSION_MIDI_BUCKET)
        .upload(path, midiBytes, { contentType: "audio/midi", upsert: true });
      if (!upErr) transcriptionPath = path;
    }
    await supabase.storage
      .from(RECORDING_BUCKET)
      .remove([session.recording_path]);

    // Don't persist the base64 blob in the row — the MIDI lives in storage.
    const { transcriptionMidiB64: _omit, ...storedResult } = result;
    void _omit;

    await supabase
      .from("practice_sessions")
      .update({
        status: "ready",
        confidence: result.confidence,
        result: storedResult,
        audio_retained: false,
        recording_path: null,
        transcription_path: transcriptionPath,
      })
      .eq("id", sessionId);

    return NextResponse.json({ status: "ready", taskCount });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Processing failed";
    await supabase
      .from("practice_sessions")
      .update({ status: "failed", error_message: message })
      .eq("id", sessionId);
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
