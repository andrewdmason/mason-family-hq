// One-shot sync of every active source. Runs under the service role (the
// per-source sync helpers create their own admin client). Triggered on calendar
// load by the sync-trigger client component, and reusable by a cron/edge job
// later.

import { syncAllTeamsnapSources } from "./teamsnap-sync";
import { syncAllIcsSources } from "./ics-sync";

export async function runCalendarSync(): Promise<{
  teamsnap: number;
  ics: number;
}> {
  const [ts, ics] = await Promise.all([
    syncAllTeamsnapSources().catch(() => ({ results: [] })),
    syncAllIcsSources().catch(() => ({ results: [] })),
  ]);
  return { teamsnap: ts.results.length, ics: ics.results.length };
}
