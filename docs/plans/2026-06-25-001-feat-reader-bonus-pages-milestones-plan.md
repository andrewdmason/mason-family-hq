---
title: "feat: Reader bonus pages + parent milestones"
type: feat
status: completed
date: 2026-06-25
---

# feat: Reader bonus pages + parent milestones

## Summary

Let kids read beyond their weekly goal and bank the extra as **bonus pages**. At quiz time a kid declares the page they actually reached (floor = their normal weekly target, ceiling = the book's last page); the stretch quiz regenerates to cover the wider range, and **passing it** credits the bonus to a lifetime running total shown on the reader home. Parents define per-kid **milestones** (a page threshold on bonus *or* total pages, a title, an uploaded reward image, and an optional start date) from the existing Parent Admin console; the nearest milestone and its progress are always visible on the kid's dashboard, and reaching one notifies the parent and waits for an explicit "mark as awarded."

---

## Problem Frame

Today a kid's weekly page goal is an owner-set ceiling: the per-book target is `current_page + weekly_page_goal`, advancement is quiz-gated, and there's no upside to reading *past* the target — the extra pages just disappear into next week's baseline. There's nothing that recognizes or rewards above-and-beyond effort, and no way for a parent to attach a real-world reward ("a baseball bat at 1,000 pages") to sustained extra reading. This feature adds the recognition layer (bonus pages) and the reward layer (milestones) on top of the existing stretch/quiz machinery.

---

## Requirements

- R1. A kid can declare, at quiz time, that they read past their weekly target — up to the book's last page, down to no lower than their normal weekly target.
- R2. Declaring a higher page regenerates the stretch quiz to cover the wider range before the kid takes it, with an honest "building your quiz…" state.
- R3. Bonus pages are credited **only when the covering quiz is passed** (real pass or parent override), never on declaration or check-in alone.
- R4. Bonus pages accumulate into a per-kid lifetime running total, displayed prominently on the reader home.
- R5. An in-flight declared stretch carries across the weekly boundary until passed (no forfeiture); the default target reverts to the normal weekly goal only after the stretch is closed.
- R6. A parent can create, from Parent Admin, per-kid milestones with: metric (bonus pages or total pages), page threshold, title, an uploaded image, and an optional start date (default = all-time).
- R7. The milestone creation form previews the kid's current count for the chosen metric + start date, so the threshold can be calibrated.
- R8. Multiple milestones can be active per kid in parallel; the dashboard features the closest-to-completion one with a progress bar and lists the rest compactly.
- R9. Reaching a milestone celebrates for the kid, notifies the parent, and flips the milestone to an "Achieved — awarded?" state that the parent retires with an explicit "Mark as awarded."

**Origin actors:** Oscar / Sebastian (kid readers, A-kid), Andrew/Jenny (owner/parent, A-owner)
**Origin flows:** F1 declare-and-pass-bonus, F2 parent-create-milestone, F3 milestone-reached → award

---

## Scope Boundaries

- No sibling leaderboard or cross-kid comparison UI. Kids aren't blocked from seeing each other (no strict privacy requirement), but no comparison surface is built.
- No automatic/real rewards (allowance, points store). Milestones are recognition + an explicit real-world handoff the parent fulfills.
- No change to the owner-set weekly goal mechanism or to who can set it. The kid can only declare *above* their goal on the current stretch; they never edit `reading_settings`.
- No strict "one bonus per calendar week" counter (see Open Questions — the natural one-active-stretch cadence approximates it).
- Articles (`type = 'article'`) are out of scope for the declare-page flow; bonus mechanics target paginated books with a weekly target.

### Deferred to Follow-Up Work

- Tuning the exact essay-difficulty scaling for large bonus ranges (see Key Technical Decisions): ship a simple `min_words` scale, refine later.
- Milestone reward "claimed" history view / past-rewards gallery: v1 retires awarded milestones from the dashboard; a history surface is a later iteration.

---

## Context & Research

### Relevant Code and Patterns

- **Stretch advance choke point** — `src/lib/reading/advance.ts` (`advanceStretch`): the single function every advance path funnels through (quiz pass, parent override, no-content direct advance). It already computes `newCurrent`, fetches `increment` via `readingIncrement`, and logs a check-in. This is where the bonus ledger row and milestone-crossing check belong.
- **Advance callers** — `submitQuiz` and `closeQuizWithoutPassing` in `src/app/(reading)/reader/quizzes/actions.ts`; `markTargetReached` in `src/app/(reading)/reader/actions.ts`. All pass a `StretchBook` + optional `reachedPage` to `advanceStretch`.
- **Quiz (re)generation** — `src/lib/reading/ensure-stretch-quiz.ts` (`ensureStretchQuiz`): idempotent by exact `(book, from_page, through_page)` range, publishes immediately, and calls `archiveOtherOpenQuizzes` (`src/lib/reading/supersede.ts`) to retire other open quizzes. A new `through_page` naturally produces a fresh quiz and retires the old one. Generation goes through `generateEssayAssignments` (`src/lib/reading/quiz-generate.ts`); reader age / `min_words` come from `src/lib/reading/reader-context.ts`.
- **Target math** — `src/lib/reading/targets.ts` (`defaultTargetPage`, `capTarget`); due-date in `src/lib/reading/target-due.ts`.
- **Declare-page entry point (UI)** — `src/components/reading/mark-reached-button.tsx` calls `markTargetReached(bookId)` (binary today). This is where the "how far did you get?" dialog hooks in.
- **Reader home data + render** — `getReadingHome` in `src/app/(reading)/reader/actions.ts` returns `ReadingHome`; rendered by `src/app/(reading)/reader/page.tsx` → `src/components/reading/reading-list.tsx`. `ReadingHome`/types live in `src/lib/types.ts`.
- **Parent Admin** — `getReadingAdmin` in `src/app/(reading)/reader/quizzes/actions.ts`, rendered by `src/app/(reading)/reader/quizzes/page.tsx`. Owner-gated via `requireOwner` (`src/lib/members/auth.ts`).
- **Scope helper** — `src/lib/reading/scope.ts` (`resolveReadingScope`): self mode (RLS client) vs owner member-mode (admin client scoped to the kid's `userId`). Every milestone/ledger read & write uses this.
- **Image upload pattern to mirror** — `createBookUploadUrl` in `src/app/(reading)/reader/actions.ts` (signs a user-scoped path, uses admin client in member mode); bucket defined like `reading-books` (migration `00083`). Journal photos (`00043`, `src/lib/journal/photo-upload.ts`) show the original+display downscale pattern if a thumbnail is wanted.
- **Quiz success moment** — `src/components/reading/quiz-success-modal.tsx`: the natural place for a milestone-reached celebration.

### Institutional Learnings

- `docs/solutions/` is empty — no prior learnings to apply.
- Memory note (project): supabase-js `.or()` on UPDATE/DELETE throws a misleading `42703` — not relevant here (no `.or()` mutations planned), but keep mutations simple `.eq()`-filtered.
- Shared local Supabase across Conductor workspaces — migration numbers can collide; pick the next free numbers (`00148`, `00149`) and be ready to re-apply via psql + PostgREST reload locally.

### External References

- None required. The feature follows established in-repo patterns (RLS own-rows tables, scope helper, signed-upload buckets, computed notifications); no external API or framework research adds value.

---

## Key Technical Decisions

- **Append-only ledger written inside `advanceStretch`** (`reading_stretch_advances`): one row per real advance, capturing `pages_advanced`, `bonus_pages`, and `advanced_on`. Rationale: `advanceStretch` is the single choke point all three advance paths share, the advance is already guarded against double-counting (`throughPage > current_page`), and a dated ledger is what makes both metrics *and* milestone "start date" filtering a simple `SUM … WHERE advanced_on >= start_on`. Deriving bonus retroactively from quiz history would be fragile.
- **Bonus formula:** `bonus_pages = clamp(newCurrent − (oldCurrent + increment), 0, pages_advanced)`, and `0` when `increment <= 0` (no goal = no baseline = no bonus). `oldCurrent + increment` is the normal target for the stretch; anything beyond it is bonus, never more than the pages actually advanced.
- **Declare-page reuses the existing target + quiz machinery.** Bumping the target sets `target_page` to the declared page (kept *unlocked* — it's the kid's declaration, not an owner override) and calls `ensureStretchQuiz` at the new `through_page`; idempotency + `archiveOtherOpenQuizzes` handle retiring the old quiz and avoiding dupes. No new quiz tables.
- **Weekly reset is implicit, not coded.** On a pass, `advanceStretch` already sets the next `target_page = newCurrent + increment` (back to the normal goal) and a fresh Friday due date. A declared, unpassed stretch simply persists (R5) — no forfeiture logic needed.
- **Milestones are per-kid rows (`user_id`) with own-rows SELECT RLS; all writes go through the owner's service-role member-mode path** (mirrors `reading_settings`/`reading_books`). The kid's dashboard reads its own milestones; the owner creates/edits via `resolveReadingScope(memberEmail)` behind `requireOwner`.
- **Milestone-reached detection lives in `advanceStretch`,** right after the ledger write: recompute the kid's active-milestone progress and stamp `achieved_at` on any newly crossed. Keeps "reached" exactly synchronized with the only event that can move a counter.
- **Parent notification is a computed source, not a stored notification.** The app has no persistent notifications table (the bell merges computed journal + todo sources). Add a `getReadingMilestoneNotifications(supabase, userId)` source that surfaces, to the owner, milestones with `achieved_at` set and `awarded_at` null — merged into the bell like the others.
- **Bonus-quiz rigor via `min_words` scaling (essay quizzes).** The quiz model is essay-based (candidate prompts → one chosen essay scored out of 1), so "more questions" doesn't map. Instead, scale the essay's `min_words` modestly with the declared range so a big bonus stretch demands a more substantial response. Exact curve is a tuning detail (deferred).
- **New private bucket `reading-milestones`,** user-scoped path `{user_id}/{milestone_id}.{ext}`, signed-upload mirroring `createBookUploadUrl` (admin client in member mode). A single display image per milestone; no original/display split needed (reward photos are small and shown at one size).

---

## Open Questions

### Resolved During Planning

- **One bonus per week — enforce a hard cap?** Not in v1. A kid has one active stretch/quiz per book at a time, so the cadence naturally approximates "one bump per week"; a fast reader who passes and bumps again is genuinely reading more and should be rewarded. Revisit only if it's gamed.
- **Does a parent override (`closeQuizWithoutPassing`) bank bonus?** Yes — it routes through `advanceStretch`, so it credits whatever range it settled, consistent with treating an override as a granted pass.
- **Where does the declared page get clamped?** Floor = `defaultTargetPage(current_page, increment, total)` (the normal target); ceiling = `total_pages`. Below-target declarations are rejected/clamped to the floor; the kid can dial down to the floor but not below.

### Deferred to Implementation

- Exact `min_words` scaling curve for bonus range — pick a simple linear-with-cap during implementation and eyeball it against a real generated essay.
- Whether the dashboard bonus counter animates on increment or just renders the new total — decide when building the component; both satisfy R4.
- Precise copy for the declare-page dialog and the milestone celebration.

---

## Implementation Units

- U1. **Schema: bonus ledger + milestones tables**

**Goal:** Persist the bonus/total-pages ledger and per-kid milestones.

**Requirements:** R3, R4, R6, R8, R9

**Files:**
- Create: `supabase/migrations/00148_reading_bonus_and_milestones.sql`

**Approach:**
- `reading_stretch_advances`: `id`, `user_id` (FK auth.users, ON DELETE CASCADE), `book_id` (FK reading_books, ON DELETE CASCADE), `quiz_id` (FK reading_quizzes, nullable, ON DELETE SET NULL — no-content advances have none), `pages_advanced int NOT NULL`, `bonus_pages int NOT NULL DEFAULT 0`, `advanced_on date NOT NULL`, `created_at`. Index `(user_id, advanced_on)`. Own-rows RLS (`user_id = auth.uid()`) so a kid can read their own totals; owner writes via service role.
- `reading_milestones`: `id`, `user_id` (FK auth.users, ON DELETE CASCADE), `created_by_email text NOT NULL`, `title text NOT NULL`, `metric text NOT NULL CHECK (metric IN ('bonus_pages','total_pages')) DEFAULT 'bonus_pages'`, `threshold int NOT NULL CHECK (threshold > 0)`, `image_path text`, `start_on date` (null = all-time), `achieved_at timestamptz`, `awarded_at timestamptz`, `created_at`, `updated_at` (+ `update_updated_at_column` trigger). Index `(user_id)`. RLS: own-rows SELECT for the kid; writes go through the owner's service-role path (no user-session INSERT/UPDATE policy, mirroring `reading_settings`).
- Mirror the exact RLS/trigger idioms from `00073_reading.sql` and `00089_reading_book_targets.sql`.

**Patterns to follow:** `supabase/migrations/00073_reading.sql`, `00089_reading_book_targets.sql`.

**Test scenarios:**
- Happy path: migration applies cleanly on a fresh DB; both tables exist with expected columns, checks, and indexes.
- Edge case: `metric` outside the allowed set is rejected by the CHECK; `threshold <= 0` is rejected.
- Integration: deleting a `reading_books` row cascades its `reading_stretch_advances`; deleting a quiz nulls `quiz_id` rather than deleting the advance.
- Integration: a kid session can `SELECT` its own milestone/ledger rows and cannot select another user's (RLS).

**Verification:** Local `supabase` reset applies the migration; a manual `SELECT` as a kid role returns only own rows.

---

- U2. **Storage: milestone reward image bucket + signed upload**

**Goal:** Let the owner upload a per-milestone reward image.

**Requirements:** R6

**Files:**
- Create: `supabase/migrations/00149_reading_milestones_bucket.sql`
- Modify: `src/lib/reading/constants.ts` (add `READING_MILESTONES_BUCKET`)
- Modify: `src/app/(reading)/reader/quizzes/actions.ts` (add `createMilestoneImageUploadUrl`)

**Approach:**
- Private bucket `reading-milestones`, image MIME types, modest size limit (~10 MB). User-scoped RLS policies on `storage.objects` keyed on `(storage.foldername(name))[1] = auth.uid()::text`, mirroring the `reading-books` bucket policies in `00083`.
- `createMilestoneImageUploadUrl(milestoneId, ext, memberEmail)`: owner-gated; verify the milestone belongs to the scoped kid; build path `${userId}/${milestoneId}.${ext}`; sign via admin client in member mode (owner uploads land in the kid's folder, which a user-session policy would reject) exactly as `createBookUploadUrl` does. Return `{ path, token }`.
- The path is stored on the milestone row by U6's create/update action.

**Patterns to follow:** `createBookUploadUrl` + `READING_BOOKS_BUCKET` (`src/app/(reading)/reader/actions.ts`, `src/lib/reading/constants.ts`), bucket policies in `supabase/migrations/00083_reading_books_content.sql`.

**Test scenarios:**
- Happy path: owner requests an upload URL for a kid's milestone → returns a path under `{kidUserId}/`.
- Error path: a non-owner caller is rejected (`requireOwner`).
- Error path: requesting a URL for a milestone that isn't the scoped kid's throws "not found".
- Integration: signed URL accepts an upload and the object is readable back by the owning kid's session (RLS).

**Verification:** A test upload via the signed URL succeeds and the object appears under the kid's folder.

---

- U3. **Ledger + milestone crossing inside `advanceStretch`**

**Goal:** Record bonus/total pages and flip newly-reached milestones on every advance.

**Requirements:** R3, R4, R9

**Files:**
- Modify: `src/lib/reading/advance.ts`
- Create: `src/lib/reading/bonus.ts` (pure bonus math + a `recordAdvanceAndCheckMilestones` helper)
- Create: `src/lib/reading/bonus.test.ts`

**Approach:**
- Pure helper `bonusForAdvance(oldCurrent, newCurrent, increment)` → `clamp(newCurrent − (oldCurrent + increment), 0, newCurrent − oldCurrent)`, `0` when `increment <= 0`. Unit-test this in isolation.
- In `advanceStretch`, after the book update + check-in (it already has `oldCurrent = book.current_page`, `newCurrent`, `increment`), insert a `reading_stretch_advances` row (`pages_advanced = newCurrent − oldCurrent`, `bonus_pages`, `advanced_on = today`, `quiz_id` when known). Thread an optional `quizId` param into `advanceStretch` from the quiz-pass callers.
- Then recompute the kid's active milestones (`achieved_at IS NULL`): for each, sum the relevant metric from the ledger (`bonus_pages` or `pages_advanced`, filtered by `start_on`); if `sum >= threshold`, set `achieved_at = now()`. Use the scope's `client`/`userId`.
- Keep it best-effort-safe: a ledger/milestone failure must not roll back the advance the kid earned — log and continue (mirror `ensureStretchQuizInline`'s swallow-and-log posture), but do the ledger insert before the milestone check.

**Patterns to follow:** existing `advanceStretch` body; `ensureStretchQuizInline` error-swallowing style.

**Test scenarios:**
- Happy path (`bonus.test.ts`): old 0, new 80, increment 50 → bonus 30; old 0, new 50, increment 50 → 0; increment 0 → 0; new < old+increment → 0; bonus never exceeds pages advanced.
- Edge case: advance that finishes a book near the end (target capped at total) → bonus reflects pages beyond normal target but not beyond total.
- Integration: passing a declared-80 quiz writes one ledger row with `bonus_pages = 30` and advances `current_page` to 80.
- Integration: a milestone with threshold 100 (bonus_pages) flips `achieved_at` exactly on the advance that pushes the cumulative bonus to ≥100, and not before.
- Integration: a `total_pages` milestone with `start_on = today` counts only advances on/after today.
- Edge case: re-passing an already-passed stretch (no `current_page` change) writes no ledger row (guarded upstream) — assert no duplicate.

**Verification:** After a simulated bonus pass, `reading_stretch_advances` has the expected row and the crossing milestone shows `achieved_at`.

---

- U4. **Declare-page server flow + quiz regeneration**

**Goal:** Let a kid set the page they actually reached, regenerating the stretch quiz to the new range.

**Requirements:** R1, R2, R3, R5

**Files:**
- Modify: `src/app/(reading)/reader/actions.ts` (`markTargetReached`; add `setReachedPageAndQuiz` or extend the signature with an optional `reachedPage`)
- Modify: `src/lib/reading/advance.ts` (accept `quizId` param — paired with U3)

**Approach:**
- New/extended action `markTargetReached(bookId, memberEmail, reachedPage?)`:
  - Resolve scope + book; compute `floor = defaultTargetPage(current_page, increment, total)` and `ceiling = total_pages ?? reachedPage`. Clamp `reachedPage` into `[floor, ceiling]`. If `reachedPage` is omitted, behave exactly as today (binary, target = existing `target_page`).
  - If `reachedPage > current target_page`: update the book's `target_page = reachedPage` (leave `target_locked = false`) and `target_due` per existing rules.
  - **Content books:** call `ensureStretchQuizInline` at `through = reachedPage` (idempotency + `archiveOtherOpenQuizzes` retire the prior quiz); return `{ outcome: "quiz", quizId }`. If generation isn't ready, return `{ outcome: "quiz_pending" }` (existing).
  - **No-content books:** call `advanceStretch(scope, stretchBook, reachedPage)` directly (bonus recorded in U3) → `{ outcome: "advanced", ... }`.
- Carry-over (R5) needs no code: a higher unpassed `target_page` simply persists; the pass path already resets to the normal goal afterward.

**Execution note:** Add an integration test for the declare → regenerate → pass → bonus path first; it pins the contract across `markTargetReached`, `ensureStretchQuiz`, and `advanceStretch`.

**Patterns to follow:** existing `markTargetReached` branching; `updateBook`'s target/due handling.

**Test scenarios:**
- Happy path: content book at page 0, goal 50, declare 80 → target becomes 80, a new published quiz covers `through_page = 80`, the old 50-quiz is archived, returns the new `quizId`.
- Edge case: declare below floor → clamped up to the normal target (no bonus possible).
- Edge case: declare above `total_pages` → clamped to the last page.
- Edge case: declare equal to current target → no regeneration, routes to the existing active quiz (no churn).
- Integration (no-content book): declare 80 advances directly and records bonus, no quiz created.
- Error path: book not found / not the scoped user → throws.

**Verification:** Declaring a higher page yields a single live quiz at the new range and, on pass, the bonus appears in the ledger.

---

- U5. **Reader-home data: bonus total + milestone progress; dashboard UI**

**Goal:** Surface the lifetime bonus counter and active milestones on the reader home.

**Requirements:** R4, R8

**Files:**
- Modify: `src/app/(reading)/reader/actions.ts` (`getReadingHome` → add `bonusPagesTotal` and `milestones`)
- Modify: `src/lib/types.ts` (extend `ReadingHome`; add `MilestoneProgress` type)
- Create: `src/lib/reading/milestones.ts` (shared progress computation: sum ledger per metric/start_on, derive `current`, `reached`, pick the nearest)
- Create: `src/components/reading/reading-progress-header.tsx` (bonus counter + featured milestone card + compact list)
- Modify: `src/app/(reading)/reader/page.tsx` and/or `src/components/reading/reading-list.tsx` (render the header)
- Create: `src/lib/reading/milestones.test.ts`

**Approach:**
- `getReadingHome` additionally: `bonusPagesTotal = SUM(bonus_pages)` from the ledger for the scoped `userId`; load the kid's milestones where `awarded_at IS NULL`, compute each one's `current` via the shared helper, mark `reached = current >= threshold`, and sort so the **closest-to-completion not-yet-reached** milestone is featured (reached-but-not-awarded ones sort to the celebratory top).
- `MilestoneProgress`: `{ id, title, metric, threshold, current, imageUrl, reached, awarded }`. Resolve `image_path` → a short-lived signed URL (or public URL) for display.
- Header component: big lifetime bonus number (R4), then the featured milestone with a progress bar and reward image, then a compact list of any others (R8). Reached-but-unawarded shows an "Achieved 🎉" treatment.
- Works in owner member-view (the switcher) too, since it reads through the same scope.

**Patterns to follow:** `getReadingHome` aggregate style; `ReadingList` props threading; signed-URL usage in `getBookReaderData`.

**Test scenarios:**
- Happy path (`milestones.test.ts`): given ledger rows and a milestone set, the helper returns correct `current`, `reached`, and nearest-selection ordering.
- Edge case: no milestones → header shows the bonus counter only, no card.
- Edge case: `start_on` excludes older ledger rows from `current`.
- Edge case: all milestones awarded → none shown; bonus counter still renders.
- Integration: a kid with bonus history sees the right total; the owner viewing-as that kid sees the same numbers.

**Verification:** Reader home renders the bonus total and the nearest milestone with an accurate progress bar.

---

- U6. **Parent Admin: milestone CRUD + image upload + count preview + mark-awarded**

**Goal:** Full milestone management for each kid in the Parent Admin console.

**Requirements:** R6, R7, R8, R9

**Files:**
- Modify: `src/app/(reading)/reader/quizzes/actions.ts` (add `getReadingMilestonesForAdmin`, `createMilestone`, `updateMilestone`, `deleteMilestone`, `markMilestoneAwarded`, `previewMilestoneCount`; `createMilestoneImageUploadUrl` from U2)
- Modify: `src/app/(reading)/reader/quizzes/page.tsx` (render a per-kid milestones section)
- Create: `src/components/reading/milestone-admin.tsx` (list + create/edit form with image upload, metric/threshold/start-date fields, live count preview, mark-awarded)
- Modify: `src/lib/types.ts` (admin milestone view model)

**Approach:**
- All actions owner-gated (`requireOwner`) and scoped via `resolveReadingScope(memberEmail)` so the row's `user_id` is the kid's.
- `previewMilestoneCount(memberEmail, metric, startOn)` → returns the kid's current count for that metric+start (uses the shared `milestones.ts` helper) so the form can show "Oscar has 240 bonus pages since all time" before the threshold is set (R7).
- `createMilestone` inserts the row (image optional — the client signs + uploads via U2 after getting the new id, then `updateMilestone` sets `image_path`; or create with a client-generated id so the image can upload first). Choose the order during implementation; either satisfies R6.
- `markMilestoneAwarded` sets `awarded_at = now()` (retires it from the dashboard, R9). `deleteMilestone` removes it (and its image best-effort).
- The admin list shows each milestone's progress, achieved/awarded state, and a "Mark as awarded" action for achieved-unawarded ones.

**Patterns to follow:** owner-gated actions + `getReadingAdmin` in the same file; `generate-quiz-dialog.tsx` / `quiz-draft-editor.tsx` for owner-facing form components; `createBookUploadUrl` client upload flow.

**Test scenarios:**
- Happy path: owner creates a "bonus, 100, Baseball bat" milestone for Oscar → row exists with `user_id = oscar`, `created_by_email = owner`.
- Happy path: `previewMilestoneCount` returns the correct sum for `bonus_pages` all-time and for `total_pages` since a given date.
- Happy path: `markMilestoneAwarded` sets `awarded_at`; the milestone drops off the dashboard query.
- Error path: a non-owner calling any milestone action is rejected.
- Edge case: creating with `start_on` in the future → preview shows 0; milestone counts only future advances.
- Integration: uploaded image path is stored and resolves to a viewable URL on the dashboard.

**Verification:** A parent can create, see progress for, and award a milestone end-to-end from `/reader/quizzes`.

---

- U7. **Declare-page UI + parent notification + celebration**

**Goal:** Wire the kid-facing declare dialog, the owner's milestone notification, and the reached celebration.

**Requirements:** R1, R2, R9

**Files:**
- Modify: `src/components/reading/mark-reached-button.tsx` (open a "how far did you get?" dialog before submitting)
- Create: `src/lib/reading/milestone-notifications.ts` (`getReadingMilestoneNotifications`)
- Modify: the bell aggregator that merges journal + todo sources (per research: `src/components/journal/notification-bell.tsx` and its data path / `global-header-client.tsx`)
- Modify: `src/components/reading/quiz-success-modal.tsx` (show milestone-reached celebration when an advance crossed one)

**Approach:**
- Declare dialog: a small number/slider input defaulting to the current `target_page`, bounded `[floor, ceiling]` (computed server-side and echoed to the client, or passed via the book card). On submit, call `markTargetReached(bookId, memberEmail, reachedPage)`; show the "building your quiz…" pending state (R2) while the action regenerates; then route to the quiz (content) or refresh (no-content). Keep the existing binary path when the kid just taps "reached it" without adjusting.
- `getReadingMilestoneNotifications(supabase, userId)`: for an owner, find across all kids the milestones with `achieved_at` set and `awarded_at` null; emit `JournalNotification`-shaped items (`reason: "Oscar reached Baseball bat"`, `href` → `/reader/quizzes`). Merge into the bell alongside the existing computed sources (R9).
- Celebration: `submitQuiz` already returns `advanced`/`finished`; extend its return (or the success-modal data) to signal a milestone was reached this pass so the modal can show the reward image + "You hit <title>!".

**Patterns to follow:** `src/lib/journal/notifications.ts` + `src/lib/todos/notifications.ts` (computed notification sources merged into the bell); existing dialog components in `src/components/reading/`.

**Test scenarios:**
- Happy path: tapping "Reached it" opens the dialog defaulted to the target; bumping to 80 and submitting routes to the regenerated quiz after a pending state.
- Edge case: dialog won't let the kid go below the floor or above the last page (client guard mirrors the server clamp).
- Happy path: an owner with an achieved-unawarded milestone sees a bell notification linking to Parent Admin; awarding it clears the notification.
- Integration: passing a quiz that crosses a milestone shows the celebration in the success modal with the reward image.
- Edge case: a pass that crosses no milestone shows the normal success modal (no celebration).

**Verification:** End-to-end: kid declares 80 → quiz regenerates → passes → bonus banked → milestone celebration → parent notified → parent marks awarded.

---

## System-Wide Impact

- **Interaction graph:** `advanceStretch` gains side effects (ledger insert + milestone stamp) felt by all three callers — `submitQuiz`, `closeQuizWithoutPassing`, `markTargetReached`. Keep them additive and failure-isolated so an earned advance never rolls back.
- **Error propagation:** Ledger/milestone writes are best-effort (log-and-continue) inside the advance; the declare-page quiz regeneration surfaces `quiz_pending` exactly like today when generation isn't ready.
- **State lifecycle risks:** Avoid double-counting — the existing `throughPage > current_page` guard ensures one ledger row per real advance; re-passes/retakes must not add rows. A declared bump that's never passed must leave no ledger trace (only passes write rows).
- **API surface parity:** No agent/HTTP API today exposes reading advancement; if the Norbert reading surface grows later, it should funnel through the same `advanceStretch` so bonus/milestones stay consistent (note only — out of scope).
- **Integration coverage:** The bonus math is unit-tested in isolation; the declare → regenerate → pass → bank → reach path needs an integration test (mocks alone won't prove the cross-module contract).
- **Unchanged invariants:** The owner-set weekly goal, quiz-gating, the binary "reached it" path (when no page is declared), and existing target/due math all keep working unchanged; the declare flow is purely additive.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Quiz regeneration latency on declare feels slow | Honest "building your quiz…" pending state (R2); generation already runs on the existing reach path, so no new latency class. |
| Bonus could be inflated if `advanceStretch` runs without a real pass | Bonus only writes inside `advanceStretch`, which only fires on pass/override/no-content-reach; the `throughPage > current_page` guard prevents re-counting. |
| Milestone "reached" misfires or double-fires | Crossing check sets `achieved_at` only when null and the recomputed sum ≥ threshold; idempotent across repeated advances. |
| Owner-on-behalf image upload rejected by RLS | Sign via admin client in member mode (proven by `createBookUploadUrl`). |
| Shared local Supabase migration-number collision | Use next free numbers `00148`/`00149`; re-apply via psql + PostgREST reload locally if needed. |
| `min_words` scaling makes big stretches feel punishing | Keep the scale modest with a cap; treat as a tunable (deferred). |

---

## Documentation / Operational Notes

- No env vars or external services added. Two new migrations (`00148`, `00149`) and one new storage bucket (`reading-milestones`) deploy via the normal git-push flow; the bucket + policies are created in-migration.
- Seed data (`supabase/seed` reading files) can optionally gain a sample milestone for Oscar/Sebastian to make the dashboard demonstrable locally.

---

## Sources & References

- Origin: brainstorm conversation in this session (no requirements doc on disk).
- Core code: `src/lib/reading/advance.ts`, `src/lib/reading/ensure-stretch-quiz.ts`, `src/app/(reading)/reader/actions.ts`, `src/app/(reading)/reader/quizzes/actions.ts`, `src/lib/reading/scope.ts`, `src/lib/reading/targets.ts`.
- Patterns: `supabase/migrations/00073_reading.sql`, `00083_reading_books_content.sql`, `00089_reading_book_targets.sql`; `src/lib/journal/notifications.ts`, `src/lib/todos/notifications.ts`.
