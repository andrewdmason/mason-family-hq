import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getAssessment,
  getFocusAreas,
  getPlayer,
  getSession,
  signArtifactUrls,
} from "@/lib/swing/queries";
import { focusAreaFromRow, type SwingFocusArea } from "@/lib/swing/types";
import { AssessmentView } from "@/components/swing/assessment/assessment-view";

export const dynamic = "force-dynamic";

// Assessment detail (U11): the coach reads the narrative, the 1–2 focus-area
// cards (tell → diagnosis → cue → drills → evidence stills), parked issues,
// and progress vs. the prior assessment. Evidence stills are signed per page
// load — STILL_URL_TTL_SECONDS is deliberately short (images of non-family
// minors), so URLs are never cached or persisted, only re-signed on render.
export default async function AssessmentPage({
  params,
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;
  const supabase = await createClient();

  const assessment = await getAssessment(supabase, assessmentId);
  if (!assessment) notFound();

  const [player, session, focusAreas] = await Promise.all([
    getPlayer(supabase, assessment.playerId),
    getSession(supabase, assessment.sessionId),
    getFocusAreas(supabase, assessmentId),
  ]);
  if (!player) notFound();

  // Prior focus areas referenced by the progress verdicts, so the UI can show
  // WHAT the prior focus was (cue/issue) next to each keep/advance/replace.
  const priorIds = [...new Set(assessment.progress.map((p) => p.priorFocusAreaId))];
  let priorAreas: SwingFocusArea[] = [];
  if (priorIds.length > 0) {
    const { data } = await supabase
      .from("swing_focus_areas")
      .select("*")
      .in("id", priorIds);
    priorAreas = (data ?? []).map(focusAreaFromRow);
  }

  // If this assessment was superseded by a regenerate, link to its replacement
  // (the session's current complete assessment).
  let supersededById: string | null = null;
  if (assessment.status === "superseded") {
    const { data } = await supabase
      .from("swing_assessments")
      .select("id")
      .eq("session_id", assessment.sessionId)
      .eq("status", "complete")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    supersededById = (data?.id as string | undefined) ?? null;
  }

  // Batch-sign all evidence-still paths in one call; passed down as a plain
  // object (Maps don't serialize across the RSC boundary).
  const stillPaths = [
    ...new Set(focusAreas.flatMap((fa) => fa.evidenceStills.map((s) => s.path))),
  ];
  const urlMap = await signArtifactUrls(supabase, stillPaths);

  return (
    <AssessmentView
      assessment={assessment}
      player={player}
      session={session}
      focusAreas={focusAreas}
      priorAreasById={Object.fromEntries(priorAreas.map((a) => [a.id, a]))}
      stillUrls={Object.fromEntries(urlMap)}
      supersededById={supersededById}
    />
  );
}
