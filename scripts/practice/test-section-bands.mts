// Band-tiling + span-lookup verification for src/lib/practice/section-bands.ts
// (plan U5/KTD5). Pure logic, no DB, no network.
// Run: npx tsx scripts/practice/test-section-bands.mts
//
// The fixture mirrors Ballade 4's shape: placed parents whose bands tile the
// timeline, subsections tiling within their parents, and unplaced sections
// (both a whole parent and stray children) that must produce no bands.

import {
  computeSectionBands,
  sectionsForSpan,
  type SectionBand,
} from "../../src/lib/practice/section-bands";
import type {
  PieceSection,
  PieceSectionWithChildren,
} from "../../src/lib/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

let seq = 0;
function section(
  label: string,
  startMeasure: number | null,
  parentId: string | null = null
): PieceSection {
  seq += 1;
  return {
    id: `s${seq}-${label}`,
    piece_id: "ballade4",
    parent_id: parentId,
    label,
    name: null,
    notes: null,
    sort_order: seq,
    status: 0,
    target_tempo: null,
    start_measure: startMeasure,
    created_at: "2026-07-02T00:00:00Z",
    updated_at: "2026-07-02T00:00:00Z",
  };
}

function parent(
  label: string,
  startMeasure: number | null,
  children: { label: string; startMeasure: number | null }[] = []
): PieceSectionWithChildren {
  const p = section(label, startMeasure);
  return {
    ...p,
    children: children.map((c) => section(c.label, c.startMeasure, p.id)),
  };
}

// Ballade 4 shape: 239 measures; intro, themes, an unplaced section, coda.
// Deliberately given OUT of measure order (sort_order != placement order) to
// prove tiling sorts by start_measure.
const TOTAL_MEASURES = 239;
const sections: PieceSectionWithChildren[] = [
  parent("A", 8, [
    { label: "A1", startMeasure: 8 },
    { label: "A2", startMeasure: 23 },
    { label: "A3", startMeasure: null }, // unplaced child of a placed parent
  ]),
  parent("Intro", 1),
  parent("B", 58),
  // Unplaced parent WITH a placed child: neither may tile (no parent band).
  parent("C", null, [{ label: "C1", startMeasure: 100 }]),
  parent("Coda", 210, [{ label: "Coda-fig", startMeasure: 219 }]),
];

const bands = computeSectionBands(sections, TOTAL_MEASURES);
const fmt = (b: SectionBand) => `${b.section.label}[${b.startMeasure},${b.endMeasure})`;

console.log("parent tiling:");
check(
  "placed parents tile in start order, each ending at the next marker, last at totalMeasures+1",
  bands.parentBands.map(fmt).join(" ") ===
    "Intro[1,8) A[8,58) B[58,210) Coda[210,240)",
  bands.parentBands.map(fmt).join(" ")
);
check(
  "unplaced parent C produces no band",
  !bands.parentBands.some((b) => b.section.label === "C")
);

console.log("subsection tiling:");
check(
  "subs tile within their parent, last one running to the parent band's end",
  bands.subBands.map(fmt).join(" ") === "A1[8,23) A2[23,58) Coda-fig[219,240)",
  bands.subBands.map(fmt).join(" ")
);
check(
  "unplaced child A3 produces no band",
  !bands.subBands.some((b) => b.section.label === "A3")
);
check(
  "placed child of an UNPLACED parent produces no band",
  !bands.subBands.some((b) => b.section.label === "C1")
);

console.log("start-measure override (Measure view's drag override):");
const codaId = sections.find((s) => s.label === "Coda")!.id;
const dragged = computeSectionBands(sections, TOTAL_MEASURES, (s) =>
  s.id === codaId ? 200 : s.start_measure
);
check(
  "override moves Coda to 200 and re-tiles B's end",
  dragged.parentBands.map(fmt).join(" ") ===
    "Intro[1,8) A[8,58) B[58,200) Coda[200,240)",
  dragged.parentBands.map(fmt).join(" ")
);
check(
  "Coda's sub re-tiles against the overridden parent end",
  dragged.subBands.some((b) => fmt(b) === "Coda-fig[219,240)")
);

console.log("sectionsForSpan (inclusive measures vs exclusive band ends):");
const labels = (r: { parents: SectionBand[]; subs: SectionBand[] }) =>
  `${r.parents.map((b) => b.section.label).join(",")}|${r.subs
    .map((b) => b.section.label)
    .join(",")}`;

check(
  "span inside one sub: mm 30-40 -> A / A2",
  labels(sectionsForSpan(bands, 30, 40)) === "A|A2",
  labels(sectionsForSpan(bands, 30, 40))
);
check(
  "span crossing a parent boundary: mm 55-60 -> A,B / A2",
  labels(sectionsForSpan(bands, 55, 60)) === "A,B|A2",
  labels(sectionsForSpan(bands, 55, 60))
);
check(
  "boundary measure belongs to the RIGHT band: mm 58-58 -> B only (A ends exclusive at 58)",
  labels(sectionsForSpan(bands, 58, 58)) === "B|",
  labels(sectionsForSpan(bands, 58, 58))
);
check(
  "last measure of a band: mm 57-57 -> A / A2",
  labels(sectionsForSpan(bands, 57, 57)) === "A|A2",
  labels(sectionsForSpan(bands, 57, 57))
);
check(
  "span in the coda: mm 220-230 -> Coda / Coda-fig",
  labels(sectionsForSpan(bands, 220, 230)) === "Coda|Coda-fig",
  labels(sectionsForSpan(bands, 220, 230))
);
check(
  "final measure still covered: mm 239-239 -> Coda / Coda-fig",
  labels(sectionsForSpan(bands, 239, 239)) === "Coda|Coda-fig"
);
check(
  "span past the piece: mm 240-260 -> nothing",
  labels(sectionsForSpan(bands, 240, 260)) === "|"
);
check(
  "span over the unplaced section's measures still reads as its covering parent (B), never C",
  labels(sectionsForSpan(bands, 100, 110)) === "B|"
);

console.log("degenerate shapes:");
const none = computeSectionBands([], TOTAL_MEASURES);
check(
  "no sections -> no bands",
  none.parentBands.length === 0 && none.subBands.length === 0
);
const allUnplaced = computeSectionBands(
  [parent("X", null, [{ label: "X1", startMeasure: 5 }])],
  TOTAL_MEASURES
);
check(
  "all parents unplaced -> no bands at all (span shows measure numbers only)",
  allUnplaced.parentBands.length === 0 && allUnplaced.subBands.length === 0
);
const single = computeSectionBands([parent("Solo", 12)], 50);
check(
  "single placed parent spans to totalMeasures+1",
  single.parentBands.map(fmt).join("") === "Solo[12,51)",
  single.parentBands.map(fmt).join("")
);
check(
  "measures before the first placed parent are uncovered: mm 1-11 -> nothing",
  labels(sectionsForSpan(single, 1, 11)) === "|"
);

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
