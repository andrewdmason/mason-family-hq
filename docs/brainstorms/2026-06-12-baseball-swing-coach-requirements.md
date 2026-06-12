---
date: 2026-06-12
topic: baseball-swing-coach
---

# Baseball Swing Coach

## Summary

A coach-facing app inside mason-family-hq that turns iPhone slo-mo clips of a youth player's swing into a prioritized coaching assessment — diagnosis, 1–2 focus areas with kid-appropriate cues and drills, and the observable tells that let a volunteer coach judge each rep with his own eyes — with per-player memory across sessions. v1 is post-hoc assessment; the analysis pipeline is chosen so a live tee-station mode can follow as v2 without a rebuild.

---

## Problem Frame

Volunteer Little League coaches are mostly dads without deep baseball expertise. They can see that a kid's swing "looks off," but can't identify the specific mechanical issue, don't know which of several problems to fix first, don't know the right drills or age-appropriate cues — and, hardest of all, can't tell on subsequent reps whether the kid is executing the fix. Great coaching is a loop: assess across many swings, prescribe one or two prioritized fixes, then judge every rep against them. Andrew assistant-coaches his son Oscar's team (9, just made All Stars) and wants that loop available to himself and, eventually, other dad-coaches.

Existing tools don't close the gap: sensor and CV products (Blast Motion, b4-app) output metrics, not coaching; Sportsbox-style tools produce post-hoc biomechanics without prescription; Mustard coaches pitching only. Nothing teaches the coach what to look for. An earlier experiment sending raw swing video to a multimodal LLM produced unreliable feedback and was abandoned.

---

## Actors

- A1. Coach (Andrew): films swings at practice or the cage, uploads them, reads assessments, delivers the coaching verbally, judges reps by eye between assessments
- A2. Player: kid on the roster (roughly 7–12); receives coaching verbally from the coach; never uses the app directly in v1
- A3. Analysis pipeline: extracts body mechanics from video, finds patterns across swings, writes the coach-facing assessment

---

## Key Flows

- F1. Assess a player
  - **Trigger:** Coach has filmed a round of swings (iPhone built-in camera, 240fps slo-mo)
  - **Actors:** A1, A3
  - **Steps:** Select player from roster → upload the round's clips → pipeline extracts mechanics and finds patterns across the batch → assessment is generated → coach reads it
  - **Outcome:** Player has an active assessment with 1–2 prioritized focus areas, each with diagnosis, cues/drills, observable tells, and annotated visual evidence
  - **Covered by:** R3–R9

- F2. Re-assess and check progress
  - **Trigger:** A later session produces new clips for a player who already has an assessment
  - **Actors:** A1, A3
  - **Steps:** Upload the new round → analysis runs with the player's prior focus areas in context → assessment reports progress on each prior focus area and recommends keeping, advancing, or replacing it
  - **Outcome:** Updated focus areas plus a progress narrative tied to the previous assessment
  - **Covered by:** R2, R8

- F3. Practice reference
  - **Trigger:** Coach at practice needs to remember what each kid is working on and how to spot it
  - **Actors:** A1
  - **Steps:** Open a player on a phone → see current focus areas, cues, and tells at a glance
  - **Outcome:** Coach can run a tee station and call right/wrong reps unaided by the analysis pipeline
  - **Covered by:** R5, R13

---

## Requirements

**Roster and memory**
- R1. Maintain a simple roster of players (name, age, bats L/R) — no team-management features beyond that.
- R2. Each player has an assessment history and a set of current focus areas; new assessments always run with the player's history in context.

**Assessment**
- R3. An assessment ingests a batch of swing clips (target 5–10 swings) for one player from one session.
- R4. Analysis identifies patterns across the batch; it does not render judgments from a single swing.
- R5. Output is written for the coach. Each focus area has three layers: (a) diagnosis in plain language, (b) how to coach it — an age-appropriate cue plus one or two drills, (c) what to watch for — the naked-eye tell that lets the coach judge right/wrong execution on any rep.
- R6. A player has at most 1–2 active focus areas at a time; when more issues are visible, the assessment prioritizes and holds the rest back.
- R7. Assessments include annotated visual evidence: frames or short clips from the player's own video with skeleton/reference-line overlays that show each tell.
- R8. When a player has prior focus areas, the new assessment evaluates progress on each and recommends keep, advance, or replace — with the evidence for that call.
- R9. The analysis foundation is pose extraction → biomechanics metrics → LLM-generated coaching language. Raw video is never sent to a multimodal LLM as the primary analysis path (validated dead end; also incompatible with v2 latency).

**Platform**
- R10. Built as a new app inside mason-family-hq, following its existing app, auth, database, and deployment conventions.
- R11. Capture uses the iPhone's built-in camera (240fps slo-mo); the app ingests uploaded clips rather than capturing video itself.
- R12. Heavy video processing does not run on the production deployment (serverless hosting can't support it) — pose extraction happens client-side in the browser or on the coach's Mac. Production persists derived artifacts (keypoints, metrics, annotated stills/short clips), not full raw sessions.
- R13. The current-focus view (F3) is usable on a phone at the field.

---

## Acceptance Examples

- AE1. **Covers R3–R6.** Given 8 uploaded swings of a new 9-year-old showing both head movement and a long stride, the assessment names the higher-priority issue as focus area #1, includes a kid-friendly cue, at least one drill, and a tell like "watch his chin — if it ends up past his front shoulder at contact, he pulled his head."
- AE2. **Covers R8.** Given a player whose prior focus area was "keep your head still" and a new batch showing clear improvement, the assessment says so explicitly and either advances to a refinement or promotes a new focus area — it does not re-prescribe the solved problem from scratch.
- AE3. **Covers R6.** Given a player with five visible mechanical issues, the assessment still surfaces at most two focus areas and notes that others are intentionally parked.
- AE4. **Covers R12.** Given a session whose raw clips total ~1 GB, the completed assessment (including visual evidence) remains viewable later from any device without the raw clips being stored in production.

---

## Success Criteria

- Andrew runs real assessments for kids on his team and delivers the coaching at practice — the app gets used beyond his own sons.
- Assessments pass the eye test: they agree with what trusted human coaches (e.g., Sebastian's travel-ball instructors) would say about the same swing; disagreement is treated as the app being wrong.
- The "what to watch for" tells work in practice: a dad-coach can call right/wrong reps at the tee with no device running.
- A returning player's assessment demonstrably builds on the previous one rather than starting over.
- Clean handoff: ce-plan can plan v1 from this document without inventing product behavior, scope, or success criteria.

---

## Scope Boundaries

### Deferred for later

- v2 live tee-station mode: per-swing feedback within seconds on the active focus cue, MacBook + camera at practice. v1 architecture must not preclude it (shared metrics and coaching brain).
- Throwing/pitching analysis.
- Kid- or parent-facing report views, sharing, or simplified-language output.
- Other coaches/teams as users (multi-tenant, onboarding, distribution).
- Native iOS app — only ever needed if live in-app 240fps capture (bat tracking) becomes a goal.

### Outside this product's identity

- Outcome-metric measurement (exit velocity, bat speed, launch-angle numbers). b4/Blast measure; this product coaches.
- Team management (schedules, lineups, communications) — covered by existing tools.
- Replacing the human coach: the app teaches and equips the coach; the coach delivers the coaching.

---

## Key Decisions

- Assessment-first v1, live mode as v2: assessment is the half volunteer coaches can't do at all; it derisks the technically hardest half; the pipeline, metrics, and coaching content all carry forward into live mode.
- Web app in mason-family-hq, not native iOS: Andrew's vibe-coding comfort zone; reuses existing auth, database, and deployment; capture quality comes free from the iPhone's built-in camera, so a native app buys nothing v1 needs.
- Coach-facing voice with the "what to watch for" layer: the differentiator versus every metrics app — it builds the coach's eye, which is also exactly the checkpoint v2 automates later.
- Pose → metrics → LLM pipeline (never raw-video-to-LLM): supported by prior art and research, confirmed by Andrew's own failed raw-video experiment; structured metrics into the LLM is what makes coaching language reliable and v2 latency feasible.
- Coach body mechanics, not bat metrics: body motion is trackable at consumer frame rates and is what youth coaching cues actually address; bat-level measurement is a different product.

---

## Dependencies / Assumptions

- Pose-estimation quality on 240fps iPhone footage of kids (outdoor fields, cages) is sufficient for coarse body-mechanics metrics — research-supported but should be validated with a spike early in the build.
- Coaching content (youth-appropriate drills and cues) comes from the LLM's baseball knowledge plus curation by Andrew; the Success Criteria eye-test is the quality gate.
- mason-family-hq's storage can hold derived artifacts per assessment; raw 240fps sessions (hundreds of MB to GBs) are explicitly not stored wholesale (see R12). Storage limits/cost not yet verified — unverified assumption.
- Anthropic API access (SDK already present in the repo) for generating coaching language.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R9, R12][Technical] Where pose extraction runs: in-browser (MediaPipe via WASM/WebGPU) vs. a local Python process on the Mac. Both satisfy R12 and share metrics/brain with v2; pick during planning.
- [Affects R3][Technical] Swing segmentation: one clip per swing vs. auto-detecting swings within a longer recording.
- [Affects R7][Technical] Which derived artifacts to persist (annotated stills vs. short overlay clips) given storage constraints.
- [Affects R5][Needs research] How to seed/curate the youth drill-and-cue library so the LLM's prescriptions are consistent and trustworthy.
