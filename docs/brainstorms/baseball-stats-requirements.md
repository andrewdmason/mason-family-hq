---
date: 2026-06-28
topic: baseball-stats
---

# Baseball Stats (GameChanger Archive)

## Summary

A new Family HQ app that imports Oscar's and Sebastian's GameChanger baseball history — per-game box scores and season totals for every team they've played on — and presents each boy's career season by season, with teammates' stats for context. Data lands via a Claude Code importer run per season, which emits a reviewed SQL migration that applies on merge.

---

## Problem Frame

All of the boys' baseball stats live in GameChanger, spread across ~30 team-seasons (Fall 2022 → present) and growing every season. GameChanger organizes data by *team*, not by *kid*, so there is no way to see Oscar's or Sebastian's career arc — each season is a separate silo, the same kid appears as a different roster entry on every team, and GameChanger offers no real export and no public API. The data is also someone else's to keep: a product decision, an account lapse, or a shutdown could erase years of Little League history with no warning. Today the only "view" of a boy's career is manually clicking through a dozen-plus disconnected team pages, and there is no durable copy of any of it.

---

## Actors

- A1. Viewer (Andrew / family): browses the finished app — picks a boy, reads his season-by-season and per-game stats. Every viewer sees the same views; there is no per-user personalization.
- A2. Importer (Claude Code, run by Andrew): authenticated via Andrew's GameChanger login, pulls a season's data, disambiguates player identities, and produces the data migration.
- A3. GameChanger: external source system. Read-only, unofficial API + rendered pages; no cooperation assumed.

---

## Key Flows

- F1. Import a season
  - **Trigger:** Andrew starts a branch and runs the importer for a team-season (backlog item, or a newly-finished season).
  - **Actors:** A2 (importer), A3 (GameChanger), Andrew (confirms).
  - **Steps:** Andrew logs into GameChanger in the driven browser → importer pulls the team's roster, schedule, season totals, each game's box score (via GameChanger's own stat engine), and each game's raw play-by-play log → importer proposes identity matches (which roster entry is Oscar/Sebastian; which teammates recur from prior seasons) → Andrew confirms or corrects the matches → importer writes a numbered SQL data-migration → Andrew reviews the branch and merges → migration applies to production.
  - **Outcome:** That team-season's games, box scores, season totals, and raw event logs are stored and linked to the right boy and to recurring teammates.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7, R8, R9

- F2. Browse a boy's career
  - **Trigger:** Viewer opens the baseball app and picks Oscar or Sebastian.
  - **Actors:** A1.
  - **Steps:** Pick a boy → see his career as a list of seasons with per-season stat lines → open a season to see that team's roster stats (boy highlighted) and a game log → open a game to see the full box score.
  - **Outcome:** Viewer can read a boy's stats at career, season, and single-game granularity.
  - **Covered by:** R10, R11, R12, R13

---

## Requirements

**Import & data capture**
- R1. The importer pulls, for a given GameChanger team-season: roster, schedule/game list (date, opponent, score, result), GameChanger's pre-computed per-player season totals, and per-game box scores.
- R2. Per-game box scores (per-player batting and pitching lines for that single game) are obtained by reusing GameChanger's own stat computation — not by reimplementing scoring. The boy's own team's players are captured in full.
- R3. The importer also stores each game's raw play-by-play event log verbatim as a durable archive, even though v1 renders no view of it.
- R4. The importer captures the complete GameChanger stat set per player (all ~80+ offensive and ~26 defensive/pitching fields), not only the fields shown by default.
- R5. The importer runs in Claude Code using Andrew's interactive GameChanger login; no stored credentials and no unattended/scheduled execution.
- R6. The importer's output is a numbered SQL data-migration consistent with the repo's existing migration convention, reviewable in a branch and applied on merge. It does not write to production directly.
- R7. Re-importing a team-season (e.g., a season that gained games since last run) is safe and does not duplicate previously imported data.

**Identity & continuity**
- R8. Each boy's career is stitched across all his teams into one identity. This linkage must be exact; the importer surfaces the candidate roster entry and Andrew confirms it during import.
- R9. The importer proposes links for recurring teammates across seasons (same kid, different teams) as best-effort, AI-assisted suggestions that Andrew can accept or reject. Wrong or skipped teammate links are acceptable; wrong boy links are not.

**Viewing**
- R10. The app presents two parallel experiences, one per boy (Oscar, Sebastian), with identical structure. There is no per-user variation in what is shown.
- R11. A boy's career view lists his seasons with a per-season stat line (batting and, where applicable, pitching).
- R12. A season view shows that team's full roster stats with the boy highlighted, plus a game log (date, opponent, score, result).
- R13. A game view shows the full box score: per-player batting and pitching lines for that game.
- R14. Default stat lines show the traditional set (batting: AVG, OBP, SLG, OPS, AB, H, 2B, 3B, HR, RBI, R, BB, K, SB; pitching: IP, ERA, WHIP, K, BB, H). The full archived stat set is reachable behind a secondary "more stats" affordance rather than shown by default.

---

## Acceptance Examples

- AE1. **Covers R7.** Given a team-season already imported with 12 games, when the season later has 15 games and the importer is re-run, then the 3 new games are added and the original 12 are not duplicated.
- AE2. **Covers R8.** Given Oscar appears as a distinct roster entry on 15 different teams, when all are imported, then his career view shows all 15 seasons under one Oscar identity.
- AE3. **Covers R9.** Given a teammate played on 4 of Oscar's teams under slightly different name spellings, when importing, then the importer proposes they are the same person and Andrew can confirm or reject — and rejecting leaves the seasons intact, just unlinked.
- AE4. **Covers R2, R13.** Given a completed game, when its box score is captured, then the stored per-player batting and pitching lines match what GameChanger renders for that game.
- AE5. **Covers R14.** Given a season stat line, when viewed by default, then only the traditional batting/pitching fields are shown; when the viewer opens "more stats," then the full archived field set is available.

---

## Success Criteria

- Andrew can open the app, pick a boy, and read his stats at career / season / single-game granularity without ever touching GameChanger.
- The full backlog (~30 team-seasons) is imported, and importing a new season is a repeatable, low-friction branch-and-merge that takes minutes of attention.
- Per-game box scores stored in the app match GameChanger's rendered numbers.
- If GameChanger disappeared tomorrow, nothing is lost: season totals, per-game box scores, and raw play-by-play logs are all held locally.
- A downstream planner can build both the importer and the views from this doc without having to re-decide product behavior, scope, or what "continuity" means.

---

## Scope Boundaries

- Analytics/trends dashboards (e.g., "is Oscar improving over time," cross-season charts) — deferred to a later iteration; v1 is archival + organized browsing.
- Computed/rendered views of the raw play-by-play logs — the data is archived in v1 but not surfaced.
- Opponent players' individual stat lines — games store the result and the boy's own team's players; opponents stay at game-result level.
- Non-baseball sports.
- Real-time or live-game sync — import happens after a game/season is complete.
- Unattended/automated/scheduled import — every import is a manual, logged-in run.
- Per-user accounts or personalized views — same views for everyone.

---

## Key Decisions

- **Reuse GameChanger's stat engine rather than reimplement it.** Per-game box scores are computed by GameChanger's client-side ("Sabertooth") engine from a raw event log; there is no pre-aggregated per-game REST endpoint. Capturing the engine's rendered output is exact by construction and avoids a high-risk reimplementation (earned runs, fielder's choice, sac flies). Verified live during the brainstorm by extracting a real game's full box score.
- **Trust GameChanger's pre-computed season totals.** The season-stats payload is server-computed and exact; we store it rather than re-summing per-game data ourselves, avoiding derivation drift.
- **Archive the raw play-by-play now, render later.** Storing the event log per game is cheap and is the real "never lose it" guarantee; it future-proofs per-game recomputation without gating v1 on it.
- **Boy-identity exact, teammate-identity best-effort.** Two boy identities are confirmed by hand (zero ambiguity, high stakes); teammate linking is AI-suggested and tolerant of error.
- **Import via reviewed migration, not direct writes.** Matches the repo's read-only-prod / writes-through-migrations rule; keeps every data change auditable in a branch.

---

## Dependencies / Assumptions

- GameChanger's unofficial API (`api.team-manager.gc.com`) and web app remain reachable with a parent login. Auth is a short-lived browser token with refresh; a single login session covers an import run.
- The boys' GameChanger accounts/rosters identify which player entry is Oscar vs. Sebastian on each team (confirmed by Andrew during import).
- Existing Family HQ stack (Next.js app-router route groups, Supabase, sequential SQL migrations) hosts the app and data.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2][Technical] Headless page-capture vs. porting GameChanger's stat-compiler module to Node — which mechanism the importer uses to reuse their engine. Brainstorm recommends page capture for v1; confirm during planning against runtime/robustness.
- [Affects R1, R7][Technical] Data model for storing per-game box scores, season totals, raw event logs, players, teams, and cross-season identity links — including the idempotency key that makes re-import safe.
- [Affects R8, R9][Technical] How identity-match proposals are presented and confirmed in the Claude Code run (in-chat confirmation vs. an editable mapping the migration reads).
- [Affects R12, R14][Design] Exact layout of career/season/game views and the "more stats" affordance.
- [Affects R5][Needs research] Token lifetime vs. backlog import duration — whether one login covers a full ~30-season backfill run or the importer must refresh/re-auth mid-run.
