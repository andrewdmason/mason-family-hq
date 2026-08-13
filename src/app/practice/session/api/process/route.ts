import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { kickoffSegmentProcessing } from "@/lib/practice/segment-kickoff";
import { kickoffSessionProcessing } from "@/lib/practice/session-kickoff";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Kick off worker processing (async). Three job shapes (plan U5/U8):
 * - `{ recordingId }` — known-piece alignment for one practice_recordings row.
 * - `{ sessionId }` — open-session initial processing: TRANSCRIPTION-ONLY
 *   (mode "segment", no references) — no recognition, no log writes (R15).
 * - `{ sessionId, link: true }` — the explicit "link to pieces" recognition
 *   job (R16); its callback stores proposals, never tasks.
 * Claims the session/recording lease, signs the URLs, and hands the job to
 * the worker, which processes in the background (minutes for long recordings)
 * and POSTs the result to the callback route. Returns immediately — nothing
 * blocks; results land via revalidation. (For local dev without an async
 * worker, point PRACTICE_WORKER_URL at a sync `/align` endpoint instead.)
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { sessionId, recordingId, link } = (await request.json()) as {
    sessionId?: string;
    recordingId?: string;
    link?: boolean;
  };

  const callbackUrl = `${new URL(request.url).origin}/practice/session/api/callback`;

  // Segment branch (plan U5): known-piece alignment job for one
  // practice_recordings row.
  if (!sessionId && recordingId) {
    const outcome = await kickoffSegmentProcessing(
      supabase,
      recordingId,
      callbackUrl
    );
    return NextResponse.json(outcome, {
      status: outcome.status === "failed" ? 500 : 200,
    });
  }

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId or recordingId required" },
      { status: 400 }
    );
  }

  const outcome = await kickoffSessionProcessing(supabase, sessionId, callbackUrl, {
    link: !!link,
  });
  return NextResponse.json(outcome, {
    status: outcome.status === "failed" ? 500 : 200,
  });
}
