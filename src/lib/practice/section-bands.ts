// Band tiling for piece sections over a measure timeline (plan U5/KTD5).
//
// Extracted verbatim from the Measure view's band computation
// (src/components/repertoire/measure-view-panel.tsx) so the Measure view and
// recording-enrichment display share one rule and can't drift:
//   - placed parents (start_measure != null) sort by start; each band runs to
//     the next placed parent's start, the last to totalMeasures + 1
//   - placed subsections tile the same way WITHIN their parent's band; the
//     last runs to the parent band's end
//   - unplaced sections produce no bands, and children of unplaced parents
//     never tile (there is no parent band to tile within) — a span over them
//     shows measure numbers only (R8)
//
// `totalMeasures` is a parameter: the Measure view passes its parsed roll's
// count, enrichment passes the count stored from the worker callback
// (practice_recordings.alignment.totalMeasures), so no reference-MIDI parse
// is needed at read time.

import type { PieceSection, PieceSectionWithChildren } from "@/lib/types";

export type SectionBand = {
  section: PieceSection;
  startMeasure: number;
  endMeasure: number; // exclusive (next marker at the same level, or end of span)
};

export type SectionBands = {
  parentBands: SectionBand[];
  subBands: SectionBand[];
};

/**
 * Tile sections into parent and subsection bands. `startMeasureOf` lets a
 * caller override placement per section (the Measure view's optimistic drag
 * override); it defaults to the stored marker.
 */
export function computeSectionBands(
  sections: PieceSectionWithChildren[],
  totalMeasures: number,
  startMeasureOf: (s: PieceSection) => number | null = (s) => s.start_measure
): SectionBands {
  const parents = sections.filter((p) => p.parent_id === null);
  const placedParents = parents
    .map((p) => ({ p, m: startMeasureOf(p) }))
    .filter((x): x is { p: PieceSectionWithChildren; m: number } => x.m != null)
    .sort((a, b) => a.m - b.m);

  const parentBands: SectionBand[] = placedParents.map((x, i) => ({
    section: x.p,
    startMeasure: x.m,
    endMeasure:
      i + 1 < placedParents.length ? placedParents[i + 1].m : totalMeasures + 1,
  }));

  const subBands: SectionBand[] = [];
  parentBands.forEach((pb, i) => {
    const parent = placedParents[i].p;
    const placedSubs = parent.children
      .map((c) => ({ c, m: startMeasureOf(c) }))
      .filter((x): x is { c: PieceSection; m: number } => x.m != null)
      .sort((a, b) => a.m - b.m);
    placedSubs.forEach((x, j) => {
      subBands.push({
        section: x.c,
        startMeasure: x.m,
        endMeasure:
          j + 1 < placedSubs.length ? placedSubs[j + 1].m : pb.endMeasure,
      });
    });
  });

  return { parentBands, subBands };
}

/**
 * The bands an alignment span touches, per tier. Measures are 1-based and the
 * span is INCLUSIVE on both ends (AlignmentSpan.measureStart/measureEnd);
 * band ends are exclusive. Empty results = no placed sections cover the span
 * (show measure numbers only, never a warning — R8).
 */
export function sectionsForSpan(
  bands: SectionBands,
  measureStart: number,
  measureEnd: number
): { parents: SectionBand[]; subs: SectionBand[] } {
  const overlaps = (b: SectionBand) =>
    b.startMeasure <= measureEnd && b.endMeasure > measureStart;
  return {
    parents: bands.parentBands.filter(overlaps),
    subs: bands.subBands.filter(overlaps),
  };
}
