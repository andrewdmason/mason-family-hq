---
title: "feat: Mason Bucks app"
type: feat
status: completed
date: 2026-06-25
origin: docs/brainstorms/mason-bucks-requirements.md
---

# feat: Mason Bucks app

## Summary

Build a new `(bucks)` app at `/bucks` that turns the reader's threshold-based reward milestones into a per-kid currency. A single append-only ledger holds every earn and spend; balance is `SUM(amount)`. Bucks are earned from reading bonus pages (1:1, hooked into the existing advance choke point), qualifying journal entries (5 on first close past a word/time gate), and adult-defined earning tasks (kid claims → adult approves). Bucks are spent on prizes (migrated from `reading_milestones`) via atomic balance-guarded RPCs. A data migration converts milestones to prizes and seeds each kid's opening balance from their lifetime bonus pages. Pending claims and unfulfilled redemptions surface in the existing header bell.

---

## Problem Frame

The reader app rewards kids through one narrow mechanism — milestones that unlock when cumulative *bonus pages* cross a threshold — which is reading-only, all-or-nothing, and has no notion of spending. The family wants one legible currency consolidating every way to earn (reading, journaling, board games, Summer Bridge) and a lightweight adult approve/grant loop for human-verified tasks. See origin: `docs/brainstorms/mason-bucks-requirements.md`.

---

## Requirements

- R1. Single per-kid balance computed from an append-only transaction ledger; balance never directly editable.
- R2. Each transaction records kid, signed amount, source, related entity reference, acting adult (where applicable), timestamp.
- R3. Home screen shows balance, ways to earn, available prizes with prices, and reverse-chron history; kids see own, adults browsing a kid (via `?member=`) see that kid's.
- R4. Reading bonus pages credit 1:1 at advance time; old bonus-page milestone-threshold check removed.
- R5. Journal entry grants 5 Bucks once on first close, only if ≥150 kid-authored words AND ≥5 min wall-clock (start→close).
- R6. Journal grant idempotent per entry; failed-gate entries re-evaluated on later close.
- R7. Adult creates earning tasks: title, Buck value, unit label, repeatable-vs-one-time, audience (one kid or shared).
- R8. Kid claims a task with a quantity (default 1); claim pending until adult acts; shows computed Bucks.
- R9. Adult approves/rejects a pending claim; approval credits value×quantity; any adult resolves; resolution clears for all.
- R10. One-time task auto-archives on first approved grant; archived tasks not claimable.
- R11. Seed tasks: "Play a family board game" = 20/game (repeatable, shared); "Summer Bridge workbook" = 5/page (repeatable, shared).
- R12. Adult creates prizes: title, price, optional image, audience (one kid or shared); prizes archivable; archived hidden from kids.
- R13. Kid redeems an affordable available prize; immediate debit + spend transaction.
- R14. Adult can redeem a prize on a kid's behalf (same effect).
- R15. Each redemption creates an adult fulfillment reminder; any adult marks fulfilled; fulfillment does not gate/reverse the debit.
- R16. Each `reading_milestones` row migrates to a prize: title, image, per-kid scope carry over; `threshold`→price 1:1.
- R17. Each kid's opening balance = 1:1 sum of lifetime bonus pages, represented as an opening transaction; no deductions.
- R18. Mason Bucks is a distinct app in the switcher, available to kids and adults.
- R19. Reader stops presenting milestone progress as the reward surface; keeps a lightweight "Bucks earned" nudge linking to `/bucks`.
- R20. Pending claims and unfulfilled redemptions surface in the existing computed-on-render header bell for all adults.

**Origin actors:** A1 (Kid), A2 (Adult — owner/parent), A3 (System automation)
**Origin flows:** F1 (manual task claim), F2 (journal auto-grant), F3 (reading auto-grant), F4 (redeem prize)
**Origin acceptance examples:** AE1–AE7 (see origin)

---

## Scope Boundaries

- Push/mobile notifications — in-app bell only.
- Parental veto before redemption — redemptions are instant; adults control via prize creation/pricing/archiving.
- Spending caps, allowances, interest, scheduled/recurring auto-grants for tasks.
- Buck transfers/gifting between kids.
- Editing/reversing historical transactions through the UI (an `adjustment` source type exists in the ledger for future manual corrections, but no UI ships in v1).
- Changing how reading bonus pages are *calculated* — only how they're rewarded.

### Deferred to Follow-Up Work

- Capturing the Mason Bucks ledger/RLS/approval-queue decisions as a `docs/solutions/` or auto-memory note (repo's first reusable currency/approval pattern) — after this lands.

---

## Context & Research

### Relevant Code and Patterns

- **Ledger + milestone blueprint (copy almost verbatim):** `supabase/migrations/00148_reading_bonus_and_milestones.sql`, `src/lib/reading/bonus.ts` (`recordAdvanceAndCheckMilestones`, `bonusForAdvance`), `src/lib/reading/milestones.ts` (`loadAdvanceLedger`, `sumFromLedger`, `signedMilestoneImageUrl`).
- **Reading credit choke point:** `recordAdvanceAndCheckMilestones` in `src/lib/reading/bonus.ts` inserts the `reading_stretch_advances` row; called only via `advanceStretch()` in `src/lib/reading/advance.ts`, itself called from `src/app/(reading)/reader/actions.ts` and `src/app/(reading)/reader/quizzes/actions.ts`. Best-effort (log-and-swallow), writes nothing when amount is 0.
- **Scope pattern:** `resolveReadingScope` in `src/lib/reading/scope.ts` (self vs owner-acting-as-kid via `?member=`); `requireUserId`/`getIsOwner`/`requireOwner` in `src/lib/members/auth.ts`; clients `src/lib/supabase/server.ts` (RLS) and `src/lib/supabase/admin.ts` (service role).
- **Journal close paths + gate data:** `src/app/(journal)/journal/actions.ts` — `closeEntry()` (~line 937) and inline closes (~lines 557, 693) set `closed_at`. Start = `journal_entries.freeform_started_at` (migration `00042_journal_freeform.sql`) or earliest `journal_messages.created_at`. Kid words = `journal_messages` where `role='user'` (migration `00034_journal.sql`). No existing word-count logic.
- **Notification bell:** `src/components/layout/global-header.tsx` aggregates `JournalNotification[]` sources via `Promise.all` + `.catch(() => [])`; cross-kid sources owner-gated (`getReadingMilestoneNotifications` in `src/lib/reading/milestone-notifications.ts`, `getTodoNotifications` in `src/lib/todos/notifications.ts`). Shape `{ id, title, reason, href }` in `src/lib/types.ts`.
- **App registration (4 lists to keep in sync):** `src/components/layout/app-switcher.tsx` (`APPS`), `src/lib/pwa/apps.ts` (`PWA_APPS`), `scripts/generate-icons.mjs` (`APPS`), layout `appMetadata("<key>")`. Group examples: `src/app/(reading)/layout.tsx`, `src/app/(todos)/`.
- **UI to mirror:** `src/components/reading/reading-progress-header.tsx` (balance + rewards), `src/components/reading/milestone-admin.tsx` (adult console w/ image upload), `src/components/reading/progress-bar.tsx`, `src/components/reading/member-view-switcher.tsx`, `src/components/todos/task-list.tsx`. UI primitives in `src/components/ui/`.
- **Atomic check-and-set precedent:** `supabase/migrations/00116_claim_calendar_source.sql` + `claimSource` (RPC pattern).

### Institutional Learnings

- **Migration numbers collide across Conductor workspaces** (`shared-local-supabase.md`): one local DB is shared; a sibling may already hold `00150`. Query `supabase_migrations.schema_migrations` for the real high-water mark before numbering. `npm run db:heal` re-applies missing migrations.
- **`.or()` on UPDATE/DELETE throws a misleading 42703** (`postgrest-or-on-mutation.md`): use a `SECURITY DEFINER` RPC for any conditional/check-and-set write.
- **Large `.in()` lists 414 → silently empty** (`postgrest-large-in-414.md`): compute balances via SQL `SUM`/RPC, never by pulling the ledger and `.in()`-ing.
- **Revalidation traps** (`sync-on-load-skeleton-flash.md`, `nextjs-sibling-nav-loading.md`): don't `router.refresh()` unconditionally; for multi-tab nav use `useLinkStatus()` pending highlight; Todos "instant view switching" is the multi-tab reference.
- **Verify via tsc/build, not browser** (`no-browser-testing-default.md`); never bind port 3000 — use `npm run dev:agent`.

---

## Key Technical Decisions

- **Single signed-amount ledger (`bucks_ledger`), balance = `SUM(amount)`:** mirrors `reading_stretch_advances`; one table for all sources (earn positive, spend negative) keeps history trivially unifiable for R3 and avoids a separate balance column that could drift (R1).
- **Idempotency via `UNIQUE (source, reference_id)`:** every ledger row points at its originating event (advance id, journal entry id, claim id, redemption id, or kid id for the opening seed). A partial unique index makes reading/journal grants safe against the known double-call risk in `advanceStretch` and journal reopen/reclose (R4, R6) without key-juggling in app code.
- **Conditional writes via `SECURITY DEFINER` RPCs** (`redeem_prize`, `approve_task_claim`, `reject_task_claim`, plus `bucks_balance`): balance guard ("debit only if `SUM(amount) >= price`") and "approve only if still pending" must be atomic against a growing append-only ledger — and `.update().or()` is broken in this repo. RPCs sidestep both.
- **Earning-task audience as nullable `audience_user_id`** (null = shared/both): one column expresses per-kid vs shared for both tasks and prizes, matching the milestone per-kid pattern (R7, R12).
- **Snapshot value/price at claim/redeem time** (`bucks_task_claims.unit_value`, `bucks_redemptions.price`): an approval or fulfillment must pay/charge what was shown when the kid acted, even if the adult later edits the task/prize (R8, R13).
- **Opening balance as a single `migration`-source ledger row per kid** (`reference_id = kid user_id`): one idempotent lump credit = lifetime `SUM(bonus_pages)`; going-forward advances credit individually. Avoids double-counting and renders as one clean "Starting balance" history line (R17).
- **Reader milestone rows kept dormant, not dropped:** the data migration *copies* `reading_milestones` → `bucks_prizes` and stops surfacing the originals; no destructive `DROP`. Reversible and low-risk (R16, R19).
- **Reuse the milestone signing pattern for prize images:** server signs URLs via service role for all prizes (incl. shared), so storage-read RLS isn't the gate. (Exact bucket choice in Open Questions.)
- **App is family-wide visible** (kids + adults in the switcher); adult-only actions are gated *within* the app by `requireOwner`/parent-role, not by hiding the app (R18).

---

## Open Questions

### Resolved During Planning

- **Reading credit hook point?** → Inside `recordAdvanceAndCheckMilestones` (`src/lib/reading/bonus.ts`), after the advance insert, keyed to the returned advance id. Single choke point; remove the milestone-threshold check there.
- **Are journal gates computable from existing data?** → Yes. Wall-clock from `freeform_started_at`/first user message → `closed_at`; word count computed on close from `role='user'` messages. No schema change required.
- **`total_pages` milestones?** → Schema allows them; migration takes `threshold` as price regardless of metric, so no metric-specific handling needed (R16).
- **Where do claims/redemptions live for the bell?** → New tables with status fields + owner-gated `getBucks*Notifications` functions spliced into `global-header.tsx` (R20). No persistent notifications table.

### Deferred to Implementation

- **Migration number(s):** allocate the next free numbers after verifying `supabase_migrations.schema_migrations` (siblings may hold `00150`). Plan assumes `00150` (schema/RPC) and `00151` (data migration + seed) but confirm at write time.
- **Prize image storage bucket:** reuse the existing `reading-milestones` bucket (migrated paths resolve unchanged, new uploads append) vs. a fresh `bucks-prizes` bucket. Lean reuse to avoid copying objects; confirm folder/path scheme for shared (non-per-kid) prizes during implementation.
- **Journal close consolidation:** whether to call the award helper at each of the ~3 close sites or refactor them through one shared close routine. Resolve when touching `src/app/(journal)/journal/actions.ts`.
- **Exact journal editor component** hosting the live word/time progress indicator (R5 nudge) — locate under `src/components/journal/` during U8.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
                         bucks_ledger  (append-only, signed amount)
   earn/spend events ───────────────────────────────────────────► balance = SUM(amount) per kid
        ▲            UNIQUE(source, reference_id) = idempotency
        │
  ┌─────┴───────────────────────────────────────────────────────────────────┐
  │ source='reading'    reading advance insert → +bonus_pages   (auto, U5)    │
  │ source='journal'    entry first close, gate passed → +5      (auto, U5)   │
  │ source='task'       claim approved → +unit_value×qty   (RPC, U2/U4)       │
  │ source='redemption' prize redeemed → −price            (RPC, U2/U4)      │
  │ source='migration'  opening seed → +SUM(bonus_pages)   (backfill, U3)    │
  └──────────────────────────────────────────────────────────────────────────┘

  bucks_earning_tasks ──< bucks_task_claims (pending→approved/rejected) ─┐
  bucks_prizes        ──< bucks_redemptions (unfulfilled→fulfilled) ─────┤
                                                                          ▼
                            owner-gated getBucks*Notifications → global-header bell
```

---

## Output Structure

    src/app/(bucks)/
      layout.tsx
      loading.tsx
      apple-icon.png
      icon0.svg
      icon1.png
      bucks/
        page.tsx              # kid/family wallet: balance, ways to earn, prizes, history
        actions.ts           # claim, redeem, loaders
        manage/
          page.tsx           # adult console: tasks, prizes, approvals, redeem-on-behalf
          actions.ts         # create/archive task & prize, approve/reject, fulfill
    src/lib/bucks/
      scope.ts               # resolveMoneyScope (clone of reading/scope.ts)
      ledger.ts              # balance + history loaders (SQL SUM / RPC)
      tasks.ts               # task + claim queries
      prizes.ts              # prize + redemption queries, signed image URLs
      earn.ts                # reading + journal grant helpers (called by hooks)
      notifications.ts       # getBucksClaimNotifications, getBucksRedemptionNotifications
    src/components/bucks/
      wallet-header.tsx      # mirrors reading-progress-header
      prize-list.tsx
      earn-list.tsx
      claim-dialog.tsx
      bucks-admin.tsx        # mirrors milestone-admin
    supabase/migrations/
      00150_mason_bucks.sql          # tables, RLS, indexes, RPCs (+ bucket if new)
      00151_mason_bucks_migration.sql # milestones→prizes, opening balances, seed tasks

---

## Implementation Units

Grouped into three phases: **data foundation** (U1–U3), **server logic & hooks** (U4–U6), **UI** (U7–U8).

### Phase 1 — Data foundation

- U1. **Schema migration: tables, RLS, indexes**

**Goal:** Create the five Mason Bucks tables with the house RLS contract.

**Requirements:** R1, R2, R7, R8, R12, R13, R15

**Dependencies:** None

**Files:**
- Create: `supabase/migrations/00150_mason_bucks.sql` (tables portion)

**Approach:**
- `bucks_ledger`: `id`, `user_id`→`auth.users ON DELETE CASCADE`, `amount int NOT NULL` (signed), `source text CHECK IN ('reading','journal','task','redemption','migration','adjustment')`, `reference_id uuid`, `note text`, `created_by_email text REFERENCES family_members(email) ON UPDATE CASCADE` (nullable), `created_at`. Partial `UNIQUE (source, reference_id) WHERE reference_id IS NOT NULL`. Index `(user_id)`.
- `bucks_earning_tasks`: `id`, `title`, `unit_value int CHECK >0`, `unit_label text`, `is_one_time boolean DEFAULT false`, `audience_user_id uuid REFERENCES auth.users(id)` (null = shared), `archived_at`, `created_by_email`, `created_at`, `updated_at`.
- `bucks_task_claims`: `id`, `task_id`→tasks, `user_id` (claiming kid), `quantity int CHECK >0 DEFAULT 1`, `unit_value int` (snapshot), `status text CHECK IN ('pending','approved','rejected') DEFAULT 'pending'`, `claimed_at`, `resolved_at`, `resolved_by_email`.
- `bucks_prizes`: `id`, `title`, `price int CHECK >0`, `image_path text`, `audience_user_id uuid` (null = shared), `archived_at`, `created_by_email`, `created_at`, `updated_at`.
- `bucks_redemptions`: `id`, `prize_id`→prizes, `user_id` (kid), `price int` (snapshot), `status text CHECK IN ('unfulfilled','fulfilled') DEFAULT 'unfulfilled'`, `redeemed_by_email`, `redeemed_at`, `fulfilled_at`, `fulfilled_by_email`.
- RLS: kids `FOR SELECT USING (user_id = auth.uid())` on ledger/claims/redemptions; tasks & prizes readable by any member (`auth.uid() IS NOT NULL`) but filtered to non-archived + audience in app. **No user INSERT/UPDATE/DELETE policies** — all writes via service role / RPC. `updated_at` triggers on mutable tables (`update_updated_at_column`).

**Patterns to follow:** `supabase/migrations/00148_reading_bonus_and_milestones.sql` (ledger + SELECT-own RLS), `00129_todos_core.sql` (family-access RLS, email FK `ON UPDATE CASCADE`), `00135_drive_logistics.sql` (status `CHECK`).

**Test scenarios:**
- Happy path: migration applies cleanly on a fresh local DB (`npm run db:heal` / reset); all five tables present with expected columns and constraints.
- Edge case: inserting a second ledger row with the same `(source, reference_id)` is rejected by the unique index; `reference_id IS NULL` rows (adjustments) are allowed to repeat.
- Edge case: `amount` accepts negative values (spends); `unit_value`/`price`/`quantity` reject ≤0.
- Integration: a kid session (RLS client) can `SELECT` only their own ledger/claims/redemptions rows and cannot `INSERT`/`UPDATE` any Mason Bucks table.

**Verification:** Schema applies; RLS denies kid writes and cross-kid reads; constraints enforce the invariants above.

---

- U2. **Atomic RPCs: balance, redeem, approve/reject**

**Goal:** `SECURITY DEFINER` functions for every guarded write + balance read.

**Requirements:** R1, R9, R10, R13, R14

**Dependencies:** U1

**Files:**
- Modify: `supabase/migrations/00150_mason_bucks.sql` (RPC portion)

**Approach:**
- `bucks_balance(p_user_id uuid) returns int` — `SELECT COALESCE(SUM(amount),0)`.
- `redeem_prize(p_prize_id, p_user_id, p_actor_email) returns ...` — in one tx: lock/verify prize not archived and audience matches `p_user_id`; check `bucks_balance(p_user_id) >= price`; insert `bucks_redemptions` (snapshot price, status `unfulfilled`); insert `bucks_ledger` (`source='redemption'`, `reference_id=redemption.id`, `amount = -price`). Raise on archived/insufficient/audience-mismatch.
- `approve_task_claim(p_claim_id, p_actor_email)` — verify claim `pending`; set `approved` + `resolved_at`/`resolved_by_email`; insert ledger (`source='task'`, `reference_id=claim.id`, `amount = unit_value*quantity`); if task `is_one_time`, set its `archived_at`. All-or-nothing.
- `reject_task_claim(p_claim_id, p_actor_email)` — verify `pending`; set `rejected`; no ledger row.
- Grant `EXECUTE` appropriately; functions enforce their own guards (callers still gate by role in the action layer).

**Patterns to follow:** `supabase/migrations/00116_claim_calendar_source.sql` (`SECURITY DEFINER` check-and-set); learning `postgrest-or-on-mutation.md`.

**Test scenarios:**
- Happy path: kid with balance 600 redeems a 500 prize → redemption row created, ledger −500, `bucks_balance` returns 100.
- Covers AE5. Redemption immediately drops balance and creates an unfulfilled redemption.
- Covers AE6. Error path: balance 300, prize 500 → `redeem_prize` raises (insufficient); no rows written.
- Error path: redeeming an archived prize, or a per-kid prize for the wrong kid → raises; no rows.
- Edge case: two concurrent `redeem_prize` calls for a kid who can only afford one → exactly one succeeds, balance never goes negative.
- Covers AE3. `approve_task_claim` on a pending Summer Bridge claim (qty 8, unit_value 5) → ledger +40, claim `approved`.
- Edge case: approving an already-resolved claim → raises / no-op; no duplicate ledger row.
- Covers AE4. Approving the first claim on a one-time task sets the task's `archived_at`.

**Verification:** RPCs are atomic; balance can never go negative; resolved claims can't be re-approved; one-time tasks archive on first grant.

---

- U3. **Data migration: milestones→prizes, opening balances, seed tasks**

**Goal:** Convert existing reward data and seed the two starter earning tasks; retire milestone surfacing without dropping anything.

**Requirements:** R11, R16, R17

**Dependencies:** U1

**Files:**
- Create: `supabase/migrations/00151_mason_bucks_migration.sql`

**Approach:**
- Insert one `bucks_prizes` per `reading_milestones` row: `title`, `price = threshold`, `image_path`, `audience_user_id = user_id`, `created_by_email`, `archived_at = CASE WHEN awarded_at IS NOT NULL THEN now() ELSE NULL END` (no awarded rows expected, but safe).
- Opening balance: for each kid with advances, insert one `bucks_ledger` row `source='migration'`, `reference_id = user_id`, `amount = SUM(bonus_pages)`, `note='Starting balance from reading'`. The `(source, reference_id)` unique index makes re-runs safe.
- Seed `bucks_earning_tasks`: "Play a family board game" (`unit_value=20`, `unit_label='game'`, shared); "Summer Bridge workbook" (`unit_value=5`, `unit_label='page'`, shared).
- Do **not** drop `reading_milestones`/`reading_stretch_advances`; they remain as the historical source. (Reading-side surfacing removed in U8.)

**Patterns to follow:** `supabase/migrations/00148...` (ledger shape); idempotent insert via unique index.

**Test scenarios:**
- Covers AE7. A kid with a 500-page milestone and 420 lifetime bonus pages → a 500-price prize exists and opening balance = 420.
- Happy path: each pre-existing milestone yields exactly one prize with `price = threshold` and the same image/per-kid scope.
- Edge case: a kid with zero advances gets no opening ledger row (balance 0), not a spurious +0 row.
- Edge case: re-running the migration (sibling re-apply) does not duplicate opening-balance rows (unique `(source, reference_id)`).
- Integration: after migration, `bucks_balance(kid)` equals that kid's `SUM(bonus_pages)`.

**Verification:** Prizes mirror milestones 1:1; opening balances equal lifetime bonus pages; seed tasks present; migration is idempotent and non-destructive.

---

### Phase 2 — Server logic & hooks

- U4. **Core lib + scope + server actions**

**Goal:** Data-access layer and all server actions (kid claim/redeem; adult create/archive/approve/reject/fulfill/redeem-on-behalf), plus balance/history/prize/task loaders.

**Requirements:** R1, R2, R3, R7, R8, R9, R12, R13, R14, R15

**Dependencies:** U1, U2

**Files:**
- Create: `src/lib/bucks/scope.ts`, `src/lib/bucks/ledger.ts`, `src/lib/bucks/tasks.ts`, `src/lib/bucks/prizes.ts`
- Create: `src/app/(bucks)/bucks/actions.ts`, `src/app/(bucks)/bucks/manage/actions.ts`
- Test: `src/lib/bucks/__tests__/ledger.test.ts` (or repo's test location/convention)

**Approach:**
- `resolveMoneyScope(memberEmail?)` cloned from `src/lib/reading/scope.ts` (self vs owner-acting-as-kid; admin client filters every query by trusted `userId`).
- `ledger.ts`: `getBalance(userId)` via `bucks_balance` RPC; `getHistory(userId)` returns reverse-chron rows with human source labels. Never `.in()` over the ledger.
- `prizes.ts`: list available prizes for a kid (non-archived, audience matches), `signedPrizeImageUrl` (mirror `signedMilestoneImageUrl`), redemption queries.
- `tasks.ts`: list active tasks for a kid, claim queries.
- Kid actions: `claimTask(taskId, quantity)` (snapshots `unit_value`, status `pending`), `redeemPrize(prizeId)` → `redeem_prize` RPC.
- Adult actions (gate `requireOwner` or parent-role): `createTask`/`archiveTask`, `createPrize`/`archivePrize` (+ image upload-url signing like `milestone-actions.ts`), `approveClaim`/`rejectClaim` → RPCs, `fulfillRedemption(redemptionId)`, `redeemForKid(prizeId, memberEmail)` → `redeem_prize` with kid scope.
- Best-effort + revalidate per app convention (gate `router.refresh()`/`revalidatePath` on real change per `sync-on-load-skeleton-flash.md`).

**Patterns to follow:** `src/app/(reading)/reader/quizzes/milestone-actions.ts` (action shape, image upload, `requireOwner`), `src/lib/reading/scope.ts`, `src/lib/reading/milestones.ts`.

**Test scenarios:**
- Happy path: `claimTask` creates a pending claim snapshotting `unit_value`; later task edits don't change the pending claim's payout.
- Covers AE3. `claimTask` on shared Summer Bridge with qty 8 → pending claim worth 40.
- Error path: kid calls an adult action (`createPrize`, `approveClaim`) → rejected by role gate.
- Error path: `redeemPrize` for an unaffordable/archived/wrong-audience prize → surfaces the RPC error to the UI without a partial write.
- Integration: `redeemForKid` by an adult (member scope) debits the correct kid's balance.
- Integration: `getHistory` returns earns and spends in reverse-chron with correct source labels and signed amounts.

**Verification:** Every origin action (claim, redeem, approve, reject, fulfill, redeem-on-behalf, create/archive) works end-to-end against the RPCs with correct scoping and role gates.

---

- U5. **Earning hooks: reading + journal**

**Goal:** Auto-credit Bucks at the reading advance choke point and on qualifying journal close; remove the old reading milestone-threshold check.

**Requirements:** R4, R5, R6

**Dependencies:** U1

**Files:**
- Create: `src/lib/bucks/earn.ts` (`creditReadingBonus`, `awardJournalEntryBucks`)
- Modify: `src/lib/reading/bonus.ts` (`recordAdvanceAndCheckMilestones`)
- Modify: `src/app/(journal)/journal/actions.ts` (close paths)

**Approach:**
- Reading: capture the inserted advance row id; if `bonus_pages > 0`, insert `bucks_ledger` (`source='reading'`, `reference_id = advance.id`, `amount = bonus_pages`) via service role, best-effort. Remove the milestone load/sum/stamp block from this function (milestones retired). Unique index prevents the double-call double-credit.
- Journal: `awardJournalEntryBucks(entryId)` called at every close site — computes start (`freeform_started_at` ?? earliest user message `created_at`) → `closed_at`/now elapsed, and kid word count (`role='user'` message content `.split(/\s+/)` filtered for non-empty). If `words >= 150 && elapsedSec >= 300` and no existing `(source='journal', reference_id=entryId)` row, insert +5. Best-effort; idempotent.

**Execution note:** Add the journal-grant integration test first (close-with-gate behavior is the load-bearing contract and easy to get subtly wrong on reopen/reclose).

**Patterns to follow:** `src/lib/reading/bonus.ts` (best-effort service-role write at a single choke point).

**Test scenarios:**
- Happy path: an advance with 12 bonus pages writes one `+12` reading ledger row.
- Edge case: an advance with 0 bonus pages writes nothing; a duplicate `advanceStretch` call for the same advance does not double-credit (unique index).
- Covers AE1. Journal entry with 180 kid words over 7 min → +5 on first close; reopen + reclose → no second grant.
- Covers AE2. Journal entry with 90 words in 6 min → no grant; entry still saves; closing again later after edits to 200 words/6 min → grant fires (re-evaluation).
- Edge case: word count counts only `role='user'` content, excluding assistant messages; elapsed uses the correct start source for both freeform and question-based entries.
- Edge case: a ledger/credit failure does not roll back the advance or the journal close (best-effort).

**Verification:** Bonus pages credit 1:1 with no double-counts; journal grants exactly once per qualifying entry; old milestone stamping no longer runs.

---

- U6. **Notification bell sources**

**Goal:** Surface pending claims and unfulfilled redemptions to adults in the existing header bell.

**Requirements:** R20

**Dependencies:** U1

**Files:**
- Create: `src/lib/bucks/notifications.ts`
- Modify: `src/components/layout/global-header.tsx`

**Approach:**
- `getBucksClaimNotifications(supabase)` — owner/parent-gated; service-role read of `bucks_task_claims` where `status='pending'`; map to `{ id: 'claim:'+id, title, reason: '<kid> claimed <task> (<qty>) — <bucks> Bucks', href: '/bucks/manage' }`.
- `getBucksRedemptionNotifications(supabase)` — gated; `bucks_redemptions` where `status='unfulfilled'`; map to `{ id: 'redeem:'+id, ..., href: '/bucks/manage' }`.
- Splice both into the `Promise.all` + items array in `global-header.tsx`, each wrapped in `.catch(() => [])`.

**Patterns to follow:** `src/lib/reading/milestone-notifications.ts`, `src/lib/todos/notifications.ts`, `src/components/layout/global-header.tsx`.

**Test scenarios:**
- Happy path: a pending claim and an unfulfilled redemption each produce one bell item for an adult; count increments accordingly.
- Edge case: a non-adult (kid) session gets no Mason Bucks bell items.
- Edge case: approving a claim / fulfilling a redemption removes its bell item on next render (no read-receipt table).
- Integration: a thrown error in one Mason Bucks source (`.catch`) does not break the header or other sources.

**Verification:** Adults see pending claims + unfulfilled redemptions in the bell; items clear when resolved; kids see none.

---

### Phase 3 — UI

- U7. **App scaffold + wallet + admin UI**

**Goal:** Stand up the `(bucks)` app and its two surfaces — kid/family wallet and adult console.

**Requirements:** R3, R7, R8, R9, R12, R13, R14, R15, R18

**Dependencies:** U4 (and U2/U6 transitively)

**Files:**
- Create: `src/app/(bucks)/layout.tsx`, `src/app/(bucks)/loading.tsx`, `src/app/(bucks)/apple-icon.png`, `src/app/(bucks)/icon0.svg`, `src/app/(bucks)/icon1.png`
- Create: `src/app/(bucks)/bucks/page.tsx`, `src/app/(bucks)/bucks/manage/page.tsx`
- Create: `src/components/bucks/wallet-header.tsx`, `prize-list.tsx`, `earn-list.tsx`, `claim-dialog.tsx`, `bucks-admin.tsx`
- Modify: `src/components/layout/app-switcher.tsx`, `src/lib/pwa/apps.ts`, `scripts/generate-icons.mjs`

**Approach:**
- Register the app in all four lists (`APPS`, `PWA_APPS`, `generate-icons.mjs` with group `(bucks)`, layout `appMetadata("bucks")`); run icon generation. Pick a `lucide-react` coin/wallet icon.
- Wallet page (`/bucks`): balance (mirror `reading-progress-header.tsx` counter), ways-to-earn list (reading/journal explainer + claimable tasks with unit labels), available prizes with prices and redeem buttons (disabled when unaffordable per AE6), and reverse-chron history. Reads `searchParams: { member? }` and resolves via `resolveMoneyScope`; include `member-view-switcher` for owner.
- Claim dialog: quantity input (default 1), shows computed Bucks before submit.
- Admin (`/bucks/manage`, parent-gated): create/archive earning tasks and prizes (image upload like `milestone-admin.tsx`), pending-claims approval queue (approve/reject), unfulfilled-redemptions list (mark fulfilled), and redeem-on-behalf.
- Multi-tab feedback per `nextjs-sibling-nav-loading.md` if tabs are used.

**Patterns to follow:** `src/app/(reading)/layout.tsx`, `src/app/(todos)/todos/page.tsx`, `src/components/reading/reading-progress-header.tsx`, `src/components/reading/milestone-admin.tsx`, `src/components/reading/member-view-switcher.tsx`.

**Test scenarios:**
- Covers AE6. A prize priced above balance renders visible but non-redeemable.
- Happy path: kid sees balance, earn options, available prizes, and history scoped to themselves; owner with `?member=` sees that kid's.
- Edge case: archived tasks/prizes and prizes for the other kid do not appear in a kid's lists.
- Integration: claiming via the dialog creates a pending claim and (separately) shows up in an adult's approval queue + bell (with U6).
- Integration: an adult redeem-on-behalf debits the right kid and appears in their history.
- Test expectation: layout/icon/registration files — none (scaffolding/config); covered by the app loading and appearing in the switcher.

**Verification:** App appears in the switcher for kids and adults; wallet and admin surfaces work end-to-end; scoping and affordability behave per AEs.

---

- U8. **Retire reader milestone UI + journal live-progress nudge**

**Goal:** Remove the reader's milestone reward surfaces, add a "Bucks earned" nudge linking to `/bucks`, and show kids live progress toward the journal gate.

**Requirements:** R5, R19

**Dependencies:** U3 (data migrated), U5 (journal grant logic)

**Files:**
- Modify: `src/components/reading/reading-progress-header.tsx` (or its render site `src/app/(reading)/reader/page.tsx`)
- Modify: `src/app/(reading)/reader/quizzes/page.tsx` (remove `MilestoneAdmin` section)
- Modify: the journal editor component under `src/components/journal/` (live indicator)

**Approach:**
- Reader: stop rendering milestone progress; replace the bonus-pages milestone block with a compact "X Bucks earned from reading → Mason Bucks" nudge linking to `/bucks`. Remove the `MilestoneAdmin` section from `/reader/quizzes` (leave milestone-actions code/table dormant; no deletion).
- Journal: add a live "words / 150 · m:ss / 5:00 — keep going to earn 5 Bucks" indicator in the editor, counting the kid's own words and elapsed wall-clock; purely presentational hint mirroring the server gate in U5.

**Patterns to follow:** existing reader header/nudge styling; `progress-bar.tsx`.

**Test scenarios:**
- Happy path: reader home no longer shows milestone rows; shows the Bucks nudge linking to `/bucks`.
- Happy path: `/reader/quizzes` no longer renders the milestone admin.
- Edge case: the journal indicator turns "complete" exactly at 150 words AND 5:00, matching the server-side grant boundary (no off-by-one vs U5).
- Integration: closing a journal entry that the indicator marked complete results in a +5 ledger row (U5).

**Verification:** No milestone reward UI remains in reader; the nudge links correctly; the journal indicator accurately previews the gate.

---

## System-Wide Impact

- **Interaction graph:** `recordAdvanceAndCheckMilestones` (reading) and journal close paths gain Mason Bucks side-effects; `global-header.tsx` gains two bell sources. All are best-effort and additive.
- **Error propagation:** earning credits and notification reads are wrapped (log-and-swallow / `.catch(() => [])`) so a Mason Bucks failure never breaks reading, journaling, or the header. Guarded writes (redeem/approve) propagate RPC errors to the UI as user-facing failures with no partial state.
- **State lifecycle risks:** double-credit (mitigated by `UNIQUE (source, reference_id)`); negative balance (mitigated by atomic `redeem_prize` guard); re-running the data migration (mitigated by the same unique index on the opening seed).
- **API surface parity:** `resolveMoneyScope` mirrors `resolveReadingScope`; if/when the agent API (Norbert) should reach Mason Bucks, that's a separate follow-up, not in this plan.
- **Integration coverage:** claim→approve→ledger→bell and redeem→debit→bell→fulfill chains need integration tests (mocks alone won't prove the RPC + ledger + notification wiring).
- **Unchanged invariants:** reading advance/bonus *calculation* is untouched (only a credit side-effect added and the milestone-stamp removed); `reading_milestones`/`reading_stretch_advances` tables remain as historical record; journal entry content/flow unchanged except the close-time grant.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Migration number collision with a sibling Conductor workspace | Verify `supabase_migrations.schema_migrations` high-water mark before numbering; `npm run db:heal` to re-sync |
| Double-crediting from the known `advanceStretch` double-call or journal reopen/reclose | `UNIQUE (source, reference_id)` partial index; idempotent grant helpers |
| Race on concurrent redemptions driving balance negative | Atomic `SECURITY DEFINER redeem_prize` with in-tx balance check |
| `.update().or()` 42703 trap on conditional writes | All check-and-set logic lives in RPCs, never supabase-js conditional updates |
| Balance/history queries degrading as the ledger grows | Balance via `SUM` RPC; never `.in()` over the ledger (`postgrest-large-in-414.md`) |
| Journal "time spent" defined as wall-clock may be gameable (open then idle) | Accepted for v1 per origin; wall-clock + 150-word gate is the agreed bar |
| Removing milestone stamping could orphan in-flight reading reward expectations | No awarded milestones exist (confirmed); data migration copies all milestones to prizes before UI removal |

---

## Documentation / Operational Notes

- After landing, capture the ledger/RLS/approval-queue pattern as an auto-memory/`docs/solutions` note (first reusable currency/approval pattern in the repo).
- Verify via `tsc`/lint/`build` and any `scripts/verify-*.mts`; do not browser-test unless asked; never bind port 3000 (`npm run dev:agent`).
- The data migration is non-destructive (no `DROP`); rollback = stop surfacing the new app and ignore the new tables.

---

## Sources & References

- **Origin document:** [docs/brainstorms/mason-bucks-requirements.md](docs/brainstorms/mason-bucks-requirements.md)
- Reading blueprint: `supabase/migrations/00148_reading_bonus_and_milestones.sql`, `src/lib/reading/bonus.ts`, `src/lib/reading/milestones.ts`, `src/lib/reading/scope.ts`
- Notification bell: `src/components/layout/global-header.tsx`, `src/lib/reading/milestone-notifications.ts`
- App registration: `src/components/layout/app-switcher.tsx`, `src/lib/pwa/apps.ts`, `scripts/generate-icons.mjs`
- Atomic RPC precedent: `supabase/migrations/00116_claim_calendar_source.sql`
- Learnings: `shared-local-supabase.md`, `postgrest-or-on-mutation.md`, `postgrest-large-in-414.md`, `sync-on-load-skeleton-flash.md`, `nextjs-sibling-nav-loading.md`, `no-browser-testing-default.md`
