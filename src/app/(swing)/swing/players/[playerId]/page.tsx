import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getCurrentFocusAreas,
  getFocusAreas,
  getPlayer,
  getPlayerAssessments,
  getPlayerSessions,
} from "@/lib/swing/queries";
import { PlayerPage } from "@/components/swing/player/player-page";

export const dynamic = "force-dynamic";

// Player home (F3): the between-reps field reference. Current focus areas
// (cue + tell) above the fold; assessment history and in-progress sessions
// below. Current-ness is derived in getCurrentFocusAreas — voided/superseded
// assessments never surface here.
export default async function SwingPlayerPage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  const supabase = await createClient();
  const [player, current, sessions, assessments] = await Promise.all([
    getPlayer(supabase, playerId),
    getCurrentFocusAreas(supabase, playerId),
    getPlayerSessions(supabase, playerId),
    getPlayerAssessments(supabase, playerId),
  ]);
  if (!player) notFound();

  // History rows show what each complete assessment worked on — fetch issue
  // labels per complete assessment (small N; focus areas are tiny rows).
  const issueLabels: Record<string, string[]> = {};
  await Promise.all(
    assessments
      .filter((a) => a.status === "complete")
      .map(async (a) => {
        const areas = await getFocusAreas(supabase, a.id);
        issueLabels[a.id] = areas
          .filter((fa) => fa.disposition === "focus")
          .map((fa) => fa.issueKey);
      })
  );

  // Completed sessions are represented by their assessments; only unfinished
  // work appears as a session row to resume.
  const inProgressSessions = sessions.filter((s) =>
    ["draft", "analyzing", "analysis_failed"].includes(s.status)
  );

  return (
    <PlayerPage
      player={player}
      current={current}
      assessments={assessments}
      issueLabels={issueLabels}
      inProgressSessions={inProgressSessions}
    />
  );
}
