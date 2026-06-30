---
date: 2026-06-29
topic: games-trivia
---

# Games App — Family Trivia (Game #1)

## Summary

A new **Games** app to house many family games over time, launching with a **host-run, team-based trivia game**: questions are read aloud from one phone, teams pair an adult with a kid, each spotlight question is targeted to that player's level, and the questions themselves are AI-generated on demand and gated by an adversarial AI verification pass. Winning kids earn Mason Bucks.

---

## Problem Frame

The family wants something fun to play together in the in-between moments — most concretely, the four of them around a restaurant table waiting for food. Andrew went looking for a pass-and-play trivia / Family Feud / Jeopardy-style app to play on his iPhone in that exact situation and couldn't find one he liked. Existing trivia apps don't fit a household with a 10-year-old (Oscar, entering 5th), a 12-year-old (Sebastian, entering 7th), and two adults: a single shared difficulty either bores the parents or stumps the kids, the question banks are generic (nothing about the kids' actual interests or schoolwork, nothing about the Giants), and there's no tie-in to the family's own reward system. The cost today is a missed, recurring opportunity for low-friction family fun that also quietly reinforces what the kids are learning.

---

## Actors

- A1. **Host** (an adult, usually Andrew): runs the game on their phone, reads questions aloud, but is also a *player* — so must never see answers in advance.
- A2. **Player — kid** (Oscar / Sebastian): answers level-targeted spotlight questions, can help freely on an adult teammate's question, earns Bucks when their team wins.
- A3. **Player — adult** (Andrew / Jenny): answers adult/general spotlight questions, plays for bragging rights only (no wallet).
- A4. **Question author** (any adult, possibly with the kids): uses the in-app generator to create topic batches that expand the bank.
- A5. **System — generator + verifier** (service-role AI): generates question batches, runs the adversarial verification pass, and assembles each game's deck.

---

## Key Flows

- F1. **Play a game (host mode)**
  - **Trigger:** The family opens Games → Trivia and starts a session.
  - **Actors:** A1, A2, A3, A5
  - **Steps:** Set up teams (default adult+kid pairs) → pick length (Quick / Standard / target score) and optionally which topics are in play → the system assembles a deck giving every player an equal number of spotlight turns → on each turn the spotlight player gets a level-targeted question; team answers; host resolves; steal / no-peek / lifelines apply → repeat until the deck ends or the target is hit.
  - **Outcome:** A winning team is determined by total points; Bucks are paid to the winning kid (and consolation to the other kid), subject to the daily cap. The game can be paused or abandoned mid-deck (e.g., food arrives).
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7, R8, R9, R20, R21, R22

- F2. **Generate a question batch**
  - **Trigger:** An adult (often with the kids naming topics) opens the generator.
  - **Actors:** A4, A5
  - **Steps:** Enter a topic → optionally choose level, question type(s), and count → submit → the system generates the batch and runs the adversarial verification pass → only questions that pass enter the playable bank, tagged by topic, level, type, and perishability.
  - **Outcome:** The bank grows with verified, playable questions; failed questions are quarantined/discarded and never surfaced to the host.
  - **Covered by:** R10, R11, R12, R13, R14, R15

- F3. **Toss a bad question mid-game**
  - **Trigger:** A question surfaces during play that is wrong, stale, or broken.
  - **Actors:** A1, A2, A3
  - **Steps:** Anyone taps "toss this question" → it is removed from the current turn for no points and flagged for removal/re-verification → play continues with the next question.
  - **Outcome:** Fairness is preserved and the answer is never revealed; the flagged question is pulled from the playable pool.
  - **Covered by:** R16

---

## Requirements

**App shell**
- R1. **Games** is a distinct app in the app switcher, available to all four family members, gated consistent with the household's other apps. It is structured to hold multiple games over time; **Trivia** is the only game in v1.

**Game setup**
- R2. A session starts by choosing **teams**. Default is two teams each pairing one adult with one kid (Andrew+Oscar, Jenny+Sebastian); the setup allows changing the pairing.
- R3. Setup chooses a **game length**: Quick (~10 questions), Standard (~20 questions), or play-to-a-target-score.
- R4. Setup optionally **scopes which topics/categories are in play** for this game (e.g., a baseball-only game, a school-review game) or defaults to a mixed deck drawn from the whole bank.

**Core play loop (host mode)**
- R5. The game runs on **one phone** as the question deck + live scoreboard. Questions are presented to be **read aloud**; the host resolves each turn. The host is also a player, so the UI must never reveal an upcoming answer to the host before it is resolved.
- R6. Play rotates a **spotlight** so each player gets an **equal number of spotlight turns** across the deck.
- R7. Each spotlight question is **targeted to the spotlight player's level**: ~5th-grade for Oscar, ~7th-grade for Sebastian, adult/general for the parents. **A correct answer is worth the same points regardless of the question's difficulty.**
- R8. **Collaboration is one-directional:** when an **adult** is in the spotlight, their kid teammate may help freely; when a **kid** is in the spotlight, the parent stays out by default (overridable only via the Parent Assist lifeline).
- R9. Game ends when the deck is exhausted or the target score is reached; **most points wins**. A game can be **paused or abandoned** mid-deck.

**Question types**
- R17. **Multiple choice (4 options)** is the backbone type.
- R18. **List it:** "name as many as you can" within a time limit; team confers, host taps each correct item; scores per-correct, optionally against a target.
- R19. **Closest wins:** a numeric-estimate question; each team gives a number and the closest wins.

**In-turn mechanics**
- R20. **Steal:** if the spotlight player misses, the other team gets one attempt for partial points.
- R21. **No-peek:** before choices are shown (MC), a player may opt to answer blind for double points.
- R22. **Lifelines are per team, one use each per game:** (a) **50/50** removes two wrong MC options; (b) **Parent Assist** lets a kid pull their parent into a kid's spotlight question; (c) **📞 Phone Grandma**, a fake AI friend who gives a confident guess that is correct ~75% of the time, with characterful, plausible-but-wrong misses; (d) **Double Down** wagers double points on the current question.

**Question generation & quality**
- R10. An in-app **generator UI** creates a **batch** of questions from a **topic**, with optional **level**, **question type(s)**, and **count**. The bank grows on demand and is meant to be expanded continually (including from topics the kids request).
- R11. Generated questions are stored tagged by at least **topic, level, type, and perishability** (fresh vs evergreen).
- R12. There is **no human pre-review of question content** (the host plays), so generated questions instead pass through an **adversarial AI verification pass** before becoming playable: the verifier answers the question independently, then compares to the proposed answer, and checks for ambiguity and clearly-wrong distractors.
- R13. Only questions that **pass verification** enter the playable pool; failures are quarantined or discarded and are never surfaced to the host.
- R14. **Fresh/perishable** topics (modern sports, pop culture) may use **web lookups at generation time** for accuracy and are tagged so they can be re-verified or expired later; **evergreen** topics (e.g., the Revolutionary War) are not treated as perishable.
- R15. Generation and verification (including any web lookups) happen **at generation time, offline from play** — live play never blocks on AI.
- R16. During a game, **anyone can "toss" the current question**; it is removed for no points, the answer is not revealed, and the question is flagged for removal/re-verification.

**Repeats & freshness in play**
- R23. A game's deck **avoids recently-seen questions** within the relevant pool until that pool is exhausted, so back-to-back games don't feel repetitive.

**Mason Bucks payoff**
- R24. On a completed game, the **winning team's kid earns +10 Bucks** and the **other kid earns +3** (consolation); adults earn no Bucks.
- R25. Bucks payouts are **capped to roughly the first one or two completed games per day**; games played beyond the cap are for fun only and pay nothing.
- R26. Bucks are credited through the existing Mason Bucks ledger with a **`games`/trivia source**, idempotent per game so a single completed game can never double-pay.

---

## Acceptance Examples

- AE1. **Covers R7, R8.** Given Oscar is in the spotlight on a 5th-grade-level question, when it is his turn, then the question is at his level, his parent teammate cannot help unless Parent Assist is spent, and a correct answer scores the same as any adult question.
- AE2. **Covers R8.** Given Jenny is in the spotlight, when she is unsure, then Sebastian (her teammate) may help freely without spending a lifeline.
- AE3. **Covers R20, R21.** Given the spotlight player chooses No-peek and answers wrong, when they miss, then the other team may Steal for partial points.
- AE4. **Covers R22.** Given a team has not used Phone Grandma, when they call her, then she returns a confident answer that is correct about 75% of the time, and the lifeline is then spent for the rest of the game.
- AE5. **Covers R12, R13.** Given a generated batch where one question's "correct" answer is actually wrong, when verification runs, then that question is quarantined and never enters the playable pool or reaches the host.
- AE6. **Covers R16.** Given a stale question surfaces mid-game, when anyone taps "toss this question," then it scores nothing, the answer is not shown, and it is pulled from the pool.
- AE7. **Covers R24, R25.** Given Andrew+Oscar win their first game of the day, when the game completes, then Oscar receives 10 Bucks and Sebastian receives 3; when they immediately play and win again past the daily cap, then no further Bucks are paid.
- AE8. **Covers R9.** Given a game is mid-deck when the food arrives, when the family pauses or abandons it, then the game stops cleanly without erroring (an abandoned game pays no Bucks).

---

## Success Criteria

- The four of them can start and finish a fun trivia game on one phone in the time it takes to wait for food, with each person getting winnable, level-appropriate questions and the parents not bored.
- The question bank visibly grows over time from topics the family (especially the kids) cares about, with no wrong "correct" answers reaching the table in normal play.
- A win feels rewarding: the winning kid earns Bucks, the losing kid isn't crushed, and the economy isn't distorted by replay farming.
- A downstream planner can build v1 without inventing game rules, scoring, lifeline behavior, the generation/verification pipeline, or the Bucks payout/cap — all are specified here.

---

## Scope Boundaries

### Deferred for later

- Additional games in the Games app beyond Trivia (the shell anticipates them; only Trivia ships in v1).
- Additional question types: **Put it in order** and **Odd one out** (cheap follow-ons), and **picture/flag** and **name-that-tune** types (need image/audio assets).
- A second fake friend (e.g., a hilarious, ~50%-right "Cousin") alongside Grandma.
- Pure open-answer (host-judged) trivia mode.
- Guest / extra players beyond the family four.
- Re-verification or expiry automation for perishable questions (v1 only *tags* perishability; acting on it is later).

### Outside this product's identity

- Adults earning a Bucks currency — Bucks remain a kids-only economy; adults play for pride.
- Single-difficulty, generic-bank trivia — the per-player targeting and family-specific bank are the point, not an option to turn off.
- Push / mobile notifications for game invites or results.

---

## Key Decisions

- **Host mode over pass-the-phone:** keeps the energy social and at the table, avoids kids fighting over the device, and is far simpler to build (one screen). Pass-the-phone is reserved for a future game where secret reading matters.
- **Mixed adult+kid teams with per-player level targeting, equal points:** reconciles "personalized difficulty" with "one shared game" — every kid's question is winnable for them, each kid gets a spotlight, and it sidesteps the Bucks-per-kid problem since every team contains a kid.
- **One-directional collaboration:** kids helping "up" keeps them engaged on every question; parents staying out of kid questions protects the learning/spotlight value.
- **Phone Grandma as a fake friend (~75% right):** delivers the Millionaire "ask the audience" feeling, which a true audience vote can't with only four people, and adds cheap delight.
- **No human pre-review; adversarial AI verification instead:** the host is a player, so a human reviewing answers would spoil the game; an independent verifier preserves quality without spoiling.
- **Generation/verification offline from play:** live play never waits on AI; perishable facts are resolved at generation time.
- **Winner Bucks with consolation + daily cap:** rewards winning, softens repeated losses for the younger kid, and prevents the game from becoming a Bucks-printing press that distorts the prize economy.

---

## Dependencies / Assumptions

- Reuses the existing **Mason Bucks ledger** (append-only `bucks_ledger`, idempotent via unique `(source, reference_id)`) — a new `games`/trivia source and a completed-game reference id give double-pay-safe payouts.
- Reuses **`family_members`** roles (kid/parent/owner) for player identity, level targeting, and access gating, plus the household's existing app-switcher/access pattern.
- Assumes an AI generation + verification capability is available server-side (the same class of capability used elsewhere in the app), with optional web search for perishable topics.
- Assumes Bucks remain kids-only; adults have no wallet.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R7][Technical] How "level" is represented and how the deck assembler picks a level-appropriate question for each spotlight player (tag-based selection vs generated-per-game).
- [Affects R12, R14][Needs research] Exact verification model/prompt and which generation path gets web search for perishable facts; how confidence/flagging is recorded.
- [Affects R22][Technical] How Phone Grandma's ~75%-correct behavior and plausible-but-wrong misses are produced (precomputed at generation vs computed at call time).
- [Affects R25][User decision/Technical] Precise daily-cap rule (1 vs 2 paying games/day; per-kid vs per-household; what counts as "completed").
- [Affects R23][Technical] How "recently seen" is tracked (per-household history of served questions) and the exhaustion fallback.
- [Affects R1][Technical] The Games app's internal shape for holding multiple future games (routing/registry) — kept minimal for a single game in v1.
