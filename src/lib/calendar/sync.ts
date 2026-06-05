// One-shot sync of every active source. Runs under the service role (the
// per-source sync helpers create their own admin client). Triggered on calendar
// load by the sync-trigger client component, and reusable by a cron/edge job
// later.

import { syncAllTeamsnapSources } from "./teamsnap-sync";
import { syncAllIcsSources } from "./ics-sync";
import { syncAllGoogleSources } from "./google-sync";

export async function runCalendarSync(
  // The page-load trigger passes { teamsnapRsvp: false } to skip the per-event
  // RSVP fetch (a flood of TeamSnap calls that otherwise competes with the first
  // event the user opens). The cron and manual "Sync" button run the full sync.
  opts: { teamsnapRsvp?: boolean } = {},
): Promise<{
  teamsnap: number;
  ics: number;
  google: number;
}> {
  const [ts, ics, google] = await Promise.all([
    syncAllTeamsnapSources({ syncRsvp: opts.teamsnapRsvp }).catch(() => ({
      results: [],
    })),
    syncAllIcsSources().catch(() => ({ results: [] })),
    syncAllGoogleSources().catch(() => ({ results: [] })),
  ]);
  return {
    teamsnap: ts.results.length,
    ics: ics.results.length,
    google: google.results.length,
  };
}
