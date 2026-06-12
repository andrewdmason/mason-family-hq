// Analyze / retry / regenerate — the sole gatekeeper for assessment runs.
//
// Route handler (not a server action) per the journal-regenerate precedent:
// a 30–60s LLM call inside a server action would serialize the session UI.
// requireUserId() runs FIRST — middleware's 302 redirect is browser gating,
// not API semantics, and an unguarded invocation triggers a paid LLM call.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import { AssessmentError, runAssessment } from "@/lib/swing/assessment/generate";

export const runtime = "nodejs";
export const maxDuration = 300;

/** A `generating` row older than this is presumed orphaned (handler died
 * without writing a terminal state) and gets taken over on the next analyze. */
const STALE_GENERATING_MS = 10 * 60 * 1000;

export async function POST(request: Request) {
  const supabase = await createClient();
  try {
    await requireUserId(supabase);
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    mode?: "analyze" | "regenerate";
  } | null;
  if (!body?.sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  const { sessionId } = body;
  const mode = body.mode ?? "analyze";

  const { data: sessionRow } = await supabase
    .from("swing_sessions")
    .select("id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (!sessionRow) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (sessionRow.status === "analyzing") {
    /* Stuck-`analyzing` escape: if the newest assessment is a stale
     * `generating` orphan, reap it and proceed as a fresh run — surfaced to
     * the coach as the same Retry button, no special state. */
    const { data: newest } = await supabase
      .from("swing_assessments")
      .select("id, status, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const stale =
      newest?.status === "generating" &&
      Date.now() - new Date(newest.created_at).getTime() > STALE_GENERATING_MS;
    if (!stale) {
      return NextResponse.json(
        { error: "Analysis is already running for this session" },
        { status: 409 }
      );
    }
    await supabase
      .from("swing_assessments")
      .update({ status: "analysis_failed", error: "Timed out — taken over by retry" })
      .eq("id", newest!.id)
      .eq("status", "generating");
  } else if (sessionRow.status === "complete") {
    if (mode !== "regenerate") {
      return NextResponse.json(
        { error: "Session already has an assessment — use regenerate" },
        { status: 409 }
      );
    }
  } else if (sessionRow.status !== "draft" && sessionRow.status !== "analysis_failed") {
    return NextResponse.json({ error: "Session isn't ready to analyze" }, { status: 409 });
  }

  const regenerate = sessionRow.status === "complete" && mode === "regenerate";

  if (!regenerate) {
    await supabase
      .from("swing_sessions")
      .update({ status: "analyzing", error: null })
      .eq("id", sessionId);
  }

  try {
    const { assessmentId } = await runAssessment(supabase, sessionId, { regenerate });
    if (!regenerate) {
      await supabase
        .from("swing_sessions")
        .update({ status: "complete" })
        .eq("id", sessionId);
    }
    return NextResponse.json({ assessmentId });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Assessment generation failed";
    const status = error instanceof AssessmentError && error.isUserError ? 422 : 500;
    if (!regenerate) {
      await supabase
        .from("swing_sessions")
        .update({ status: "analysis_failed", error: message })
        .eq("id", sessionId);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
