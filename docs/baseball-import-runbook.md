# Baseball stats import — runbook

How to bring a GameChanger team-season into the Baseball app. Use this for the
backlog (one run per old season) and going forward (one run per new season).

The importer is **local + interactive** — it drives a real browser you log into
and emits a reviewed SQL migration. It never writes to production directly; data
lands when the migration merges and deploys.

## One-time setup

- `npm install` (brings in `playwright` + `tsx`).
- If the first capture run complains the browser is missing:
  `npx playwright install chromium`.

## The loop (per team-season)

1. **Branch.**
   ```bash
   git checkout -b baseball/<season>-<team>
   ```

2. **Capture.** First run opens a browser — log into GameChanger and leave it
   open; the login persists for later runs.
   ```bash
   # List the teams on the account:
   npm run baseball:capture
   # Then capture one team-season (name substring or public id):
   npm run baseball:capture -- --team "NOLL 10U"
   ```
   This writes `scripts/baseball/.cache/<gc_team_id>.json` (roster, schedule,
   season totals, per-game box scores, raw event logs). It is **resumable** —
   re-running skips games already captured, so a dropped connection or an
   expired token (log in again) just continues.

3. **Confirm identities.** The capture proposes who each roster player is. The
   two boys auto-link by full name; teammates are matched best-effort. Review and
   edit `scripts/baseball/people.json`:
   - `people`: slug → `{ display_name, kind, family_member? }`. `kind: "kid"`
     with a `family_member` name links a boy to his account (resolved portably at
     migration time). Teammates are `kind: "teammate"`.
   - `aliases`: `gc_player_id` → slug. Every captured roster player must appear
     here before generating. To **merge** a recurring teammate across seasons,
     point both teams' `gc_player_id`s at the same slug. To keep two same-named
     kids separate, give them distinct slugs.

4. **Generate the migration.**
   ```bash
   npm run baseball:generate
   ```
   Writes `supabase/migrations/NNNNN_baseball_data_<team>.sql`. It **aborts** if
   any captured roster player is still unresolved in `people.json` — fix step 3
   and re-run. Every statement is `INSERT … ON CONFLICT DO UPDATE`, so applying
   is idempotent (re-importing a season adds new games and refreshes changed
   ones; it never duplicates).

   > Before merging, glance at `supabase_migrations.schema_migrations` (the local
   > DB is shared across Conductor workspaces) to confirm the chosen number isn't
   > taken by a sibling branch. Bump the filename number if so.

5. **Review + merge.** Read the migration diff and the `people.json` diff like
   any change, then open a PR and merge. The migration applies on deploy and the
   season appears under both boys at `/baseball`.

## Notes

- **Tokens** expire ~hourly. If capture starts returning 401s, just log in again
  in the open browser and re-run — it resumes.
- **Opponents** are intentionally stored only at game-result level; box-score
  capture keeps our team's side.
- **Raw event logs** are archived per game (`baseball_game_events`) even though
  v1 renders no view of them — the deep backup if GameChanger ever changes or
  disappears.
- If GameChanger's box-score markup shifts and a game logs
  `⚠ … box rows unmatched`, adjust the scraper selectors in
  `scripts/baseball/capture.mts` (`scrapeBoxScore`); the parsers and generator
  downstream are unaffected.
- Verify importer internals without GameChanger:
  ```bash
  npx tsx scripts/verify-baseball-parse.mts
  npx tsx scripts/verify-baseball-identity.mts
  npx tsx scripts/verify-baseball-generate.mts
  ```
