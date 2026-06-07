# Tufte calendar prototype

A self-contained design exploration: what would the family calendar look like if
Edward Tufte designed it — not just aesthetically, but from an information-design
point of view?

- **`tufte-calendar.html`** — open it in a browser (no build, no auth, no data
  plumbing). It renders with realistic Mason-family sample data.
- **`tufte-calendar.png`** — a rendered screenshot for quick reference.

## Current focus: the shared-event problem

The live Day view (`day-view.tsx`) already restored a true time axis with a
column per person. The open question this prototype now tackles: **how do you draw
one event attended by some _combination_ of the four people?** Today's build draws
a shared event up to four times — a full card in an arbitrary "owner's" column plus
a dashed *ghost* in each attendee's column.

The prototype argues that an event is really *one interval + a set of attendees*
(a subset of four, so one of sixteen combinations), and shows Tufte's response:

- **Solo time stays in person-colored columns** (what columns are good at).
- **Shared time is drawn once**, as a neutral object: faint blocks under *exactly*
  the attending columns, joined by a labeled bracket, with a four-cell attendance
  glyph (●●●○). No ghosts, no owner, no duplication; non-contiguous sets
  (Jenny + Oscar) read honestly.
- A **head-to-head** panel contrasts three treatments on the hardest case
  (a non-contiguous pair): current ghosts (drawn 2×), the tied-bracket
  (drawn 1×), and an alternative shared "Together" lane (drawn 1×).

### What Tufte changes about shared events

1. **Draw it once** — one labeled object, not an owner card plus ghosts.
2. **Kill the "owner"** — the owner/attendee split isn't in the data; a shared
   event is symmetric. Neutral = "ours," person color = "mine."
3. **Make the combination legible** — which columns are filled *is* the attendee
   set, backed by the glyph for certainty.
4. **Keep columns only for what they're good at** — solo scanning down a column;
   shared events become a relation drawn *across* columns, not copies sitting *in*
   them.
5. **Layer "ours" behind "mine"** — shared events recede in warm gray so each
   person's own commitments pop.

## Earlier ideas (still unbuilt)

The first version of this prototype also explored a **week-at-a-glance
small-multiples matrix** (four people × seven days, each cell a day-sparkline on a
shared axis) — the macro view that answers "who's free Thursday?" at a glance.
That remains the highest-value idea not yet pulled into the product.

## Status

Exploration only — not wired to live data. Open `tufte-calendar.html` to interact;
`tufte-calendar.png` is a snapshot.
