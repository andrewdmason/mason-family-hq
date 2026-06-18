# Practice-alignment spike (plan U1)

Go/no-go test for "Listen and auto-log practice": can windowed chroma + subsequence
DTW against reference MIDIs reliably tell **which piece** is being played and **which
measures**, on real (messy) practice audio? Everything downstream rides on this.

See plan: `docs/plans/2026-06-18-001-feat-listen-auto-log-practice-plan.md`.

## Layout
- `references/` — reference MIDIs (the "answer keys"). Seeded with Chopin Ballade No. 4
  and Bach French Suite No. 5.
- `midi_reference.py` — reference side: MIDI → time-gridded chroma template + measure/key.
  **Validated.** Needs only `mido`.
- `align.py` — audio side: recording → chroma → subsequence DTW vs each reference →
  piece + measure range + confidence margin. **Not yet validated — needs recordings.**
- `.venv/` — local venv (gitignored).

## Run
```
./.venv/bin/python midi_reference.py references/*.mid        # reference validation (works now)
./.venv/bin/pip install -r requirements.txt                  # add librosa when audio is in hand
./.venv/bin/python align.py recordings/<your-take>.m4a       # the real test
```

## Findings so far (reference side, 2026-06-18)

**Chopin Ballade No. 4 — excellent reference.** 6060 notes, full piano range, 12 tempo
events (real rubato), correct **6/8**, ~298 measures. Global pitch-class profile is
textbook **F minor** (C/F/Bb/Db/Ab dominant) — confirms the notes are right. Hand split
@C4 is ~35/65, so per-hand reference chroma for the hands-separate test is viable. The
full MIDI→chroma+measure-map pipeline runs clean on it. **Use this as the primary
measure-localization test case.**

**Bach French Suite No. 5 — usable, with two caveats.**
1. Notes are correct (3838 notes, profile is unambiguous **G major**: G/A/D/B/E/F#/C).
2. **Strict parser (`mido`) rejects it** ("no MTrk header at start of track") — an
   old-sequencer quirk. A lenient parser reads it fine. Production lesson: the worker
   must use a lenient MIDI loader (`@tonejs/midi` is lenient); don't assume all
   user-supplied MIDIs are spec-clean.
3. It's the **whole multi-movement suite flattened to a single 4/4 @ 120** (one time-sig
   event, one tempo). Recognition is fine, but the **measure map is only valid for the
   4/4 movements** — measure numbers on the Courante (3/4), Sarabande (3/4), Gigue
   (12/16) etc. will be wrong. For clean per-movement measure localization we'd split it
   into per-movement references. So: use Bach mainly to test **piece recognition**, not
   measure precision.

## Audio results (2026-06-18) — GO

Five real recordings, aligned (whole-file subsequence DTW, MIDI-binned chroma, **no
windowing, no per-hand templates, no tuning** — the crudest possible version):

| recording | matched | cost | margin | verdict | measures |
|---|---|---|---|---|---|
| chopin_normal | chopin ✓ | 0.259 | 0.139 | CONFIDENT | 5–49 (the opening — correct) |
| hands-separate | chopin ✓ | 0.334 | 0.118 | CONFIDENT | 72–94 |
| loop | chopin ✓ | 0.305 | 0.171 | CONFIDENT | 266–281 (smeared — expected) |
| bach | bach ✓ | 0.199 | 0.189 | CONFIDENT | 1–28 |
| scale | (none) | 0.387 | 0.071 | NO PIECE MATCH → scale/free-play ✓ |

**Piece ID: 4/4 real pieces correct, including both hard cases** (hands-separate and
heavy repetition still matched the right piece). The scale correctly fails the two-factor
gate (high cost + thin margin) → routes to scale/free-play, exactly as designed.

**Measure localization:** chopin_normal → measures 5–49 for "the opening" is spot on; bach
→ 1–28 from the movement start. The loop smeared across ~16 measures — the known
whole-file-DTW repetition weakness that the planned **windowed** alignment is meant to turn
into a repetition *signal*.

**Confidence gate:** `cost < 0.36 AND margin > 0.10` cleanly separates real matches
(cost 0.20–0.33) from the non-match scale (0.39). Tune against more pieces.

**Caveats:** only 2 references (margins may compress with 12); whole-file not windowed;
measure precision beyond "right region" not yet verified against ground truth. None of
these threaten the core bet — they're the difference between this crude spike and the
planned production pipeline, which should only do better.
