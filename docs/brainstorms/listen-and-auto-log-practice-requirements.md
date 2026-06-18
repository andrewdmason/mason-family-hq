---
date: 2026-06-18
topic: listen-and-auto-log-practice
---

# Listen and Auto-Log Piano Practice

## Summary

Add a "listen" mode to the practice app that hears piano playing through the mic, recognizes which active piece is being played by matching against per-piece reference MIDIs, and automatically writes one practice task per piece — each with an AI-generated, teacher-legible notes narrative of what was practiced. No manual entry, no review step.

---

## Problem Frame

Logging practice today is manual: you create a `practice_task`, link it to a piece (and optionally a section), run the timer, and optionally record audio. Doing this mid-session means fiddling with the app while you're trying to play, so logging is friction at exactly the wrong moment — and the richest information (which measures you drilled, how much time was under-tempo, where you repeated) is the part you'd never bother to capture by hand.

The active repertoire is small — roughly a dozen pieces at a time — and most have MIDI versions available online. That small, known set is what makes recognition tractable: the app only has to tell apart a handful of candidates, not identify arbitrary music. The notes narrative is the real prize: a description of *how* the session was spent that a piano teacher could read to judge whether practice time was used well.

---

## Actors

- A1. Andrew (player): sits down, plays, and wants the session logged without touching the app mid-practice; edits entries afterward if needed.
- A2. Piano teacher (reader, indirect): does not use the app, but is the intended audience for the notes narrative — the prose must be legible and useful to someone assessing practice quality.
- A3. Recognition pipeline (system): records the session, matches audio against reference MIDIs, segments it per piece, and generates each entry's narrative.

---

## Key Flows

- F1. Capture and auto-log a practice session
  - **Trigger:** Andrew taps "start listening" before playing; taps stop when done.
  - **Actors:** A1, A3
  - **Steps:** App records the session audio → on stop, the pipeline matches the audio against the active reference-MIDI set and segments it into per-piece stretches → for each recognized piece it writes one practice task (piece + duration) with a generated notes narrative → unmatched stretches above a minimum duration are logged as free-play entries → raw audio is discarded (kept only on low-confidence matches).
  - **Outcome:** The day's log contains one task per piece played, plus any free-play entries, each editable like a normal task. Session time is accounted for end to end.
  - **Covered by:** R1, R2, R3, R4, R5, R7, R8, R9

- F2. Make a piece recognizable
  - **Trigger:** Andrew wants a piece to be auto-detected.
  - **Actors:** A1
  - **Steps:** Open the piece → upload a reference MIDI → the piece now shows as "recognizable."
  - **Outcome:** The piece joins the recognition set; pieces without a MIDI degrade gracefully (just aren't auto-detected).
  - **Covered by:** R10, R11, R12

---

## Requirements

**Capture**
- R1. Provide a "start listening" / stop control that records a discrete practice session via the mic. No always-on listening.
- R2. Record the session audio and process it server-side after stop (not live/on-the-fly).
- R3. After processing, delete the raw session audio — except keep it when the best match confidence was low, so the rare miss can be spot-checked.

**Recognition and segmentation**
- R4. Match the recorded audio against the set of active pieces that have a reference MIDI, using audio-to-reference alignment (tolerant of wrong notes, tempo changes, and starting mid-piece) — not audio fingerprinting.
- R5. Segment a session into per-piece stretches and emit exactly one practice task per recognized piece, with that piece's total worked duration.
- R6. Recognize scales and arpeggios by pattern (no reference MIDI required) and identify the key/mode where possible.
- R7. When a stretch matches no piece and isn't a recognizable scale/arpeggio, treat it as free play: log a lightweight "free play / improvisation" entry if it exceeds a minimum duration; otherwise absorb/ignore it so brief noodling between pieces isn't spammed into the log.

**Logging output**
- R8. Write entries automatically with no confirmation/review screen; entries are ordinary `practice_tasks` that can be edited or deleted afterward.
- R9. For each entry, generate a free-text notes narrative describing how the piece was practiced — best-guess prose covering time spent under-tempo vs up-to-speed, repetition of difficult spots, and hands-separate practice. Location is described at **region level** (named regions / proportional position — "the opening," "the coda," "the final third"), **not** specific bar numbers. The narrative is written to be legible and useful to a piano teacher assessing practice quality. It is allowed to be approximate; piece identity is the only thing held to a high bar. (Narrowed from "which measures" after the U1 spike: piece ID proved robust, but measure-level localization on practice audio is coarse — see Key Decisions.)

**Reference MIDI management**
- R10. Allow uploading one reference MIDI per piece (optional per piece). Replace by re-uploading; no in-app MIDI editing/trimming.
- R11. A plain quantized score-MIDI is sufficient — expressive timing/dynamics are not required.
- R12. Show, per piece, whether it has a reference MIDI yet, so the active repertoire reads as a setup checklist of which pieces are recognizable.

---

## Acceptance Examples

- AE1. **Covers R5, R9.** Given reference MIDIs exist for the Ballade and a Bach Invention, when Andrew plays the Ballade opening slowly several times then plays the Invention, the log gets two tasks — Ballade and Invention — each with a duration and a narrative describing the slow/repeated work.
- AE2. **Covers R6.** Given no MIDI for scales, when Andrew plays a C-minor scale and a broken-triad arpeggio, the session logs them as scale/arpeggio practice with the key identified where possible.
- AE3. **Covers R7.** Given a 6-minute stretch that matches no active piece, when the session is processed, it is logged as a free-play entry rather than dropped; a 20-second doodle between two pieces is absorbed, not logged.
- AE4. **Covers R3.** Given a session where the best piece match was low-confidence, when processing finishes, the raw audio is retained for spot-checking instead of deleted.
- AE5. **Covers R8.** Given the pipeline mis-identifies one piece, when Andrew opens the log, he can edit or delete that task directly — nothing blocked on a confirmation step.

---

## Success Criteria

- Andrew can practice a normal session and end up with an accurate per-piece log without having touched the app while playing.
- Piece identification across the active set is reliable enough to trust by default (the field he'd rarely need to correct).
- The notes narratives are something Andrew would actually be comfortable showing his teacher as a picture of how a session was spent.
- No accumulation of large audio files over time.
- `ce-plan` can proceed without inventing product behavior: capture model, output shape, no-match handling, and reference-MIDI UX are all decided here.

---

## Scope Boundaries

- Structured section/measure fields and mapping practice onto the existing `piece_sections` model — narrative prose only for v1; the audio sees finer detail than today's sections, and forcing it into them is the wrong fit.
- True on-the-fly / never-store live transcription — deferred until matching is proven; v1 records then deletes.
- Real-time score-following or live feedback while playing.
- Numeric grading of practice quality or auto-detecting tempo targets.
- Recognizing pieces with no reference MIDI (they simply aren't in the recognition set until a MIDI is added).

---

## Key Decisions

- One entry per piece, not per section/measure: matches how Andrew wants to read the log today, and keeps the fuzzy detail in low-stakes prose rather than high-stakes structured fields.
- Notes narrative as the core value, aimed at the teacher: moves the hardest, least-reliable analysis (location, tempo, repetition) into a forgiving free-text field where approximation is acceptable.
- Region-level (not measure-level) localization in v1: the U1 spike confirmed piece ID is robust on real practice audio (incl. hands-separate and heavy repetition), but exact measure localization is coarse — it placed the looped take in the correct *region* (the coda) but not the exact bars, and mis-placed hands-separate playing. Region-level prose is honest about what the tech reliably knows; measure precision is deferred to the windowed/per-hand pipeline (and a per-piece score-offset) if it later proves tight enough.
- Auto-write with no review step: removing logging friction is the whole point; entries are editable tasks, so a wrong guess is cheap to fix.
- Record + process server-side, then delete: reuses the existing audio pipeline, gets the best transcription accuracy, and honors "don't hoard files" — with low-confidence retention as a cheap safety net.
- Audio-to-reference alignment, not fingerprinting: same piece played differently (mistakes, tempo, repeats) defeats fingerprinting; alignment against the constrained MIDI set is both robust and what makes a dozen-piece set easy to disambiguate.
- Reference MIDI optional per piece with a visible "recognizable" indicator: graceful degradation plus a natural setup checklist.

---

## Dependencies / Assumptions

- Most active pieces have a findable MIDI (online or MuseScore export) good enough to align against.
- The existing practice data model (`pieces`, `practice_tasks` with timer + audio) and the `task-audio` storage bucket are reused; this adds reference-MIDI storage and the listen/segment/narrate pipeline on top.
- Solo piano transcription/alignment is mature enough for reliable piece-level ID across a small set; this is the load-bearing technical bet to validate early in planning.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4, R9][Needs research] Which engine(s) for the pipeline: audio→reference alignment for piece ID/segmentation (e.g., chroma + DTW) and, separately, transcription for narrative detail (e.g., ByteDance high-resolution piano transcription, Klangio API, or Basic Pitch). Validate accuracy on real practice recordings — including the hard cases: hands-separate, very slow, and heavy repetition.
- [Affects R5][Technical] Segmentation strategy for piece boundaries within a session (silence gaps vs rolling-match changes) and the minimum-duration thresholds for emitting free-play entries vs absorbing noodling.
- [Affects R9][Technical] How measure references in the narrative are derived (MIDI tempo/time-signature → measure mapping) and how the narrative is generated from aligned note/feature data.
- [Affects R2][Technical] Where the processing runs given current hosting (server compute / GPU availability), and acceptable post-session processing latency.
