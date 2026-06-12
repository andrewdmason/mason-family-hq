import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getPlayer,
  getSession,
  getSessionClips,
} from "@/lib/swing/queries";
import { SessionShell } from "@/components/swing/session/session-shell";

export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ playerId: string; sessionId: string }>;
}) {
  const { playerId, sessionId } = await params;
  const supabase = await createClient();
  const [player, session, clips] = await Promise.all([
    getPlayer(supabase, playerId),
    getSession(supabase, sessionId),
    getSessionClips(supabase, sessionId),
  ]);
  if (!player || !session || session.playerId !== player.id) notFound();

  // The session's latest assessment drives the post-analyze states (wait
  // spinner → redirect on complete, retry CTA on failure).
  const { data: assessmentRow } = await supabase
    .from("swing_assessments")
    .select("id, status")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <SessionShell
      player={player}
      session={session}
      initialClips={clips}
      latestAssessment={
        assessmentRow
          ? { id: assessmentRow.id as string, status: assessmentRow.status as string }
          : null
      }
    />
  );
}
