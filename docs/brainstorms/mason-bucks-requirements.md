---
date: 2026-06-25
topic: mason-bucks
---

# Mason Bucks

## Summary

A new family app, **Mason Bucks**, that turns the reader's threshold-based reward milestones into a points economy. Kids earn a single per-kid currency ("Mason Bucks") from multiple sources — reading bonus pages, qualifying journal entries, and adult-defined manual tasks — and spend it on prizes. The reader's existing milestones migrate into priced, redeemable prizes.

---

## Problem Frame

Today the reader app rewards kids through one narrow mechanism: parent-set milestones that unlock when a kid's cumulative *bonus pages* cross a threshold (e.g. "Read 500 bonus pages → Lego set"). Reward is all-or-nothing and reading-only — there's no way to recognize the other things the family wants to encourage (board games, the Summer Bridge workbook, daily journaling), and no notion of a kid "spending" what they've earned or choosing between rewards.

The family wants a single, legible currency that (a) consolidates all the ways a kid can earn, (b) lets kids see what they have and what they can buy, and (c) gives adults a lightweight approve/grant loop for the things only a human can verify. The reader's milestone primitive is close but mismatched: it's a threshold, not a balance; reading-only, not multi-source; and unlock-only, not earn-and-spend.

---

## Actors

- A1. **Kid** (`family_members.role = 'kid'`): earns Bucks (reading, journaling, claiming manual tasks), views balance / ways to earn / prizes / history, redeems prizes.
- A2. **Adult** (`owner` or `parent`): creates and archives earning tasks and prizes, approves kid claims, fulfills redemptions, and can redeem on a kid's behalf. Any one adult can act on any pending item.
- A3. **System** (service-role automation): auto-credits Bucks for reading bonus pages and for journal entries that clear the quality gate.

---

## Key Flows

- F1. **Earn via manual task claim**
  - **Trigger:** Kid does something off-app (plays a board game, completes Summer Bridge pages) and opens Mason Bucks to claim it.
  - **Actors:** A1, A2
  - **Steps:** Kid taps the earning task → enters a quantity (defaults to 1) → submits a claim → claim appears as a pending item in every adult's bell → an adult reviews (sees task, quantity, computed Bucks) and approves (or rejects).
  - **Outcome:** On approval, Bucks = value × quantity are credited to the kid's wallet and a transaction is recorded; the claim clears for all adults. A one-time task auto-archives on its first approved grant.
  - **Covered by:** R7, R8, R9, R10, R20

- F2. **Earn via journal entry (auto, gated)**
  - **Trigger:** Kid closes/completes a journal entry.
  - **Actors:** A1, A3
  - **Steps:** On first close, the system checks the gate (≥150 of the kid's own words AND ≥5 minutes wall-clock from entry start to close) → if met, credits 5 Bucks once for that entry.
  - **Outcome:** Wallet +5 with a journal-sourced transaction; reopening and re-closing the same entry never pays again. If the gate isn't met, the entry still saves but earns nothing.
  - **Covered by:** R5, R6

- F3. **Earn via reading bonus pages (auto)**
  - **Trigger:** Kid passes a quiz / advances past the weekly target, producing bonus pages.
  - **Actors:** A1, A3
  - **Steps:** The bonus-page count from the advance is credited 1:1 to the wallet as a reading-sourced transaction.
  - **Outcome:** Wallet balance rises by the number of bonus pages. No threshold check occurs anymore.
  - **Covered by:** R4

- F4. **Redeem a prize**
  - **Trigger:** Kid (or an adult on the kid's behalf) chooses an available prize they can afford.
  - **Actors:** A1, A2
  - **Steps:** Confirm redemption → balance is debited immediately by the prize price → a spend transaction is recorded → an adult fulfillment reminder appears in the bell.
  - **Outcome:** Balance drops instantly; adult sees "give [kid] the [prize]" and marks it fulfilled. A one-time prize archives after redemption.
  - **Covered by:** R12, R13, R14, R15, R20

---

## Requirements

**Currency & wallet**
- R1. Each kid has a single Mason Bucks balance, computed from an append-only ledger of transactions (earns positive, spends negative). The balance is never directly editable — only transactions are.
- R2. Every transaction records: kid, signed amount, source (reading / journal / task name / prize redemption / adjustment), related entity reference, the acting/approving adult where applicable, and a timestamp.
- R3. The Mason Bucks home screen shows, for the current kid: current balance, the ways to earn, the available (non-archived, affordable-or-not) prizes with prices, and a reverse-chronological transaction history. Kids see their own; an adult browsing a kid (via the existing `?member=` pattern) sees that kid's.

**Earning — reading**
- R4. Reading bonus pages credit the wallet 1:1 (1 bonus page = 1 Buck) at the moment an advance is recorded. The old bonus-page milestone-threshold check is removed.

**Earning — journal**
- R5. A journal entry grants 5 Bucks exactly once, on first close, only if it clears both gates: ≥150 words authored by the kid (excluding AI prompts/messages) AND ≥5 minutes wall-clock from entry start to close.
- R6. The grant is idempotent per entry — reopening and re-closing an already-granted entry never pays again, and an entry that failed the gate is re-evaluated (and may then qualify) on a later close.

**Earning — manual tasks**
- R7. An adult can create an earning task with: title, Buck value, unit label (e.g. "page", "game"), repeatable-vs-one-time, and audience (a specific kid or shared by both kids).
- R8. A kid can claim a task by entering a quantity (default 1); the claim is pending until an adult acts, and shows the computed Bucks (value × quantity).
- R9. An adult can approve or reject a pending claim. Approval credits value × quantity to the claiming kid's wallet and records a transaction; any one adult can resolve a claim, and resolving clears it for all adults.
- R10. A one-time task auto-archives upon its first approved grant (for a shared one-time task, the first approved claim closes it for everyone). Archived tasks are not claimable.
- R11. Seed earning tasks: "Play a family board game" = 20 Bucks/game (repeatable, shared); "Summer Bridge workbook" = 5 Bucks/page (repeatable, shared).

**Prizes & redemption**
- R12. An adult can create a prize with: title, price (Bucks), optional image, and audience (a specific kid or shared by both kids). Prizes can be archived; archived prizes are hidden from kids and not redeemable.
- R13. A kid can redeem any available prize they can afford for their wallet. Redemption debits the price immediately and records a spend transaction.
- R14. An adult can redeem a prize on a kid's behalf (same effect as the kid redeeming).
- R15. Each redemption creates an adult fulfillment reminder ("hand the prize to the kid"), which any adult can mark fulfilled. Fulfillment is a reminder only — it does not gate or reverse the debit.

**Migration**
- R16. Each existing `reading_milestones` record migrates to a prize: title, image, and per-kid scope carry over; the milestone `threshold` becomes the prize price 1:1.
- R17. Each kid's starting balance equals the 1:1 sum of their lifetime bonus pages from the existing `reading_stretch_advances` ledger, represented as an opening earn transaction (or equivalent) so the history is self-consistent. No deductions are applied (no awarded milestones exist).

**App surface & access**
- R18. Mason Bucks is a distinct app in the app switcher, available to kids and the owner (and parents, consistent with adult access elsewhere).
- R19. The reader app stops presenting milestone progress as the reward surface; it may keep a lightweight "Bucks earned from reading" nudge that links to Mason Bucks. (Exact reader entry point deferred to planning.)

**Notifications**
- R20. Pending claims and unfulfilled redemptions surface in the existing computed-on-render header bell for all adults, following the current "pending → resolved" notification shape. No new persistent notification table is required beyond the underlying claim/redemption records.

---

## Acceptance Examples

- AE1. **Covers R5, R6.** Given a kid has written 180 of their own words over 7 wall-clock minutes, when they close the entry for the first time, then 5 Bucks are credited with a journal-sourced transaction; when they later reopen and re-close the same entry, no additional Bucks are granted.
- AE2. **Covers R5.** Given a kid wrote 90 words in 6 minutes, when they close the entry, then no Bucks are granted and the entry still saves normally.
- AE3. **Covers R8, R9.** Given the shared "Summer Bridge" task at 5/page, when a kid claims a quantity of 8, then a pending claim for 40 Bucks appears to all adults; when one adult approves, then 40 Bucks are credited to that kid and the claim clears for everyone.
- AE4. **Covers R10.** Given a one-time shared task, when an adult approves the first claim on it, then the task is archived and neither kid can claim it again.
- AE5. **Covers R13, R15.** Given a kid has 600 Bucks and a 500-Buck prize is available, when they redeem it, then their balance becomes 100 immediately, a spend transaction is recorded, and an unfulfilled-redemption reminder appears in the adults' bell.
- AE6. **Covers R13.** Given a kid has 300 Bucks and a prize costs 500, when they view it, then it is shown but not redeemable (insufficient balance).
- AE7. **Covers R16, R17.** Given a kid had a "Read 500 bonus pages" milestone and 420 lifetime bonus pages at migration, when Mason Bucks launches, then a 500-Buck prize exists and the kid's opening balance is 420 Bucks.

---

## Success Criteria

- A kid can, in one place, see their balance, understand every way to earn, browse prizes with prices, redeem something they can afford, and read their own earn/spend history.
- Earnings flow correctly and automatically from reading and qualifying journal entries, and through the claim→approve loop for manual tasks, with no double-pays.
- Any adult can create/archive tasks and prizes, clear pending claims and redemptions, and redeem on a kid's behalf, without bottlenecking on the owner.
- Migration is faithful and lossless: every old milestone appears as a priced prize and every kid's opening balance equals their lifetime bonus pages, with a self-consistent transaction history.
- A downstream planner can build this without inventing economy rules, gate definitions, approval authority, or migration mapping — all are specified here.

---

## Scope Boundaries

- Push / mobile notifications — in-app bell only for v1.
- Parental veto or approval *before* a redemption — redemptions are instant; adults manage via creating/pricing/archiving prizes, not gatekeeping spends.
- Spending caps, allowances, interest, or scheduled/recurring auto-grants for manual tasks.
- Buck transfers or gifting between kids.
- Editing or reversing historical transactions through the UI (corrections, if ever needed, are out of v1 — adjustments are a possible future source type).
- Changing how reading bonus pages themselves are calculated — only how they're rewarded.

---

## Key Decisions

- 1 bonus page = 1 Buck, and old milestone thresholds become prize prices 1:1: keeps migration trivially faithful and makes the unit intuitive (a Buck is a page).
- Wallet = append-only ledger, balance is derived: gives a trustworthy, teachable history and a clean audit trail for adults at near-zero extra cost.
- Manual tasks carry value + unit + claim quantity: one small field lets the same primitive handle flat rewards (board game) and per-unit rewards (Summer Bridge) without a separate concept.
- Redemption is instant deduction + fulfillment reminder (not pre-approval): respects that kids spend their own earnings, prevents double-spend, and reuses the existing milestone handoff pattern; adults retain control upstream via prize creation/pricing/archiving.
- One-time = auto-archive after first grant/redemption: avoids a distinct lifecycle; reuses the archive mechanism shared by tasks and prizes.
- Approvals route to all adults, first to act wins: matches two-parent co-management and avoids owner bottleneck.
- Journal gate (≥150 kid-authored words AND ≥5 min wall-clock): makes journaling earn-worthy rather than gameable, while keeping the definition derivable from timestamps + authored content.

---

## Dependencies / Assumptions

- Reuses existing primitives: `family_members` roles, the `?member=` owner-browses-a-kid scope pattern, `reading_stretch_advances` (bonus-page ledger), `reading_milestones` (migration source), the reading-milestones storage bucket (prize images), and the computed-on-render header-bell notification pattern.
- Assumes only the owner and parents are "adults"; kids cannot create tasks/prizes or approve claims.
- Assumes no awarded milestones exist at migration time (confirmed), so no spend/deduction reconciliation is needed for historical rewards.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5, R6][Needs research] Does the journal currently persist a usable entry **start timestamp** and a way to count **kid-authored words** separately from AI content? If wall-clock start→close or per-author word counts aren't already available, the gate needs new instrumentation.
- [Affects R4][Technical] Exactly where to credit reading bonus pages — the current `recordAdvanceAndCheckMilestones` path records the advance and checks milestones; the milestone check is removed and replaced with a wallet credit. Confirm the single write point and idempotency.
- [Affects R19][Technical] Where the reader's old milestone UI lived and what (if anything) replaces it inline in the reader vs. linking out to Mason Bucks.
- [Affects R16][Technical] Whether any existing milestones use the `total_pages` metric (vs `bonus_pages`); migration takes `threshold` as price regardless, but confirm there are no metric-specific assumptions to drop.
- [Affects R20][Technical] Whether pending claims/redemptions need their own tables or can be modeled as transaction/claim records with status fields feeding the bell.
