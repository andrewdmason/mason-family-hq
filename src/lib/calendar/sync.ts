// One-shot sync of every active source. Runs under the service role (the
// per-source sync helpers create their own admin client). Triggered on calendar
// load by the sync-trigger client component, and reusable by a cron/edge job
// later.

import { createAdminClient } from "@/lib/supabase/admin";
import { syncAllTeamsnapSources } from "./teamsnap-sync";
import { syncAllIcsSources } from "./ics-sync";
import { syncAllGoogleSources } from "./google-sync";
import { refreshDriveTimes } from "./drive-time";
import { reconcileAllDriveEvents } from "./drive-events";

export async function runCalendarSync(
  // The page-load trigger passes { teamsnapRsvp: false, materialize: false } to
  // skip the per-event RSVP fetch (a flood of TeamSnap calls that otherwise
  // competes with the first event the user opens) and to avoid writing to Google
  // on the frequent, concurrent page-load path. The cron and manual "Sync" button
  // run the full sync, which materializes events onto the kids' Google calendars.
  opts: { teamsnapRsvp?: boolean; materialize?: boolean } = {},
): Promise<{
  teamsnap: number;
  ics: number;
  google: number;
  driveTimes: number;
  driveBlocks: number;
}> {
  const materialize = opts.materialize !== false;
  const [ts, ics, google] = await Promise.all([
    syncAllTeamsnapSources({ syncRsvp: opts.teamsnapRsvp, materialize }).catch(
      () => ({ results: [] }),
    ),
    syncAllIcsSources({ materialize }).catch(() => ({ results: [] })),
    syncAllGoogleSources().catch(() => ({ results: [] })),
  ]);

  // Drive-time logistics, sequenced AFTER the source syncs so a moved or
  // relocated event gets a refreshed drive time and a re-patched drive block in
  // the same tick. Skipped on the page-load path along with materialization —
  // both write to Google.
  let driveTimes = 0;
  let driveBlocks = 0;
  if (materialize) {
    const admin = createAdminClient();
    const drive = await refreshDriveTimes(admin).catch(() => ({ calculated: 0 }));
    const blocks = await reconcileAllDriveEvents(admin).catch(() => ({
      reconciled: 0,
      errors: 0,
    }));
    driveTimes = drive.calculated;
    driveBlocks = blocks.reconciled;
  }

  return {
    teamsnap: ts.results.length,
    ics: ics.results.length,
    google: google.results.length,
    driveTimes,
    driveBlocks,
  };
}
