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
    /* Stuck-`analyzing` reconciliation: figure out what the newest assessment
     * actually says happened, then either bounce (a real run is in flight),
     * reap a stale orphan, or repair a session flag the dead handler never
     * got to flip. Repaired sessions fall through to the CAS claim below. */
    const { data: newest } = await supabase
      .from("swing_assessments")
      .select("id, status, created_at")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (newest?.status === "generating") {
      const stale =
        Date.now() - new Date(newest.created_at).getTime() > STALE_GENERATING_MS;
      if (!stale) {
        return NextResponse.json(
          { error: "Analysis is already running for this session" },
          { status: 409 }
        );
      }
      // Reap the orphan: fail it, clean up any focus areas it half-wrote,
      // and reset the session so the CAS claim can take over.
      await supabase
        .from("swing_assessments")
        .update({ status: "analysis_failed", error: "Timed out — taken over by retry" })
        .eq("id", newest.id)
        .eq("status", "generating");
      await supabase.from("swing_focus_areas").delete().eq("assessment_id", newest.id);
      await supabase
        .from("swing_sessions")
        .update({ status: "analysis_failed" })
        .eq("id", sessionId);
    } else if (newest?.status === "complete") {
      // Handler died after the assessment landed but before the session flip.
      await supabase
        .from("swing_sessions")
        .update({ status: "complete" })
        .eq("id", sessionId);
      return NextResponse.json(
        { error: "Session already has an assessment — use regenerate" },
        { status: 409 }
      );
    } else {
      // Missing or terminal-failed (analysis_failed/superseded/voided): the
      // session flag is stale — mark it failed and retry via the CAS claim.
      await supabase
        .from("swing_sessions")
        .update({ status: "analysis_failed" })
        .eq("id", sessionId);
    }
  } else if (sessionRow.status === "complete") {
    if (mode !== "regenerate") {
      return NextResponse.json(
        { error: "Session already has an assessment — use regenerate" },
        { status: 409 }
      );
    }
  }

  const regenerate = sessionRow.status === "complete" && mode === "regenerate";

  if (!regenerate) {
    // Compare-and-set: only one caller wins the draft/analysis_failed →
    // analyzing flip; concurrent requests see zero rows and bounce.
    const { data: claimed } = await supabase
      .from("swing_sessions")
      .update({ status: "analyzing", error: null })
      .eq("id", sessionId)
      .in("status", ["draft", "analysis_failed"])
      .select("id");
    if ((claimed ?? []).length === 0) {
      return NextResponse.json(
        { error: "Analysis is already running" },
        { status: 409 }
      );
    }
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
      const { error: statusError } = await supabase
        .from("swing_sessions")
        .update({ status: "analysis_failed", error: message })
        .eq("id", sessionId);
      if (statusError) {
        console.error(
          `Failed to mark session ${sessionId} analysis_failed: ${statusError.message}`
        );
      }
    }
    return NextResponse.json({ error: message }, { status });
  }
}
