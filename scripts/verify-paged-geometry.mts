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
  CHAT_PANEL_WIDTH,
  computeGeometry,
  sameFragmentation,
  sameGeometry,
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
  { name: "MacBook 13", w: 1512, h: 982 },
  { name: "MacBook 15", w: 1705, h: 900 },
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
      const closed = computeGeometry(device.w, device.h, settings, "closed");
      for (const panel of ["floating", "docked"] as const) {
        const open = computeGeometry(device.w, device.h, settings, panel);
        check(
          `${device.name} / ${margins} / cols ${columns} / ${panel}`,
          sameFragmentation(closed, open),
          `${label(closed)} → ${label(open)}`
        );
      }
    }
  }
}

console.log("\ngeometry stays on whole pixels");
// A 600-page book is 600+ strides wide; a third of a pixel of error per stride
// is 200px of drift by the end, which is the difference between the right page
// and the wrong one.
for (const device of DEVICES) {
  for (const margins of MARGINS) {
    for (const panel of ["closed", "floating", "docked"] as const) {
      const settings = settingsFor(margins, "auto");
      const g = computeGeometry(device.w, device.h, settings, panel);
      const integral = [g.colW, g.gap, g.pageH, g.viewW, g.colStride, g.pageStride, g.offsetX];
      check(
        `${device.name} / ${margins} / panel ${panel}`,
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

console.log("\na docked panel is never run under");
for (const device of DEVICES) {
  for (const margins of MARGINS) {
    const settings = settingsFor(margins, "auto");
    const docked = sidePanelFits(device.w, settings);
    const g = computeGeometry(device.w, device.h, settings, docked ? "docked" : "closed");
    check(
      `${device.name} / ${margins}`,
      g.offsetX + g.viewW <= bookAreaWidth(device.w, docked),
      `${label(g)} in ${bookAreaWidth(device.w, docked)}px`
    );
  }
}

console.log("\na floating panel changes nothing at all");
// The whole point of the float, and the strongest form the claim can take: not
// "a cheap re-layout", not "a repaint only" — the same numbers. The reader's eye
// is somewhere in a sentence when the panel opens, and nothing may move under
// it. An earlier version slid the page out from under the panel to avoid
// covering the outer column; that slide WAS the disorienting re-layout this
// exists to prevent, which is why the invariant is equality and not a bound.
for (const device of DEVICES) {
  for (const margins of MARGINS) {
    for (const columns of COLUMN_PREFS) {
      const settings = settingsFor(margins, columns);
      const closed = computeGeometry(device.w, device.h, settings, "closed");
      const floating = computeGeometry(device.w, device.h, settings, "floating");
      check(
        `${device.name} / ${margins} / cols ${columns}`,
        sameGeometry(closed, floating) &&
          closed.pageH === floating.pageH &&
          closed.pageStride === floating.pageStride,
        `${label(closed)} → ${label(floating)}`
      );
    }
  }
}

console.log("\nwhat a floating panel covers, so the cost is on the record");
// It buys "nothing moves" with "something is hidden". Recorded rather than
// asserted: the number is a consequence of the panel's width, and the dock
// button is the answer to it.
for (const device of DEVICES) {
  const settings = settingsFor("normal", "auto");
  // Only where a floating panel is what you'd actually get. Anything narrower
  // gets a sheet, which covers the page by design and on purpose.
  if (!sidePanelFits(device.w, settings)) continue;
  const g = computeGeometry(device.w, device.h, settings, "floating");
  const textRight = g.offsetX + g.viewW;
  const covered = Math.max(0, textRight - (device.w - CHAT_PANEL_WIDTH));
  const outerColumn = g.colW;
  console.log(
    `  note ${device.name} / normal: ${covered}px of the outer ${outerColumn}px column` +
      ` (${Math.round((covered / outerColumn) * 100)}%)`
  );
}

console.log("\nthe devices this was actually broken on");
// Literal expectations, so a change of measure or panel width shows up as a
// deliberate decision rather than a quietly different layout.
const expectations: {
  name: string;
  w: number;
  h: number;
  /** Columns closed, floating, docked. */
  cols: [1 | 2, 1 | 2, 1 | 2];
  colW: number;
}[] = [
  // The column width is the same in all three, which is the whole point: the
  // text never moves on the page. Only how many columns are shown, and where the
  // page sits, ever change.
  { name: "iPad landscape", w: 1194, h: 834, cols: [2, 2, 1], colW: 505 },
  { name: "MacBook 13", w: 1512, h: 982, cols: [2, 2, 1], colW: 576 },
  // The window this was reported from. Floating keeps both columns everywhere,
  // because it isn't consulted; docking is the only thing that spends one, and
  // it wants ~1784px before it stops having to.
  { name: "MacBook 15", w: 1705, h: 900, cols: [2, 2, 1], colW: 576 },
  // Wide enough that even a docked panel comes out of the margin.
  { name: "large display", w: 2560, h: 1440, cols: [2, 2, 2], colW: 576 },
];
for (const e of expectations) {
  const settings = settingsFor("normal", "auto");
  const got = (["closed", "floating", "docked"] as const).map((panel) =>
    computeGeometry(e.w, e.h, settings, panel)
  );
  check(
    `${e.name}: ${e.cols.join("/")} columns closed/floating/docked, all at ${e.colW}px`,
    got.every((g, i) => g.cols === e.cols[i] && g.colW === e.colW),
    got.map(label).join(" → ")
  );
}

console.log("\na sheet is used exactly where a panel wouldn't fit");
check(
  "iPad portrait gets a sheet",
  !sidePanelFits(834, settingsFor("normal", "auto")),
  `${bookAreaWidth(834, true)}px left for a ${computeGeometry(834, 1194, settingsFor("normal", "auto"), "closed").colW}px column`
);
check("iPad landscape keeps the side panel", sidePanelFits(1194, settingsFor("normal", "auto")));
check("MacBook 13 keeps the side panel", sidePanelFits(1512, settingsFor("normal", "auto")));
check("a phone gets a sheet", !sidePanelFits(390, settingsFor("normal", "auto")));

console.log(
  failures === 0 ? "\nAll paged geometry invariants hold." : `\n${failures} check(s) failed.`
);
process.exit(failures === 0 ? 0 : 1);
