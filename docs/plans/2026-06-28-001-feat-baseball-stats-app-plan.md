---
title: "feat: Baseball Stats app + GameChanger importer"
type: feat
status: active
date: 2026-06-28
origin: docs/brainstorms/baseball-stats-requirements.md
---

# feat: Baseball Stats app + GameChanger importer

## Summary

Build a new `(baseball)` Family HQ app that shows Oscar's and Sebastian's GameChanger history — career → season → game drill-down with traditional batting/pitching lines — backed by a local Playwright importer that captures GameChanger data, resolves cross-season player identity with human confirmation, and emits idempotent numbered SQL data-migrations applied on merge.

---

## Problem Frame

The boys' baseball stats live in GameChanger across ~30 team-seasons, organized by team rather than by kid, with no export and no public API — so there's no way to see a boy's career arc and no durable copy if GameChanger ever disappears. See origin for the full frame (`docs/brainstorms/baseball-stats-requirements.md`).

---

## Requirements

- R1. Importer pulls per team-season: roster, schedule/games, GameChanger's per-player season totals, and per-game box scores.
- R2. Per-game box scores come from reusing GameChanger's own stat engine (headless capture), not reimplementation; our team's players captured in full.
- R3. Each game's raw play-by-play event log stored verbatim as a durable archive (no v1 view).
- R4. Complete GameChanger season stat set per player archived (all fields), not only displayed ones.
- R5. Importer runs in Claude Code with Andrew's interactive GameChanger login; no stored credentials, no unattended runs.
- R6. Importer output is a numbered SQL data-migration reviewed in a branch and applied on merge; no direct prod writes.
- R7. Re-importing a team-season is safe and idempotent (adds new games, refreshes changed, never duplicates).
- R8. Each boy's career is stitched across all his teams into one identity, exact and human-confirmed.
- R9. Recurring teammates linked across seasons as best-effort AI-suggested matches Andrew can accept/reject.
- R10. Two parallel per-boy experiences (Oscar, Sebastian), identical structure, same views for everyone.
- R11. Career view lists a boy's seasons with per-season batting (and pitching where applicable) lines.
- R12. Season view shows the team's full roster stats with the boy highlighted, plus a game log.
- R13. Game view shows the full box score (per-player batting + pitching lines).
- R14. Default lines show the traditional set; full archived stat set reachable behind a "more stats" affordance.

**Origin actors:** A1 Viewer (family), A2 Importer (Claude Code + Andrew), A3 GameChanger (external source).
**Origin flows:** F1 Import a season, F2 Browse a boy's career.
**Origin acceptance examples:** AE1 (R7 re-import), AE2 (R8 career stitch), AE3 (R9 teammate link), AE4 (R2/R13 box-score fidelity), AE5 (R14 default vs more-stats).

---

## Scope Boundaries

- Opponents stay at game-result level — box-score capture stores only our team's side; opponent individual lines are not stored.
- No analytics/trend dashboards beyond a simple per-boy career sparkline (deferred: cross-season comparative analytics).
- No rendered view of raw event logs (archived only).
- No non-baseball sports, no live/in-game sync, no unattended/scheduled import, no per-user personalization.
- Stat engine is reused via page capture; porting GameChanger's compiler to Node is out.

### Deferred to Follow-Up Work

- Running the actual full-backlog import (~30 seasons) and the per-season go-forward imports: requires Andrew's interactive login + identity confirmations. The pipeline is built and validated against captured sample payloads in this plan; live ingestion is operated by Andrew post-merge.

---

## Context & Research

### Relevant Code and Patterns

- App template: `src/app/(bucks)/` — `layout.tsx` (`appMetadata("baseball")` + `GlobalHeader` + `TimezoneProvider`), `loading.tsx` (re-export `@/components/layout/page-loading`), `bucks/page.tsx` (`export const dynamic = "force-dynamic"`, async server component), co-located `actions.ts` (`"use server"`).
- Supabase: `src/lib/supabase/server.ts` (`createClient()` RLS session client for reads), `src/lib/supabase/admin.ts` (`createAdminClient()` service-role, scripts only), `src/lib/supabase/client.ts` (browser).
- Family identity: `family_members` table; kids = `role='kid'` with `user_id` set (both boys confirmed present). Reference kids by `user_id` resolved server-side.
- Migrations: `supabase/migrations/NNNNN_*.sql`, currently `00152`. Helper `update_updated_at_column()` from `00001`. RLS enable + policies; `SECURITY DEFINER` fns must `SET search_path = public` and `REVOKE ALL ON FUNCTION fn FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` (per `00151`). Data migrations are guarded/idempotent (`ON CONFLICT DO NOTHING`).
- Charts: `src/components/reports/weekly-chart.tsx` (recharts + shadcn `Card`, `--chart-1` CSS var, Tailwind-token tooltip).
- App registries: append to `PWA_APPS` in `src/lib/pwa/apps.ts` and `APPS` in `src/components/layout/app-switcher.tsx` (lucide icon).
- Script/importer conventions: `scripts/*.mts` run via `npx tsx`; service-role env loaded with `import { config } from "dotenv"; config({ path: ".env.local" })` BEFORE `await import("../src/lib/supabase/admin")`. Generator precedent: `scripts/gen-timeline-seed.mjs` reads a `*-seed-source.json` and emits SQL. Captured GameChanger sample payloads already saved under `.context/gc-*.json`.

### Institutional Learnings

- Idempotency: choose by write path. We write via **generated SQL** → use **full UNIQUE constraints** on GameChanger ids + `ON CONFLICT` (todos pattern; partial indexes can't be targeted by PostgREST upsert but we're not upserting via supabase-js).
- Migration numbering: check `supabase_migrations.schema_migrations` (shared local DB across Conductor workspaces), not just local files, before numbering.
- PostgREST: large `.in()` (~900+ ids) → HTTP 414 surfaced as silent empty; prefer fetch-all-and-filter or SQL joins for multi-season reads. `.update().or()` throws misleading 42703 — use an RPC for any conditional UPDATE.
- Sync-on-load flash: if the page ever syncs on mount, fingerprint before `router.refresh()` and ignore volatile `updated_at` keys. (v1 has no on-mount sync — import is offline — so not a concern unless added.)
- Reverse-engineered private API precedent: `src/lib/whoop/` (owner-only, ToS-acknowledged); structure capture/auth in a dedicated lib module.
- No browser testing by default: verify via `tsc`/lint/`build` and `scripts/verify-*.mts`. The Playwright use here is the importer's capture *mechanism*, not UI testing.

### External References

- GameChanger API surface, captured live during brainstorm (`api.team-manager.gc.com`): `/me/teams`, `/teams/{id}/players`, `/teams/{id}/schedule`, `/teams/{id}/game-summaries`, `/teams/{id}/season-stats` (full per-player blob), `/game-streams/gamestream-viewer-payload-lite/{event_id}` (raw events), per-game box-score rendered at `web.gc.com/teams/{publicId}/{slug}/schedule/{eventId}/box-score`. Auth = `gc-token` header (HS256, ~1h, refreshable).

---

## Key Technical Decisions

- **Family-wide read RLS, no per-kid scoping.** R10 makes all baseball data visible to everyone, so we skip the bucks scope-resolver. Policy: any authenticated `family_members` user may `SELECT` all `baseball_*` rows; no client INSERT/UPDATE/DELETE — writes only via migration/service-role. Simpler and matches the product.
- **Normalized schema, jsonb stat payloads.** Tables: `baseball_people`, `baseball_teams`, `baseball_team_players`, `baseball_games`, `baseball_game_player_stats`, `baseball_season_player_stats`, `baseball_game_events`. Stats stored as `jsonb` (full fidelity, R4) with a few extracted numeric columns only where needed for ordering. Avoids a brittle 80-column schema.
- **Per-game granularity = GameChanger's rendered box-score line.** That is all GC exposes per game without recompute; the full ~80-stat blob is season-level only; raw events archived (R3) so richer per-game derivation is possible later.
- **Cross-season identity in a committed registry.** `scripts/baseball/people.json` is the versioned source-of-truth mapping `gc_player_id → person slug` plus person records (`slug`, `display_name`, `kind`, optional `user_id`). Mirrors the repo's seed-source generator pattern, keeps identity reviewable in git, and avoids a live-DB dependency at generate time. Importer proposes matches (name similarity across known people); Andrew confirms; generator bakes resolved ids into the migration.
- **Two-stage importer: capture → generate.** Capture (`scripts/baseball/capture.mts`, Playwright, persistent profile) writes raw JSON per team-season into a gitignored cache. Generate (`scripts/baseball/generate-migration.mts`) reads cache + registry and emits a guarded, idempotent `NNNNN_baseball_data_*.sql`. Separation keeps capture (slow, interactive) independent from deterministic SQL emission and lets parsing be unit-tested against fixtures.
- **Idempotency via full UNIQUE on GameChanger ids + `ON CONFLICT`.** `gc_team_id`, `gc_game_id`, `(game_id, team_player_id)`, `(team_id, team_player_id)` etc. Re-import refreshes stats (`DO UPDATE`) and adds new games; identity rows `DO UPDATE` to keep names fresh.
- **Importer is a local dev-time tool, never Vercel.** No browser binary / time limits in serverless; the app only reads Supabase.

---

## Open Questions

### Resolved During Planning

- Headless capture vs compiler port: **page capture** (origin-recommended; verified working in brainstorm).
- Data model normalization: **normalized + jsonb** (above).
- Identity confirmation UX: **committed registry + in-chat proposal/confirm** (above).
- RLS shape: **family-wide read** (above).
- Idempotency mechanism: **full UNIQUE + ON CONFLICT in generated SQL** (above).

### Deferred to Implementation

- Exact GameChanger box-score DOM selectors / token-refresh handling: settle while wiring `capture.mts` against the live site; sample payloads in `.context/gc-*.json` drive the parser shape until then.
- Whether any season-stat fields need extracted columns for sorting beyond the initial set: decide when building the season view.

---

## Output Structure

    src/app/(baseball)/
      layout.tsx
      loading.tsx
      baseball/
        page.tsx                     # boy picker + both careers entry
        [kid]/
          page.tsx                   # career: season list
          [teamId]/
            page.tsx                 # season: roster stats + game log
            games/[gameId]/page.tsx  # game: box score
    src/lib/baseball/
      types.ts
      teams.ts                       # server-only read helpers
      stats.ts                       # stat formatting / curated-set selectors
      people.ts                      # kid resolution, name maps
    src/components/baseball/
      career-table.tsx
      season-view.tsx
      box-score.tsx
      career-trend-chart.tsx
      more-stats-sheet.tsx
    scripts/baseball/
      capture.mts                    # Playwright capture → JSON cache
      generate-migration.mts         # cache + registry → SQL migration
      parse.ts                       # pure parsers (unit-tested vs fixtures)
      people.json                    # committed identity registry
      fixtures/                      # captured sample payloads for tests
    supabase/migrations/
      00153_baseball.sql             # schema + RLS

---

## Implementation Units

- U1. **Schema migration + RLS**

**Goal:** Create the `baseball_*` tables, family-wide read RLS, and idempotency constraints.

**Requirements:** R3, R4, R7, R8, R9, R10.

**Dependencies:** None.

**Files:**
- Create: `supabase/migrations/00153_baseball.sql` (verify next free number against `supabase_migrations.schema_migrations` first)

**Approach:**
- Tables: `baseball_people` (`id`, `slug` unique, `display_name`, `kind` check in ('kid','teammate','other'), `user_id` FK `auth.users` nullable, timestamps); `baseball_teams` (`id`, `gc_team_id` unique, `gc_public_id`, `name`, `season_name`, `season_year` int, `level`, `org_name`, timestamps); `baseball_team_players` (`id`, `team_id` FK, `gc_player_id`, `person_id` FK people, `name`, `jersey`, `is_opponent` bool default false, unique `(team_id, gc_player_id)`); `baseball_games` (`id`, `team_id` FK, `gc_game_id` unique, `played_on` date, `opponent_name`, `home_away`, `team_score`, `opponent_score`, `result` char, `status`, timestamps); `baseball_game_player_stats` (`id`, `game_id` FK, `team_player_id` FK, `batting` jsonb, `pitching` jsonb, unique `(game_id, team_player_id)`); `baseball_season_player_stats` (`id`, `team_id` FK, `team_player_id` FK, `stats` jsonb, unique `(team_id, team_player_id)`); `baseball_game_events` (`id`, `game_id` FK unique, `gc_stream_id`, `events` jsonb, `captured_at`).
- All `ON DELETE CASCADE` down the team→game→stats chain. `updated_at` triggers via `update_updated_at_column()`.
- RLS: `ENABLE ROW LEVEL SECURITY` on all; one `FOR SELECT USING (auth.uid() IS NOT NULL)` policy per table (any signed-in family member reads). No write policies.

**Patterns to follow:** `supabase/migrations/00151_mason_bucks.sql` (table/trigger/RLS structure, section banners, re-run-safe header).

**Test scenarios:**
- Happy path: `npm run db:reset` (or targeted apply) succeeds; all tables + policies exist.
- Edge case: re-applying the migration is a no-op (guarded `create table if not exists` / `drop policy if exists` then create).
- Integration: insert a team→game→player-stat chain manually; deleting the team cascades.
- `Covers AE1.` Re-inserting a row with an existing `gc_game_id` via `ON CONFLICT` does not duplicate.

**Verification:** Migration applies cleanly to local DB; `\d baseball_*` shows tables, uniques, and RLS enabled; a signed-in select returns rows and an anon select is blocked.

---

- U2. **Pure parsers + fixtures**

**Goal:** Deterministic functions that turn captured GameChanger payloads into our row shapes, unit-tested against real samples.

**Requirements:** R1, R2, R4.

**Dependencies:** None (can run parallel to U1).

**Files:**
- Create: `scripts/baseball/parse.ts`, `scripts/baseball/fixtures/` (copy from `.context/gc-season-stats.json`, `.context/gc-game-boxscore.json`, `.context/gc-game-summaries.json`, plus a saved box-score DOM-extract sample), `scripts/baseball/parse.test.ts`

**Approach:**
- `parseSeasonStats(blob)` → per-`gc_player_id` `{ stats }`. `parseGameSummaries(arr)` → games with scores/opponent/result. `parseBoxScore(domRows)` → per-player `{ batting, pitching }` for our team only (drop opponent side). `parseEvents(payload)` → `{ gc_stream_id, events }`. Normalize IP like `0.2` and percentage strings.
- Keep parsers pure (input JSON/array → output objects); no I/O, no Playwright.

**Patterns to follow:** existing `scripts/*.mts` style; colocate a `*.test.ts`. Use the repo's test runner if present, else a minimal `tsx`-run assert script named `verify-baseball-parse.mts`.

**Test scenarios:**
- Happy path: season blob with 12 players → 12 parsed entries with expected AVG/OPS for a known player.
- `Covers AE4.` Box-score DOM rows from the sample game parse to the exact batting/pitching lines GameChanger rendered (e.g. our known `Sebastian Mason` line).
- Edge case: a player with no pitching appearances yields `pitching: null`/empty, not zeros that imply an appearance.
- Edge case: opponent rows are excluded from `parseBoxScore`.
- Error path: malformed/empty payload throws a clear error rather than emitting partial rows.

**Verification:** Parser tests pass against fixtures; outputs match hand-checked values from the captured samples.

---

- U3. **Identity registry + matcher**

**Goal:** Committed person registry and a proposer that links team rosters to cross-season identities, exact for the boys and best-effort for teammates.

**Requirements:** R8, R9.

**Dependencies:** U2.

**Files:**
- Create: `scripts/baseball/people.json` (seed with Oscar & Sebastian: slug, display_name, kind `kid`, their `user_id`s), `scripts/baseball/identity.ts`, `scripts/baseball/identity.test.ts`

**Approach:**
- Registry shape: `{ people: { slug: { display_name, kind, user_id? } }, aliases: { gc_player_id: slug } }`.
- `proposeMatches(roster, registry)` → for each `gc_player_id`: if already aliased, resolved; else suggest the best existing person by normalized-name similarity (case/diacritics/jersey-insensitive, last-name + first-initial heuristic) with a confidence, plus "new person" fallback. The boys are matched by exact known names and never auto-merged with anyone else.
- Confirmation is interactive (the importer prints proposals; Andrew confirms; `identity.ts` writes accepted aliases back to `people.json`). For autonomous runs, only high-confidence boy matches are auto-accepted; ambiguous teammates default to "new person" and are flagged.

**Patterns to follow:** seed-source JSON + generator (`scripts/gen-timeline-seed.mjs`).

**Test scenarios:**
- `Covers AE2.` The same boy across two rosters (different `gc_player_id`) resolves to one slug.
- `Covers AE3.` A teammate under two spellings is proposed as the same person; rejecting leaves two separate people, both intact.
- Edge case: two different kids with the same first name are NOT auto-merged (requires confirmation).
- Edge case: unknown player with no near match → proposes new person.

**Verification:** Matcher tests pass; running against two sample rosters yields a sensible proposal set; `people.json` round-trips after accepting matches.

---

- U4. **Capture script (Playwright)**

**Goal:** Given an interactive GameChanger login, capture a team-season's roster, schedule, season-stats, per-game box scores, and raw events into a JSON cache.

**Requirements:** R1, R2, R3, R5.

**Dependencies:** U2.

**Files:**
- Create: `scripts/baseball/capture.mts`
- Modify: `package.json` (add `baseball:capture` script), `.gitignore` (ignore `scripts/baseball/.cache/`)

**Approach:**
- Launch Chromium with a persistent user-data-dir so login persists across runs; on first run, pause for Andrew to log in (detect `/teams`).
- Resolve target team(s) from `/me/teams`; for each: GET `players`, `schedule`, `game-summaries`, `season-stats` via the authenticated context (reuse `gc-token`); for each game navigate the box-score page, scrape the rendered batting/pitching tables (our side), and GET the `gamestream-viewer-payload-lite` events.
- Write `scripts/baseball/.cache/<gc_team_id>.json`. Handle token refresh / re-login by detecting 401 and prompting.
- **Execution note:** capture is interactive and lives outside CI; it must be safe to re-run and resumable per team.

**Patterns to follow:** `src/lib/whoop/` reverse-engineered-client structure; brainstorm's verified request/scrape sequence.

**Test scenarios:**
- `Test expectation: none for live capture (interactive, network).` Validate the parsing it feeds via U2 fixtures instead.
- Integration (manual, Andrew-operated): capturing one real team writes a cache file whose parsed contents match the GameChanger UI.

**Verification:** Running against one team (with login) produces a complete cache file; re-running is idempotent and resumable.

---

- U5. **Migration generator**

**Goal:** Turn cached captures + registry into a guarded, idempotent numbered SQL data-migration.

**Requirements:** R6, R7, R8, R9.

**Dependencies:** U1, U2, U3.

**Files:**
- Create: `scripts/baseball/generate-migration.mts`
- Modify: `package.json` (add `baseball:generate` script)

**Approach:**
- Read all `.cache/*.json` + `people.json`; assign the next migration number by querying `supabase_migrations.schema_migrations` (not just files); emit `supabase/migrations/NNNNN_baseball_data_<slug>.sql`.
- Emit `INSERT ... ON CONFLICT (<natural key>) DO UPDATE` for people, teams, team_players (with `person_id` from registry), games, game_player_stats, season_player_stats, game_events. Values escaped; jsonb as literal. Re-run-safe header comment.
- Refuse to emit if any captured roster player is unresolved in the registry (forces identity confirmation first).

**Patterns to follow:** `scripts/gen-timeline-seed.mjs` (read JSON → emit SQL); `00152_mason_bucks_migration.sql` (guarded data migration).

**Test scenarios:**
- Happy path: one cached team → a migration that applies cleanly and produces the expected row counts.
- `Covers AE1.` Applying the generated migration twice yields identical data (no duplicates; stats refreshed).
- Error path: an unresolved player aborts generation with a clear message.
- Integration: generated SQL parses and applies on a fresh local DB after U1.

**Verification:** Generated migration applies on local DB; row counts match the cache; second apply is a no-op.

---

- U6. **App scaffold + registration + data reads**

**Goal:** Stand up the `(baseball)` route group, register the app, and provide server-only read helpers.

**Requirements:** R10, R11, R12, R13.

**Dependencies:** U1.

**Files:**
- Create: `src/app/(baseball)/layout.tsx`, `src/app/(baseball)/loading.tsx`, `src/app/(baseball)/baseball/page.tsx`, `src/app/(baseball)/baseball/[kid]/page.tsx`, `src/app/(baseball)/baseball/[kid]/[teamId]/page.tsx`, `src/app/(baseball)/baseball/[kid]/[teamId]/games/[gameId]/page.tsx`, `src/lib/baseball/types.ts`, `src/lib/baseball/people.ts`, `src/lib/baseball/teams.ts`, `src/lib/baseball/stats.ts`
- Modify: `src/lib/pwa/apps.ts` (`PWA_APPS`), `src/components/layout/app-switcher.tsx` (`APPS`, lucide icon e.g. `Baseball` or `Trophy`)

**Approach:**
- `layout.tsx`/`loading.tsx` mirror `(bucks)`. `people.ts` resolves the two kid slugs ↔ `display_name`/`user_id`. `teams.ts` reads career (a boy's teams via his `person_id` through `team_players`), a season (roster + games), and a game (box score) using the RLS session client; avoid large `.in()` — query by `team_id`/`game_id` joins.
- `stats.ts` defines the curated default field lists (batting, pitching) and selectors over the jsonb blobs.
- Pages are async server components (`dynamic = "force-dynamic"`) that fetch and pass to client components in U7.

**Patterns to follow:** `src/app/(bucks)/bucks/page.tsx`, `src/lib/bucks/*`, `src/lib/supabase/server.ts`.

**Test scenarios:**
- Happy path: career read returns a boy's seasons newest-first with per-season aggregate; season read returns roster + games; game read returns box-score rows.
- Edge case: a boy with no imported data renders an empty state, not an error.
- Edge case: an unknown `[kid]`/`[teamId]`/`[gameId]` returns `notFound()`.
- Integration: reads run as a signed-in user under RLS and return rows.

**Verification:** Routes compile and render with seeded local data; app appears in the switcher and PWA manifest.

---

- U7. **Views: career, season, box score, more-stats, trend**

**Goal:** The user-facing baseball experience.

**Requirements:** R10, R11, R12, R13, R14.

**Dependencies:** U6.

**Files:**
- Create: `src/components/baseball/career-table.tsx`, `season-view.tsx`, `box-score.tsx`, `more-stats-sheet.tsx`, `career-trend-chart.tsx`

**Approach:**
- Boy picker on `baseball/page.tsx` (two cards). Career table: season rows with traditional batting line + a `career-trend-chart` (recharts) of AVG/OPS by season. Season view: roster stat table with the boy highlighted + game log linking to games. Box score: batting + pitching tables for the game. `more-stats-sheet`: a shadcn sheet/dialog exposing the full season jsonb stat set (R14). Pitching line shown only where the boy/roster has innings.
- Reuse design tokens and `Card` patterns; keep components `"use client"` only where interactive (more-stats sheet, chart); tables can be server-rendered.

**Patterns to follow:** `src/components/reports/weekly-chart.tsx` (recharts), shadcn `Card`/`Sheet`/`Table` in `src/components/ui/`.

**Test scenarios:**
- Happy path: career table renders seasons with correct curated values; trend chart plots one point per season.
- `Covers AE5.` Default view shows only the traditional fields; opening "more stats" reveals the full archived set.
- Edge case: a season with no pitching hides the pitching line/section.
- Edge case: long rosters and a boy with one season both render cleanly.

**Verification:** `npm run build` succeeds; seeded data renders career → season → game; "more stats" reveals the full blob.

---

- U8. **Importer runbook doc**

**Goal:** Document the operate-it loop so Andrew can run backlog + go-forward imports.

**Requirements:** R5, R6, R8, R9.

**Dependencies:** U4, U5.

**Files:**
- Create: `docs/baseball-import-runbook.md`

**Approach:**
- Steps: branch → `npm run baseball:capture` (log in, pick season) → review/confirm identity proposals → `npm run baseball:generate` → review migration diff → merge (applies on deploy). Note token expiry, resumability, and the "unresolved player blocks generation" guard.

**Test scenarios:** `Test expectation: none — documentation.`

**Verification:** A reader can run one import end-to-end from the doc.

---

## System-Wide Impact

- **Interaction graph:** New app registered in `PWA_APPS` and the app-switcher; otherwise isolated under `baseball_*` tables and `(baseball)` routes. No changes to existing apps.
- **Error propagation:** Importer fails loudly (unresolved identity aborts generation; capture surfaces auth failures). App reads degrade to empty states, not errors.
- **State lifecycle risks:** Re-import must not duplicate — enforced by UNIQUE + `ON CONFLICT`. Identity registry is the single source of truth for continuity; mis-merges are correctable by editing `people.json` + re-generating.
- **API surface parity:** None — no public/agent API surface added.
- **Unchanged invariants:** `family_members`, existing apps, and migration helper functions are untouched; baseball only adds tables and a route group.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| GameChanger DOM/endpoints change | Parsers isolated + fixture-tested (U2); capture is a thin, replaceable layer; raw events archived so re-derivation is possible. |
| Token expiry mid-backlog | Persistent profile + per-team resumable capture; re-login prompt on 401. |
| Identity mis-merge | Boys never auto-merged; teammates default to new-person unless confirmed; registry is versioned and editable. |
| Migration number collision (shared local DB) | Generator queries `schema_migrations` for the next number. |
| Large multi-season reads hitting PostgREST 414 | Query by team/game joins, never a giant `.in()`. |
| Can't run live import unattended (R5) | Pipeline built + validated on captured fixtures; live ingestion handed to Andrew via runbook. |

---

## Sources & References

- **Origin document:** `docs/brainstorms/baseball-stats-requirements.md`
- Captured GameChanger samples: `.context/gc-season-stats.json`, `.context/gc-game-boxscore.json`, `.context/gc-game-summaries.json`
- Patterns: `src/app/(bucks)/`, `src/lib/supabase/`, `supabase/migrations/00151_mason_bucks.sql`, `scripts/gen-timeline-seed.mjs`, `src/components/reports/weekly-chart.tsx`
