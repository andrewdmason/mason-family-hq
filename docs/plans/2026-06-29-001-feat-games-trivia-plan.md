---
title: "feat: Games app — host-mode family trivia (game #1)"
type: feat
status: completed
date: 2026-06-29
origin: docs/brainstorms/games-trivia-requirements.md
---

# feat: Games app — host-mode family trivia (game #1)

## Summary

Build a new **Games** route group whose first game is host-mode trivia: a question bank generated on demand by an Anthropic call and gated by an independent adversarial verifier (cloning the `reading/quiz-generate` + `quiz-grade` shape), a client-side turn loop with steal / no-peek / four lifelines, and a once-per-game Bucks payout for the winning kid wired through the existing `bucks_ledger` via a `SECURITY DEFINER` RPC that enforces the daily cap atomically.

---

## Problem Frame

The family wants low-friction fun for in-between moments (the canonical one: the four of them at a restaurant waiting for food), and no off-the-shelf trivia app fits a household spanning a 10-year-old, a 12-year-old, and two adults with a shared reward economy. Full motivation and product shape live in the origin doc (see Sources & References).

---

## Requirements

Traced to `docs/brainstorms/games-trivia-requirements.md` (R-IDs preserved from origin).

- R1. Games is a distinct app in the switcher, visible to all four members; structured to hold multiple games (Trivia is the only one in v1).
- R2–R4. Setup chooses teams (default adult+kid), length (Quick/Standard/target), and optional topic scope.
- R5–R9. Host-mode single-phone play: read-aloud questions, never reveal upcoming answers to the host, rotating spotlight with equal turns, one-directional collaboration, most-points-wins, pausable/abandonable.
- R10–R16. On-demand batch generation by topic/level/type/count; tag topic+level+type+perishability; **no human pre-review**; adversarial AI verification gates questions into the playable pool; failures quarantined and never surfaced; perishable web lookups (deferred mechanism); generation/verification offline from play; in-game "toss this question".
- R17–R19. Question types: MC (backbone), List it, Closest wins.
- R20–R22. Steal, No-peek, and per-team one-use lifelines: 50/50, Parent Assist, 📞 Phone Grandma (~75% right), Double Down.
- R23. Decks avoid recently-seen questions until the relevant pool is exhausted.
- R24–R26. Winning kid +10, other kid +3; daily cap; credited through the Bucks ledger with a `games` source, idempotent per game.

**Origin actors:** A1 Host (adult, also a player — must not see answers), A2 Player–kid, A3 Player–adult (no wallet), A4 Question author (adult), A5 System (generator + verifier, service-role).
**Origin flows:** F1 Play a game (host mode), F2 Generate a question batch, F3 Toss a bad question mid-game.
**Origin acceptance examples:** AE1–AE8 (carried into per-unit test scenarios via `Covers AE<N>` tags).

---

## Scope Boundaries

### Deferred for later

*(carried from origin — product/version sequencing)*

- Other games beyond Trivia (the shell anticipates them; only Trivia ships in v1).
- Question types "Put it in order" and "Odd one out"; picture/flag and name-that-tune (need image/audio assets).
- A second fake friend ("Cousin"); pure open-answer mode; push notifications.
- Re-verification/expiry automation for perishable questions (v1 only *tags* perishability).
- Guest / extra players beyond the family four.

### Outside this product's identity

*(carried from origin — positioning rejection)*

- Adults earning a Bucks currency — Bucks stay kids-only.
- Single-difficulty, generic-bank trivia — per-player targeting and the family-specific bank are the point, not an optional mode.
- Push/mobile notifications for invites or results.

### Deferred to Follow-Up Work

- **Perishable web-search at generation (R14):** ship the perishable *tag* and the generation/verification pipeline now; wire an actual web-lookup source (likely the Anthropic web-search server tool) in a follow-up, since there is no in-repo precedent (see Key Technical Decisions).
- **Full pause/resume across reload:** v1 pause is client-side; resuming an in-progress game after a full reload is a follow-up (the game + deck are persisted at start, so the data exists to add it later).

---

## Context & Research

### Relevant Code and Patterns

- **App scaffolding (R1):** mirror `src/app/(bucks)/` — `src/app/(games)/layout.tsx` (calls `appMetadata("games")`), `src/app/(games)/loading.tsx` (`export { default } from "@/components/layout/page-loading"`). Three registries must stay in sync: `src/lib/pwa/apps.ts` (`PWA_APPS`), `src/components/layout/app-switcher.tsx` (`APPS`), `scripts/generate-icons.mjs` (`APPS`). No per-app middleware gate is needed (any authed user reaches any route except the `/practice` owner-only special case in `src/lib/supabase/middleware.ts`).
- **Role gating (R10 author = adult):** `src/lib/members/auth.ts` — `requireUserId()`, `getIsAdult()`, `requireAdult()`, `getRole()`.
- **Migrations:** `supabase/migrations/00NNN_*.sql`; latest on disk is `00154` → use **`00155`** but reconfirm against `supabase_migrations.schema_migrations` first (shared local DB; siblings can take a number). `text + CHECK(...)` instead of Postgres enums; `update_updated_at_column()` trigger exists; `00153_baseball.sql` is the cleanest recent table example; `00151_mason_bucks.sql` is the `SECURITY DEFINER` RPC + RLS example.
- **Bucks seam (R24–R26):** `src/lib/bucks/earn.ts` (`creditReadingBonus`/`creditEssayBonus` are the helper template), `src/lib/bucks/ledger.ts` (`SOURCE_LABELS`), `src/lib/bucks/types.ts` (`BucksSource`). `bucks_ledger` partial unique index `(source, reference_id) WHERE reference_id IS NOT NULL` → 23505 swallowed as no-op.
- **LLM generate/verify (R10–R13):** central client pattern in `src/lib/journal/anthropic.ts` (singleton, `maxRetries: 5`, `*_MODEL` env default `claude-sonnet-4-6`). Generation: `src/lib/reading/quiz-generate.ts` (forced single tool call, strict `input_schema`, defensive parse, returns failure not throw). Verification: `src/lib/reading/quiz-grade.ts` (independent per-item call, isolated so one failure doesn't fail the batch).
- **Async escape hatch (if generation gets slow):** `src/app/practice/session/api/{process,callback}/route.ts` + Modal worker (`services/practice-alignment/`) — claim→kickoff→callback→poll.
- **Turn-based UI (R5–R9):** `src/components/reading/quiz-runner.tsx` — the closest analog: client component, walks a sequence, hides correctness until resolution, submits via server action.
- **`?member=` scope + identity:** `src/lib/bucks/scope.ts` (`resolveMoneyScope`), `src/lib/bucks/members.ts` (`firstNameFor`).

### Institutional Learnings

(From the auto-memory store; `docs/solutions/` does not exist in this repo.)

- **SECURITY DEFINER lockdown:** `REVOKE ALL ON FUNCTION x(args) FROM PUBLIC, anon, authenticated;` then `GRANT EXECUTE ... TO service_role;` — `GRANT TO service_role` + `REVOKE FROM PUBLIC` alone is insufficient (Supabase grants to anon/authenticated explicitly). Verify via `pg_proc.proacl`.
- **Never `.update().or()`** — misleading 42703; put conditional/atomic UPDATE…WHERE OR logic in a SECURITY DEFINER RPC (pattern: `00116_claim_calendar_source.sql`).
- **Never large `.in()`** — ~1000 ids → HTTP 414 surfaced as silent empty; for the recently-seen filter (R23), filter in SQL or fetch-small-and-filter-in-JS with a `Set`.
- **No unconditional `router.refresh()` on mount** and **`loading.tsx` doesn't re-fire on param-only navs** — hold in-game turn/score/lifeline state client-side; persist to Supabase via explicit actions.
- **Local dev:** `npm run db:heal` self-heals/reloads PostgREST; `npx supabase` SIGKILL → ad-hoc codesign; storage 502 after reset → `docker restart supabase_kong_mason-family-hq`.
- **Testing:** verify via `tsc`/build + a `scripts/verify-*.mts` script (mirror `scripts/verify-bucks-e2e.mts`), not the browser (per `no-browser-testing-default`).

### External References

- None gathered — local patterns are sufficient. R14's web-search mechanism is the one net-new area and is deferred (research the Anthropic web-search server tool at follow-up time).

---

## Key Technical Decisions

- **Level targeting via relative bands, not a grade column (R7):** questions carry `level ∈ {younger_kid, older_kid, adult, all}`. Players map to a band by role + birthdate ordering (younger kid → `younger_kid`, older kid → `older_kid`, adults → `adult`). This self-updates yearly and needs no new `family_members` column (only `birthdate` exists today — verified). The **generator prompt** is enriched with the concrete current grade derived from `birthdate` so content matches curriculum, while the stored tag stays stable.
- **Generation runs inline as an adult-gated server action for v1**, with generate/verify written as **pure libs** (no Supabase/auth) so they can move to the practice-style worker later if web search + per-question verification make batches slow. A `trivia_batches.status` row makes partial progress/failures visible.
- **Adversarial verification gates the pool (R12–R13):** each generated question gets an independent verifier call that answers cold, compares to the proposed answer, and checks ambiguity + distractor quality; only `ready` questions are playable, failures become `quarantined` and are never read back to the host.
- **Payout idempotency + daily cap in one RPC (R24–R26):** a `SECURITY DEFINER` RPC settles a game exactly once, guarded by a `trivia_games.bucks_settled` flag, applying the daily-cap check and inserting both kids' ledger rows. **Two locking gotchas to honor:** (1) the cap is a *household-scoped* invariant, so the advisory lock must be keyed to a **household-stable constant**, NOT `game_id` — two different games settling concurrently would otherwise take different locks, both read "zero paid today," and both pay (the exact double-pay the cap prevents; contrast `00151` which correctly locks per `bucks_balance:user_id` because its guarded quantity is per-user). (2) the global `(source, reference_id)` partial unique index means two `games` rows cannot share `reference_id` — key each kid's ledger `reference_id` to a per-(game,kid) value, not the bare game id. `REVOKE ... FROM PUBLIC, anon, authenticated`.
- **Daily cap = first completed game of the day pays (per household), configurable constant.** Inferred (origin flagged "~1–2 games/day" as a user decision); chosen for simplest anti-farming. The day boundary is **local time (`Pacific/Honolulu`)**, not UTC — the existing Bucks RPCs use bare `now()`, so a naive `created_at::date` would resolve in UTC and let an evening HST game roll into the next UTC day. Pin the boundary explicitly.
- **Score integrity is an explicit accepted non-goal (family-trust model):** turn outcomes are client-summarized, so a determined kid could fabricate a winning score. This is acceptable because a host adult is physically present, it's a single shared device, and the cap limits any exploit to one payout/day. The plan does NOT add server-side score re-derivation in v1. It does add two cheap guards: `endGame`/`tossQuestion` validate that `auth.uid()` is a participant in the target game (no settling someone else's game), and the deck is persisted at start so a later hardening *could* re-derive the winner without a schema change.
- **Phone Grandma is client-side, no AI at call time:** on use, return the correct answer with ~75% probability else a plausible wrong option (MC: an existing distractor; List/Closest: an off value), with a canned phrase. Cheap, deterministic enough, no live LLM latency.
- **Deck persisted at game start; turn outcomes client-side, summarized at end:** assembling the full deck up front means served-question ids exist immediately for the recently-seen filter (R23) even though live turn state stays in the client (per the refresh/loading learnings).

---

## Open Questions

### Resolved During Planning

- *How is "level" represented?* → relative bands tag on questions + birthdate-derived grade in the generator prompt (see Key Decisions). No schema change to `family_members`.
- *Inline vs async generation?* → inline server action for v1; pure libs to allow later promotion.
- *Daily cap shape?* → per-household, first completed game pays; `Pacific/Honolulu` day boundary; household-keyed advisory lock; constant in the RPC.
- *Two ledger rows per game vs the unique index?* → per-(game,kid) `reference_id`; idempotency via settle flag + lock.
- *Score-integrity / can a kid fake a win?* → accepted family-trust non-goal + participant check on `endGame`; no server re-derivation in v1 (see Key Decisions).
- *Gameplay rules (host resolve, steal, no-peek, Double Down, ties, empty pool, pause, lifelines on non-MC, Grandma per type)?* → resolved in `## Game Rules & Interaction Design`.

### Deferred to Implementation

- Exact Anthropic web-search wiring for perishable topics (R14) — follow-up; research the server tool then.
- Final SQL column names, jsonb payload shapes per question type, and index definitions — settle against real code in U2. (Confirm the `trivia_games.teams` jsonb shape lets the RPC resolve "the winning kid"/"the other kid"/tie from stored state.)
- Whether deck assembly needs a lease RPC or a plain service-role write — decide once the recently-seen query is written (use an RPC if any conditional/OR update appears, per the `.or()` learning).
- Whether to add a generation rate-limit (cost guard) — low stakes since adult-gated; revisit if batches are run in tight loops (FYI from review).

---

## Output Structure

    src/app/(games)/
      layout.tsx
      loading.tsx
      apple-icon.png / icon0.svg / icon1.png   (generated by scripts/generate-icons.mjs)
      games/
        page.tsx                      # hub: lists games (Trivia tile)
        trivia/
          page.tsx                    # setup → play entry (server fetch + client runner)
          actions.ts                  # start game, record result/end, toss question
          generate/
            page.tsx                  # adult-gated generator UI + batch list
            actions.ts                # create batch → generate → verify → persist
    src/lib/games/
      anthropic.ts                    # thin re-export of shared client + GAMES_MODEL
      generate.ts                     # pure batch generator (forced tool call)
      verify.ts                       # pure adversarial verifier (per-question)
      deck.ts                         # deck assembly: level map, topic scope, recently-seen
      grandma.ts                      # client-safe fake-friend logic
      types.ts
    src/components/games/
      trivia-runner.tsx               # host-mode turn loop (client)
      trivia-setup.tsx                # teams / length / topics
      question-views/                 # mc / list / closest renderers
    supabase/migrations/00155_games_trivia.sql
    scripts/verify-games-trivia-e2e.mts

---

## Game Rules & Interaction Design

These are the gameplay/UX rules U7 (and parts of U5/U6) implement. They were under-specified in the brainstorm; resolved here so implementers don't invent divergent behavior. **Tunable values are marked `[default]` — change freely.**

### The turn & host-resolve flow (the central interaction)

The host plays, so the answer must stay hidden until the table has committed. Each spotlight turn:
1. **Read** — the prompt shows (for MC, the options show too). Host reads it aloud. Answer is NOT shown.
2. **Commit** — the team answers aloud (or the host taps the option the team chose, for MC).
3. **Reveal** — host taps **Reveal**; the app now shows the correct answer (highlighting the right MC option / the acceptable list items / the target number).
4. **Resolve** — host taps **Got it** or **Missed it**. Reveal *is* the resolution step, so "host never sees the answer before resolution" (R5) holds: the answer appears only once the team has committed.

### Per-type input & resolution

- **MC:** options shown at Read; team picks; Reveal highlights correct; host marks. Lifelines 50/50 and No-peek apply.
- **List it:** has a **timer (`60s [default]`, stored per question)**. Host taps **Start**, then taps each correct item as the team names it; on expiry, score = correct items named (target shown for the bonus). No steal, no 50/50, no No-peek.
- **Closest wins:** both teams enter a number (host types each, or each team taps in); Reveal shows the target; closest team takes the points. No steal, no 50/50, no No-peek.

### Scoring & in-turn mechanics

- **Base:** `1 point [default]` per correct answer, equal across difficulty (R7).
- **Steal:** on a miss, the *other* team gets one shot (MC and Closest only; List-it is per-item so steal is N/A). Steal correct = **half points, rounded down [default]**; steal wrong = nothing, no penalty.
- **No-peek (MC only):** offered before resolution; team answers without relying on the shown options → **2× on correct**. (Options are still visible to the host; this is an honor-mode call the host enforces.)
- **Double Down:** the spotlight team declares it **before Reveal** → **2× on correct, 0 on wrong** ("win or lose" = win double or win nothing — never go negative). One use per team. Applies to MC, Closest, and List-it (doubles the final item score).
- **Multipliers don't stack:** at most one 2× per turn — declaring Double Down disables No-peek for that turn and vice-versa.

### Lifelines (per team, one use each)

- **50/50:** MC only; button hidden on List/Closest. Grandma's wrong-guess (below) is drawn from the *currently visible* options, so a post-50/50 Grandma never points at a removed choice.
- **Parent Assist:** on a kid spotlight, parent-help is visually locked; spending it flips to a "parent's in" state and either parent on the team may confer. (On an adult spotlight, kid-help is always on — no lifeline needed, per the one-directional rule.)
- **📞 Phone Grandma:** client-side, `~75% [default]` correct. MC → returns a visible option (correct 75%, else a plausible visible distractor). Closest → returns a number (the target ±small 75%, else off). List-it → names a few items (mostly correct 75%, else a couple wrong). Always paired with a canned phrase.
- **Double Down:** see Scoring.

### End states

- **Tie:** `[default]` a single sudden-death tiebreaker question (an `adult`/`all`-level `ready` question) to both teams, first-correct wins. If still tied (both right or both wrong), it's a **draw → both kids get the +3 consolation, no +10** (the payout RPC handles the no-winner outcome). Sudden-death itself is a small extra; if descoped, a tie goes straight to the draw rule.
- **Empty pool at setup:** the setup screen shows eligible-question counts per kid/topic; if a kid's level is short, **Start is disabled** with "Generate more questions for [Oscar] on [topic]" linking to the generator (driven by `assembleDeck`'s typed `insufficient` result).
- **Pause:** a Pause control opens a "Paused" overlay with **Resume** and **Abandon**. State is client-held; resuming after a full reload is deferred (Scope Boundaries).
- **Results:** winner banner, final scores, and the Bucks line (awarded amounts, or "played for fun" past the daily cap); the screen's mount triggers `endGame`.

---

## Implementation Units

- U1. **Games app shell + registration**

**Goal:** A new `(games)` route group with a hub page, registered in all three app registries so it appears in the switcher and PWA manifest, visible to all members.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Create: `src/app/(games)/layout.tsx`, `src/app/(games)/loading.tsx`, `src/app/(games)/games/page.tsx`
- Modify: `src/lib/pwa/apps.ts`, `src/components/layout/app-switcher.tsx`, `scripts/generate-icons.mjs`
- Generated: `src/app/(games)/{apple-icon.png,icon0.svg,icon1.png}`, `public/app-icons/*`, `public/app-splash/*` (run `node scripts/generate-icons.mjs`)

**Approach:**
- Copy `(bucks)` layout/loading verbatim, swapping `appMetadata("games")`. Hub page (`export const dynamic = "force-dynamic"`) lists games; v1 renders a single Trivia tile linking to `/games/trivia`.
- Add `games` to `PWA_APPS`, the switcher `APPS` (lucide glyph + description), and the icon-generator `APPS` (glyph + two hex colors); keep keys identical across the three.

**Patterns to follow:** `src/app/(bucks)/layout.tsx`, `src/app/(bucks)/loading.tsx`, `src/lib/pwa/apps.ts` header comment.

**Test scenarios:**
- Test expectation: none — pure scaffolding/registration; covered by `tsc`/build and visual presence in the switcher. **Note: there is NO compile-time guard that the three registries agree** — only the Bucks `SOURCE_LABELS` is a keyed `Record`; the switcher `APPS` and `generate-icons.mjs` `APPS` are plain arrays (this is why `baseball` is already in `PWA_APPS` but missing from the icon generator). Verify by hand that `games` is present in all three lists and that the icon set actually generated.

**Verification:** Build passes; `/games` renders the hub; the app appears in the switcher and `/app-manifest?app=games` resolves.

---

- U2. **Trivia data model + Bucks source (migration 00155)**

**Goal:** All persistent tables for the bank, batches, games, and served-questions log, plus extending `bucks_ledger.source` to allow `games`.

**Requirements:** R10, R11, R13, R23, R26; supports R2–R9, R24–R25

**Dependencies:** None

**Files:**
- Create: `supabase/migrations/00155_games_trivia.sql`
- Modify: `src/lib/bucks/types.ts` (`BucksSource` union + `games`), `src/lib/bucks/ledger.ts` (`SOURCE_LABELS` add `games`)

**Approach:**
- Reconfirm next migration number against `supabase_migrations.schema_migrations` before writing (shared local DB).
- Tables (text+CHECK enums, `update_updated_at_column()` triggers, RLS enabled):
  - `trivia_batches` — topic, level, type, count, status `pending|generating|ready|failed`, created_by_email.
  - `trivia_questions` — batch_id, topic, level `younger_kid|older_kid|adult|all`, type `mc|list|closest`, prompt, `payload jsonb` (mc: options+correct index; list: items+acceptable+target; closest: answer+unit), perishable bool, status `draft|verifying|ready|quarantined|retired`, `verification jsonb` (verdict, notes), created_at.
  - `trivia_games` — teams jsonb, length/target, topic_scope jsonb, status `setup|active|completed|abandoned`, scores jsonb, winner, `bucks_settled bool default false`, started_at/ended_at.
  - `trivia_game_questions` — game_id, question_id, spotlight_user_id, ordinal (the served-deck log; powers R23 recently-seen).
- RLS: family-wide `FOR SELECT USING (auth.uid() IS NOT NULL)` on all four (shared bank), no user write policies (writes via service role / RPC), mirroring `00153_baseball.sql`.
- Add `bucks_ledger_source_check` migration: drop + re-add the CHECK including `games`. Update the TS `BucksSource` union and `SOURCE_LABELS` (`Record<BucksSource,string>` won't compile otherwise).
- Index to support recently-seen: `(question_id)` and a `created_at`/game ordering on `trivia_game_questions`.

**Patterns to follow:** `supabase/migrations/00153_baseball.sql` (tables/RLS), `00151_mason_bucks.sql` (ledger constraint).

**Test scenarios:**
- Happy path: migration applies cleanly on a fresh `db reset`; inserting a `games`-source ledger row succeeds; a second row with a duplicate `(source, reference_id)` raises 23505.
- Edge case: `bucks_ledger` rows with existing sources still satisfy the new CHECK.
- Integration: `tsc` passes after the `BucksSource`/`SOURCE_LABELS` change.

**Verification:** `db reset` applies; `list_tables` shows the four tables with RLS; ledger CHECK accepts `games`.

---

- U3. **Generation + verification libs (pure)**

**Goal:** Pure, Supabase-free functions that generate a question batch for a topic/level/type and independently verify each question, returning a ready/quarantined verdict.

**Requirements:** R10, R12, R13, R14 (tag only), R17–R19

**Dependencies:** None (consumed by U4)

**Files:**
- Create: `src/lib/games/anthropic.ts`, `src/lib/games/generate.ts`, `src/lib/games/verify.ts`, `src/lib/games/types.ts`

**Approach:**
- `anthropic.ts`: **thin re-export** of the shared client (mirror `src/lib/workouts/anthropic.ts`, the inline-app precedent — not the `practice/anthropic.ts` full-singleton, which exists only because practice runs in a worker): `export { anthropic } from "@/lib/journal/anthropic"` + `export const GAMES_MODEL = process.env.GAMES_MODEL ?? JOURNAL_MODEL;`. Reuses the journal client's `maxRetries: 5`.
- `generate.ts`: one forced tool call producing a typed batch; `input_schema` varies by `type` (mc/list/closest). Prompt includes topic, target level band, and the **birthdate-derived current grade** for kid levels so content tracks curriculum. Mark `perishable` for sports/pop-culture topics. Defensive per-field parsing; return `{questions: [], ok: false}` on any error rather than throwing.
- `verify.ts`: per-question independent call (answers cold, compares, checks ambiguity + distractors), returns `{verdict: 'ready'|'quarantine', notes}`. Isolated so one failure doesn't fail the batch.
- Keep both pure so the same code serves the action now and a worker later.

**Patterns to follow:** `src/lib/reading/quiz-generate.ts`, `src/lib/reading/quiz-grade.ts`, `src/lib/journal/anthropic.ts`.

**Test scenarios:**
- Happy path: a well-formed model tool response parses into N typed questions; a verifier "ready" verdict passes through.
- Covers AE5. Edge case: a generated MC whose marked-correct answer is actually wrong → the verifier returns `quarantine`.
- Error path: malformed/empty tool response → `generate` returns an empty failed batch (no throw); a verifier exception on one question quarantines only that question, leaving the rest.
- Edge case: list-type with fewer items than requested still parses; closest-type with a non-numeric answer is rejected by parse.

**Verification:** Unit tests pass against mocked Anthropic responses; functions never throw on bad input.

---

- U4. **Generator UI + batch actions (adult-gated)**

**Goal:** An adult-only screen to generate a batch (topic, level, type, count), run verification, persist `ready`/`quarantined` questions, and review/delete the batch.

**Requirements:** R10, R11, R13, R16 (delete duds), F2

**Dependencies:** U2, U3

**Files:**
- Create: `src/app/(games)/games/trivia/generate/page.tsx`, `src/app/(games)/games/trivia/generate/actions.ts`

**Approach:**
- `requireAdult()` at page + action. Action flow: create `trivia_batches` row (`generating`) → call `generate.ts` → `verify.ts` per question → insert questions with status `ready`/`quarantined` via `createAdminClient()` → set batch `ready`/`failed` → `revalidatePath`.
- Batch list shows counts (ready vs quarantined) and a delete-batch action. Host never sees answer text in a way that would spoil play — the generator is an authoring surface, but note R5 only constrains *play*; the generator legitimately shows answers to the authoring adult (acceptable, since generation is offline from play and the bank is large).

**Patterns to follow:** `src/app/(bucks)/bucks/manage/actions.ts` (adult-gated action shape, admin-client writes, `revalidatePath`).

**Test scenarios:**
- Covers F2. Happy path: an adult generates a 10-question MC batch on "the 13 colonies" → ready questions land queryable as `ready`, quarantined ones as `quarantined`.
- Error path: a non-adult (kid session) calling the action is rejected by `requireAdult()`.
- Edge case: a batch where all questions quarantine → batch marked `failed`, no `ready` questions, surfaced in the list.
- Integration: generated `ready` questions become eligible for deck assembly (U5) immediately.

**Verification:** Generating a batch produces ready/quarantined rows with correct tags; non-adults are blocked.

---

- U5. **Deck assembly + game lifecycle**

**Goal:** Assemble a per-game deck (equal spotlight turns, level-matched, topic-scoped, recently-seen-excluded), persist the game + served-deck at start, and record result/end and toss-question.

**Requirements:** R2–R9, R16, R23, F1, F3

**Dependencies:** U2

**Files:**
- Create: `src/lib/games/deck.ts`, `src/app/(games)/games/trivia/actions.ts`

**Approach:**
- `deck.ts`: given teams, topic scope, length → for each spotlight slot pick a `ready` question matching that player's level band + scope + type variety, excluding recently-seen (query `trivia_game_questions` for the household's last games; filter in SQL or fetch-and-`Set` in JS — never a giant `.in()`).
- **Fallback ladder when a slot can't be filled (the "winnable-for-the-kid" promise is sacred — see Game Rules → Deck fallback):** relax in this order — (1) recently-seen, (2) type variety, (3) topic scope (widen toward `all`). **Never relax a kid's level band.** Adult slots may widen level to `all`. Because a kid's level can't be relaxed, the *pre-start* check (below) must guarantee enough kid-level questions before a game can begin.
- **Pre-start eligibility check returns a typed result, not an exception:** `assembleDeck` returns `{ok: true, deck}` or `{ok: false, reason: 'insufficient', shortfall: {band, topic, needed, available}}` so the setup UI can disable Start and link to the generator (see Game Rules → Empty pool). No throw on an empty pool.
- Player→band map from role + birthdate ordering.
- `actions.ts`: `startGame` (create `trivia_games`, persist deck rows in `trivia_game_questions`, status `active`); `endGame` (validate `auth.uid()` is a participant → write scores/winner-or-tie, status `completed`, then call payout RPC from U6); `tossQuestion` (validate participant; flag the question for re-verification via an RPC if it needs conditional update; no answer revealed; no points); `abandonGame` (status `abandoned`, no payout — a started-but-abandoned game neither pays nor consumes the daily cap).
- Use a SECURITY DEFINER RPC for any conditional/atomic update (toss flag) per the `.or()` learning.

**Patterns to follow:** `src/lib/bucks/scope.ts` (identity/scope), `00116_claim_calendar_source.sql` (conditional RPC).

**Test scenarios:**
- Covers F1. Happy path: starting a Standard game yields a deck giving each player an equal number of spotlight turns at their level band.
- Covers R23. Edge case: questions served in a recent game are excluded; when the matching pool is exhausted, assembly falls back rather than failing.
- Covers AE8. Edge case: abandoning mid-deck sets `abandoned` and triggers no payout.
- Covers F3 / AE6. Happy path: tossing a question flags it for re-verification, returns no points, and does not expose the answer.
- Error path: starting a game with an empty matching pool surfaces a clear "generate more questions" condition, not a crash.

**Verification:** A started game persists a balanced, recently-seen-free deck; toss/abandon behave per AE6/AE8.

---

- U6. **Bucks payout RPC + credit helper**

**Goal:** Settle a completed game's Bucks exactly once, applying the daily cap atomically, crediting the winning kid +10 and the other kid +3 through the ledger.

**Requirements:** R24, R25, R26, AE7

**Dependencies:** U2, U5

**Files:**
- Create: RPC in `supabase/migrations/00155_games_trivia.sql` (same migration as U2) — `award_trivia_win(game_id uuid)`
- Modify: `src/lib/bucks/earn.ts` (add `creditTriviaWin` wrapper calling the RPC)

**Approach:**
- RPC: `SECURITY DEFINER SET search_path = public`; `pg_advisory_xact_lock(hashtext('trivia_payout:household'))` (**household-stable key, not game_id** — see Key Decisions); if `bucks_settled` → return (idempotent); count today's *paying* completed games against the cap constant, with the day boundary in `Pacific/Honolulu` local time; if within cap, resolve the outcome from the game row: on a **clear winning team with a kid**, insert winner (+10) and other-kid (+3) rows; on a **tie / no-winner** outcome, insert the consolation (+3) for *both* kids and no +10 (see Game Rules → Tie). Ledger rows use per-(game,kid) `reference_id` and `source='games'`. Adults get no row. Always set `bucks_settled=true` (even on tie/no-pay-due-to-cap) so the game is never re-evaluated. `REVOKE ALL ON FUNCTION award_trivia_win(uuid) FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role;` (verify `pg_proc.proacl`).
- `creditTriviaWin`: best-effort wrapper (like `creditReadingBonus`) that calls the RPC via `createAdminClient().rpc(...)`. **Swallow ONLY the expected idempotency no-op (`23505`); log every other error — especially a permission error (`42501`/`PGRST301`), which signals the RPC was called with the wrong client and would otherwise be a silent never-pays.** Wired into `endGame` (U5).

**Patterns to follow:** `00151_mason_bucks.sql` `redeem_prize`/`approve_task_claim` (advisory lock, REVOKE), `src/lib/bucks/earn.ts`.

**Test scenarios:**
- Covers AE7. Happy path: first completed win of the day → winner +10, other kid +3 in `bucks_ledger`.
- Covers AE7 / R25. Edge case: a second completed win past the daily cap → no further ledger rows.
- Edge case (idempotency): calling the RPC twice for the same game inserts rows once (`bucks_settled` guard + advisory lock).
- Edge case: an all-adult/no-kid team configuration → no rows (adults have no wallet).
- Edge case (tie): a game ending in a tie → both kids get +3, neither gets +10; `bucks_settled` still set.
- Edge case (concurrent settle): two different completed games settled at the same instant → the household-keyed lock serializes them, so the cap is respected (only the first pays).
- Security: `authenticated`/`anon` cannot EXECUTE the RPC (verify `proacl`); `endGame` rejects a caller who is not a participant in the game.

**Verification:** Ledger reflects exactly one payout per first-of-day game; cap and idempotency hold; RPC is service-role-only.

---

- U7. **Trivia game UI (host mode)**

**Goal:** The client-side host-mode experience: setup → spotlight turn loop with all mechanics → results with Bucks.

**Requirements:** R2–R9, R16, R17–R22, F1, F3

**Dependencies:** U5, U6

**Files:**
- Create: `src/app/(games)/games/trivia/page.tsx`, `src/components/games/trivia-setup.tsx`, `src/components/games/trivia-runner.tsx`, `src/components/games/question-views/{mc,list,closest}.tsx`, `src/lib/games/grandma.ts`

**Approach:**
- Server component fetches available topics + creates nothing until start; setup picks teams (default adult+kid), length, topic scope; `startGame` action assembles+persists deck (U5) and returns it.
- **Implements the full ruleset in `## Game Rules & Interaction Design` above** — the Read→Commit→Reveal→Resolve turn flow, per-type input (MC / List-it timer / Closest number entry), scoring (steal, no-peek, Double Down, no-stacking), lifelines, and all end states (tie, empty pool, pause, results). Build against that section; don't re-derive.
- `trivia-runner.tsx` (client): holds turn index, scores, lifeline-used flags (keyed by team) in local state (per refresh/loading learnings — no route transitions per turn, no unconditional `router.refresh()`). Toss button on every turn (F3). The answer is rendered only at the Reveal step (R5).
- `question-views/{mc,list,closest}.tsx`: each owns its Read/Commit/Reveal rendering per the per-type rules (MC option highlight; List-it timer + tap-to-count; Closest dual number entry + target reveal).
- `grandma.ts`: client-safe; per-type guess at the configured accuracy, drawn from currently-visible options for MC (post-50/50 safe), plus a canned phrase.
- One-directional collaboration is a UI affordance: adult-spotlight turns show "kid can help"; kid-spotlight turns lock parent help unless Parent Assist is spent.
- On deck end (or sudden-death resolution): results screen shows winner/draw; mount calls `endGame` (U5→U6 payout); shows Bucks awarded (or "played for fun" past the cap).

**Patterns to follow:** `src/components/reading/quiz-runner.tsx` (stateful step runner, hidden correctness, action submit), `src/components/ui/*`, Tailwind/serif conventions.

**Test scenarios:**
- Covers AE1. Happy path: a kid spotlight serves a level-band question; parent help is hidden until Parent Assist is spent; a correct answer scores the same as an adult question.
- Covers AE2. Happy path: an adult spotlight shows the kid-can-help affordance with no lifeline spent.
- Covers AE3. Happy path: no-peek + wrong answer → steal offered to the other team for partial points.
- Covers AE4. Edge case: Phone Grandma returns a correct guess ~75% of the time over many calls and is then spent for the game; each lifeline is one-use per team.
- Covers AE6. Happy path: tossing a question advances with no points and no answer reveal.
- Edge case: Double Down → 2× on correct, 0 on wrong; declaring it disables No-peek for that turn (no 4× stack).
- Edge case: a tie at deck end → sudden-death question; a persistent tie → draw (both kids consolation, no winner banner).
- Edge case: a List-it timer expiry scores the items named so far; Closest-wins awards the nearer number.
- Edge case: 50/50 and No-peek buttons are absent on List/Closest turns; a post-50/50 Grandma guess only names a still-visible option.
- Edge case: setup with a kid-level shortfall disables Start and links to the generator (no crash).
- State: refreshing/param-only nav mid-game does not reset turn state (state is client-held); Pause overlay offers Resume/Abandon.

**Verification:** A full game plays start→finish on one device with all mechanics; host never sees an unresolved answer; results trigger payout.

---

- U8. **End-to-end verify script**

**Goal:** A scripted, browserless E2E proving the pipeline: generate → verify → assemble deck → simulate a game → payout + cap.

**Requirements:** Success criteria; guards R10–R13, R23, R24–R26

**Dependencies:** U2–U6

**Files:**
- Create: `scripts/verify-games-trivia-e2e.mts`

**Approach:** Mirror `scripts/verify-bucks-e2e.mts`: seed a batch (or mock generation), run verification, assemble a deck (assert balance + recently-seen exclusion across two runs), simulate a completed game, assert ledger rows for first-of-day, then assert no rows past the cap and idempotency on re-settle.

**Patterns to follow:** `scripts/verify-bucks-e2e.mts`.

**Test scenarios:**
- Covers AE7. Asserts payout amounts, cap, and idempotency end-to-end.
- Covers R23. Asserts the second assembled deck excludes the first deck's questions.

**Verification:** `npm run` of the script exits 0 with all assertions passing against local Supabase.

---

## System-Wide Impact

- **Interaction graph:** new app touches three app registries (U1), the `bucks_ledger` CHECK + TS union (U2), and the Bucks earn helpers (U6). No existing flows change behavior.
- **Error propagation:** generation/verification failures quarantine questions and never reach play; payout is best-effort (never rolls back a completed game), mirroring existing earn helpers.
- **State lifecycle risks:** double-settle prevented by `bucks_settled` + advisory lock; deck served-log written at start so recently-seen is correct even on abandon; two-rows-per-game vs the `(source, reference_id)` unique index handled by per-(game,kid) reference.
- **API surface parity:** `BucksSource` union, `SOURCE_LABELS`, and the DB CHECK must all gain `games` together (compile-enforced for the TS pair).
- **Integration coverage:** U8 covers the cross-layer generate→play→payout path that mocks alone won't prove.
- **Unchanged invariants:** existing ledger sources, balances, and the partial unique index semantics are preserved; Bucks remain kids-only.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| AI generates wrong "correct" answers reaching the table | Adversarial verifier gates the pool (U3); in-game toss (U5/U7); host never pre-reads during play (R5). **Residual: verifier and generator share a model family, so a shared blind spot can pass both** — toss + perishable tagging are the real backstop; treat the verifier as "catches most," not "catches all." |
| Perishable sports facts go stale / hallucinate | Tag `perishable` now; defer web-lookup wiring (R14) but isolate the seam in `generate.ts`. |
| Double-pay or cap bypass on Bucks | Single RPC with **household-keyed** advisory lock + settle flag + REVOKE lockdown; per-(game,kid) reference; `Pacific/Honolulu` day boundary; U6/U8 assert idempotency + cap (incl. concurrent-settle). |
| Kid fabricates a winning score (client-side outcomes) | Accepted family-trust non-goal (host present, single device, 1 payout/day cap); cheap guards: participant check on `endGame`, deck persisted for later re-derivation if ever needed. |
| Migration number collision (shared local DB) | Reconfirm against `schema_migrations`; `npm run db:heal`. |
| In-game skeleton flash / state reset | Hold turn state client-side; no unconditional `router.refresh()`; no per-turn route transitions. |
| Generation latency if web search added later | Libs are pure → promote to the practice-style Modal worker without rewrite. |

---

## Documentation / Operational Notes

- New env var: `GAMES_MODEL` (optional, defaults to `claude-sonnet-4-6`); reuses existing `ANTHROPIC_API_KEY`.
- After build, run `node scripts/generate-icons.mjs` for the Games icon set.
- Worth capturing in the auto-memory store post-build (per `/ce-compound`): the trivia generate/verify pipeline and any eventual web-lookup decision (net-new for this repo).

---

## Sources & References

- **Origin document:** [docs/brainstorms/games-trivia-requirements.md](docs/brainstorms/games-trivia-requirements.md)
- Related code: `src/lib/reading/quiz-generate.ts`, `src/lib/reading/quiz-grade.ts`, `src/lib/bucks/earn.ts`, `src/lib/bucks/ledger.ts`, `supabase/migrations/00151_mason_bucks.sql`, `supabase/migrations/00153_baseball.sql`, `src/components/reading/quiz-runner.tsx`, `src/lib/pwa/apps.ts`, `scripts/verify-bucks-e2e.mts`
- External docs: Anthropic web-search server tool (to research at R14 follow-up)
