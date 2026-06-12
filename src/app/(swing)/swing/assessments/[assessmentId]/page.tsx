import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getAssessment,
  getFocusAreas,
  getPlayer,
  getSession,
  getSessionClips,
  signArtifactUrls,
} from "@/lib/swing/queries";
import { focusAreaFromRow, type SwingFocusArea } from "@/lib/swing/types";
import type { EvidenceMedia } from "@/components/swing/assessment/assessment-view";
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

  const [player, session, focusAreas, clips] = await Promise.all([
    getPlayer(supabase, assessment.playerId),
    getSession(supabase, assessment.sessionId),
    getFocusAreas(supabase, assessmentId),
    getSessionClips(supabase, assessment.sessionId),
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

  // Evidence media: each still belongs to a clip ({session}/{clip}/still-*);
  // when that clip carries an annotated swing video, the UI shows the video
  // frozen on the still's moment instead of the static frame. The mapping
  // into the video timeline is videoSec = (eventMs - startMs) * slowdown.
  const clipsById = new Map(clips.map((c) => [c.id, c]));
  const evidenceMedia: Record<string, EvidenceMedia> = {};
  const videoPaths = new Set<string>();
  for (const fa of focusAreas) {
    for (const still of fa.evidenceStills) {
      const clipId = still.path.split("/")[1];
      const clip = clipId ? clipsById.get(clipId) : undefined;
      const video = clip?.video;
      if (!clip || !video || video.startMs === undefined || video.slowdown === undefined) {
        continue;
      }
      const eventMs = clip.events?.[still.phase];
      if (eventMs === undefined) continue;
      videoPaths.add(video.path);
      evidenceMedia[still.path] = {
        videoPath: video.path,
        videoUrl: "", // signed below
        offsetSec: Math.max(0, ((eventMs - video.startMs) * video.slowdown) / 1000),
      };
    }
  }

  const urlMap = await signArtifactUrls(supabase, [...stillPaths, ...videoPaths]);
  for (const media of Object.values(evidenceMedia)) {
    const url = urlMap.get(media.videoPath);
    if (url) media.videoUrl = url;
  }
  for (const key of Object.keys(evidenceMedia)) {
    if (!evidenceMedia[key].videoUrl) delete evidenceMedia[key];
  }

  return (
    <AssessmentView
      assessment={assessment}
      player={player}
      session={session}
      focusAreas={focusAreas}
      priorAreasById={Object.fromEntries(priorAreas.map((a) => [a.id, a]))}
      stillUrls={Object.fromEntries(urlMap)}
      evidenceMedia={evidenceMedia}
      supersededById={supersededById}
    />
  );
}
