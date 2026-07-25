/**
 * The invariant that opening the chat panel must never re-fragment the book.
 *
 * This exists because we shipped that fix once and it didn't hold. The version
 * before this one compared the book's column shape against the full window and
 * only narrowed when the panel would collide with the text — which is correct,
 * and which turned out to be true only on a window at least 1656px wide. On
 * every device this family actually reads on, opening the chat still changed the
 * column shape, and still re-laid-out 1.1M characters, twice per conversation.
 *
 * The arithmetic is pure and DOM-free, so it can simply be asserted. Anything
 * that changes the measures, the insets, the gap or the panel's width has to
 * come back through here.
 *
 *   npx tsx scripts/verify-paged-geometry.mts
 */

import {
  computeGeometry,
  sameFragmentation,
  sidePanelFits,
  bookAreaWidth,
  type PageGeometry,
} from "../src/lib/reading/paged-geometry";
import {
  DEFAULT_SETTINGS,
  type ReaderMargins,
  type ReaderSettings,
} from "../src/lib/reading/reader-settings";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Widths worth caring about, named so a failure says which device broke. */
const DEVICES: { name: string; w: number; h: number }[] = [
  { name: "iPhone portrait", w: 390, h: 844 },
  { name: "iPhone landscape", w: 844, h: 390 },
  { name: "iPad portrait", w: 834, h: 1194 },
  { name: "iPad landscape", w: 1194, h: 834 },
  { name: "iPad 12.9 landscape", w: 1366, h: 1024 },
  { name: "MacBook", w: 1512, h: 982 },
  { name: "large display", w: 2560, h: 1440 },
];

const MARGINS: ReaderMargins[] = ["narrow", "normal", "wide"];
const COLUMN_PREFS: ReaderSettings["columns"][] = [1, 2, "auto"];

function settingsFor(margins: ReaderMargins, columns: ReaderSettings["columns"]): ReaderSettings {
  return { ...DEFAULT_SETTINGS, margins, columns };
}

function label(g: PageGeometry): string {
  return `${g.cols}x${g.colW} gap${g.gap} view${g.viewW} off${g.offsetX}`;
}

console.log("\nopening the chat never re-fragments the book");
for (const device of DEVICES) {
  for (const margins of MARGINS) {
    for (const columns of COLUMN_PREFS) {
      const settings = settingsFor(margins, columns);
      // The reader only narrows the book for a panel it can actually fit
      // alongside; anything narrower gets a sheet, which takes no width at all.
      if (!sidePanelFits(device.w, settings)) continue;
      const closed = computeGeometry(device.w, device.h, settings, false);
      const open = computeGeometry(device.w, device.h, settings, true);
      check(
        `${device.name} / ${margins} / cols ${columns}`,
        sameFragmentation(closed, open),
        `${label(closed)} → ${label(open)}`
      );
    }
  }
}

console.log("\ngeometry stays on whole pixels");
// A 600-page book is 600+ strides wide; a third of a pixel of error per stride
// is 200px of drift by the end, which is the difference between the right page
// and the wrong one.
for (const device of DEVICES) {
  for (const margins of MARGINS) {
    for (const open of [false, true]) {
      const settings = settingsFor(margins, "auto");
      const g = computeGeometry(device.w, device.h, settings, open);
      const integral = [g.colW, g.gap, g.pageH, g.viewW, g.colStride, g.pageStride, g.offsetX];
      check(
        `${device.name} / ${margins} / panel ${open ? "open" : "closed"}`,
        integral.every(Number.isInteger) &&
          g.colStride === g.colW + g.gap &&
          g.pageStride === g.cols * g.colStride &&
          g.viewW === g.cols * g.colW + (g.cols - 1) * g.gap &&
          g.offsetX >= 0,
        label(g)
      );
    }
  }
}

console.log("\nthe book never runs under the panel");
for (const device of DEVICES) {
  for (const margins of MARGINS) {
    const settings = settingsFor(margins, "auto");
    const narrows = sidePanelFits(device.w, settings);
    const g = computeGeometry(device.w, device.h, settings, narrows);
    check(
      `${device.name} / ${margins}`,
      g.offsetX + g.viewW <= bookAreaWidth(device.w, narrows),
      `${label(g)} in ${bookAreaWidth(device.w, narrows)}px`
    );
  }
}

console.log("\nthe devices this was actually broken on");
// Literal expectations, so a change of measure or panel width shows up as a
// deliberate decision rather than a quietly different layout.
const expectations: { name: string; w: number; h: number; cols: [1 | 2, 1 | 2]; colW: number }[] = [
  // Two columns closed, one column open — and the same column width both ways,
  // which is the whole point: the text does not move on the page, the page just
  // stops showing the second column.
  { name: "iPad landscape", w: 1194, h: 834, cols: [2, 1], colW: 505 },
  { name: "MacBook", w: 1512, h: 982, cols: [2, 1], colW: 576 },
  // Wide enough that the panel comes out of the margin and nothing changes.
  { name: "large display", w: 2560, h: 1440, cols: [2, 2], colW: 576 },
];
for (const e of expectations) {
  const settings = settingsFor("normal", "auto");
  const closed = computeGeometry(e.w, e.h, settings, false);
  const open = computeGeometry(e.w, e.h, settings, true);
  check(
    `${e.name}: ${e.cols[0]} column(s) → ${e.cols[1]}, both at ${e.colW}px`,
    closed.cols === e.cols[0] &&
      open.cols === e.cols[1] &&
      closed.colW === e.colW &&
      open.colW === e.colW,
    `${label(closed)} → ${label(open)}`
  );
}

console.log("\na sheet is used exactly where a panel wouldn't fit");
check(
  "iPad portrait gets a sheet",
  !sidePanelFits(834, settingsFor("normal", "auto")),
  `${bookAreaWidth(834, true)}px left for a ${computeGeometry(834, 1194, settingsFor("normal", "auto"), false).colW}px column`
);
check("iPad landscape keeps the side panel", sidePanelFits(1194, settingsFor("normal", "auto")));
check("MacBook keeps the side panel", sidePanelFits(1512, settingsFor("normal", "auto")));
check("a phone gets a sheet", !sidePanelFits(390, settingsFor("normal", "auto")));

console.log(
  failures === 0 ? "\nAll paged geometry invariants hold." : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
