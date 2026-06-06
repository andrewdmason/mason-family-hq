# Tufte calendar prototype

A self-contained design exploration: what would the family calendar look like if
Edward Tufte designed it — not just aesthetically, but from an information-design
point of view?

- **`tufte-calendar.html`** — open it in a browser (no build, no auth, no data
  plumbing). It renders with realistic Mason-family sample data.
- **`tufte-calendar.png`** — a rendered screenshot for quick reference.

## What it shows

Two views stacked, sharing one data model:

1. **Week at a glance (macro)** — a small-multiples matrix, four people (rows) ×
   seven days (columns). Each cell is one person's day on a shared 6 a.m.–10 p.m.
   axis; bar position is the real start time, bar length the real duration. Read
   across a row for one person's week, down a column for the whole family's day.
   The macro rhythm (empty mornings, the Monday pile-up, the open weekend) appears
   without reading a word.
2. **Day in detail (micro)** — the same data on a true vertical time axis.
   Position encodes when; height encodes how long. Two bars that overlap in one
   column *are* a conflict — no warning icon required.

## The information-design moves (what Tufte would change)

1. **Restore a real time axis.** The current agenda is deliberately ordinal
   (Morning/Afternoon/Evening bands). Time and duration are data we already have —
   encode them as position and length.
2. **Duration as length.** A 15-minute standup and a 4-hour workshop should not be
   the same-size card.
3. **Conflicts as geometry, not iconography.** Overlap is visible; the amber ⚠
   becomes redundant.
4. **Erase chartjunk.** No card borders, fills, shadows, or rounded boxes. What
   remains is hour hairlines and text — data-ink ratio way up.
5. **Small multiples for comparison.** Four people as parallel columns on a shared
   axis; days as repeated frames. "Above all else, show comparisons."
6. **Direct labeling over legends.** Kill the top color-key chips; label in place.
7. **Macro + micro on one screen.** The week overview and the detailed day, both
   visible, reader chooses depth.

## Status

Exploration only — not wired to live data. The first production step already
taken on a separate branch is the **time-axis Day view** (`day-view.tsx`). The
remaining high-value idea to pull in is the **week-at-a-glance small-multiples
matrix**, which answers questions ("who's free Thursday?") the current UI can't.
