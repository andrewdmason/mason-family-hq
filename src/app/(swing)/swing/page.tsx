import { createClient } from "@/lib/supabase/server";
import { getPlayers, getRosterFocusSummaries } from "@/lib/swing/queries";
import { RosterShell } from "@/components/swing/roster/roster-shell";

export const dynamic = "force-dynamic";

// Roster home: every active player with their current coaching state at a
// glance (age, side, focus-area count + top cue). The shell handles add/edit/
// archive and reconciles via router.refresh() — see actions.ts.
export default async function SwingRosterPage() {
  const supabase = await createClient();
  const players = await getPlayers(supabase);
  const summaries = await getRosterFocusSummaries(
    supabase,
    players.map((p) => p.id)
  );
  return <RosterShell players={players} summaries={summaries} />;
}
