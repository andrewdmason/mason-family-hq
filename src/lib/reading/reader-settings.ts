/**
 * How this device lays out a book.
 *
 * Deliberately per-device and not per-account: the right column count on a 27"
 * display is wrong on a phone, and the right font size depends on how far away
 * the screen is. Kindle makes the same call. Stored in localStorage, so there is
 * nothing to sync and nothing to migrate.
 *
 * Reading POSITION is the opposite — it's stored on the server as a character
 * offset precisely so it survives every setting in here changing.
 */

export type ReaderColumns = "auto" | 1 | 2;
export type ReaderMargins = "narrow" | "normal" | "wide";
export type ReaderAlign = "left" | "justify";

export type ReaderSettings = {
  /** False puts the book back in one long scroll. */
  paged: boolean;
  columns: ReaderColumns;
  margins: ReaderMargins;
  align: ReaderAlign;
  /** Index into FONT_STEPS. */
  fontStep: number;
  /** Index into LEADING_STEPS. */
  leading: number;
  /**
   * Whether the chat panel takes width from the book instead of floating over it.
   *
   * A viewing preference, and it must stay one: it may reach `bookAreaWidth` and
   * so `cols` and `offsetX`, but it must never reach `fragmentationFor`. Docking
   * on a narrow screen would otherwise re-lay-out the entire book, which is the
   * one thing the geometry is arranged to prevent — see PageGeometry.
   */
  chatDocked: boolean;
  /**
   * This device has an electrophoretic screen — a Boox, a Kindle-alike.
   *
   * Deliberately a setting rather than a detection. `@media (update: slow)` is
   * the feature CSS provides for exactly this, but it depends on the platform
   * telling the browser its display is slow, and an e-ink Android tablet runs
   * ordinary Chrome on hardware that reports itself as an ordinary display. It
   * is very unlikely to fire, and betting the whole appearance of the app on a
   * media query that silently never matches leaves nothing to fall back to.
   *
   * A flag sits naturally here anyway: everything in this file is already
   * per-device and never synced, which is exactly what "this screen is e-ink"
   * is. Turn it on once on the reader; the laptop never sees it.
   *
   * Unlike chatDocked this one DOES reach `fragmentationFor`, and has to: the
   * margins it changes are the column's own. Turning it on repaginates once,
   * which is the same cost as changing the Margins setting beside it.
   */
  eink: boolean;
};

/** Body text sizes, in rem. The old fixed reader size (1.15rem) is the default. */
export const FONT_STEPS = [0.95, 1.05, 1.15, 1.3, 1.5, 1.7] as const;
export const DEFAULT_FONT_STEP = 2;

/** Line height as a multiple of font size. The old reader was ~1.74 (leading-8 on 1.15rem). */
export const LEADING_STEPS = [1.5, 1.75, 2.05] as const;
export const DEFAULT_LEADING = 1;

/**
 * What the Margins setting actually controls: how wide a line of text is.
 *
 * The obvious reading of "margins" — a fixed inset before the text starts — does
 * nothing on a wide screen, because the column stops growing at a comfortable
 * measure long before the inset would bite. Set against a 1650px window, a
 * fixed-inset version of this produced three byte-identical layouts. So the
 * setting is expressed as the measure instead, which is the thing the reader is
 * actually choosing between; the margin is whatever's left over.
 *
 * Values are a comfortable range: roughly 75, 63 and 49 characters a line.
 */
export const MARGIN_MEASURE_PX: Record<ReaderMargins, number> = {
  narrow: 44 * 16,
  normal: 36 * 16,
  wide: 28 * 16,
};

/**
 * Minimum gap between the text and the window edge, per setting. This is what
 * the margin choice falls back to on a screen too narrow for the measures above
 * to differ — a phone, mostly. The narrow value still has to leave room for a
 * chat marker to sit outside the text column.
 */
export const MARGIN_INSET_PX: Record<ReaderMargins, number> = {
  narrow: 40,
  normal: 64,
  wide: 104,
};

/**
 * Below this width the fixed insets above stop being a choice.
 *
 * They were sized against a phone, where 40/64/104px still leaves a column wide
 * enough that MIN_COLUMN_WIDTH doesn't bite. Go much narrower — a 6" e-reader —
 * and the floor swallows the difference: at 300px every setting produces the
 * same 240px column and the Margins control silently does nothing, leaving text
 * size as the only way to change the measure, which is the wrong knob.
 *
 * 380 rather than something rounder because 412 CSS px is where the pocket
 * e-readers and most Android phones land, and there the fixed insets still give
 * three distinct columns (332/284/240). Only screens narrower than anything
 * already working take the proportional path.
 */
const PROPORTIONAL_INSET_BELOW_PX = 380;

/** Share of the screen each setting gives away, once the fixed values can't. */
const MARGIN_INSET_RATIO: Record<ReaderMargins, number> = {
  narrow: 0.05,
  normal: 0.1,
  wide: 0.16,
};

/**
 * Margins on an e-reader, which are far tighter — a third of the pointer scale.
 *
 * The values above are not really margins, they're a click target: the page-turn
 * arrows live in them, and they have to be wide enough to hit with a mouse and
 * to hold a chat marker outside the text. None of that is true here. An e-reader
 * has no pointer, so the arrows never render, and it turns pages by tapping the
 * text itself — which left 64px of reserved nothing down each side of a 412px
 * screen, a third of the display spent on a control that isn't there.
 *
 * What's left is a real margin: enough that the text isn't flush to the bezel,
 * and no more. On a 412px screen this is the difference between a 284px column
 * and a 356px one — about 31 characters a line against 39.
 */
const EINK_MARGIN_INSET_PX: Record<ReaderMargins, number> = {
  narrow: 16,
  normal: 28,
  wide: 48,
};

/**
 * The inset this margin setting actually gets on a screen this wide.
 *
 * Constant on anything phone-sized and up, so nothing that reads well today
 * moves. There is a small step at the threshold; crossing it means a resize,
 * which already repaginates and already keeps the reader's character offset.
 */
export function marginInsetFor(
  availableWidth: number,
  margins: ReaderMargins,
  eink = false
): number {
  const pointer =
    availableWidth >= PROPORTIONAL_INSET_BELOW_PX
      ? MARGIN_INSET_PX[margins]
      : Math.round(availableWidth * MARGIN_INSET_RATIO[margins]);
  if (!eink) return pointer;
  // Whichever is tighter. The e-ink scale is the smaller of the two on any
  // ordinary screen, but on a very narrow one the proportional fallback has
  // already squeezed the pointer margins below it — and an e-reader should
  // never end up with a *wider* margin than the device that needs room for
  // arrows. Taking the minimum makes "e-ink is never narrower" hold at every
  // width, which is the invariant the verify script asserts.
  return Math.min(EINK_MARGIN_INSET_PX[margins], pointer);
}

/**
 * Space between columns. Wide enough to hold a 24px chat marker with air on both
 * sides, because in two-column mode the gap is the left column's only gutter.
 */
export const COLUMN_GAP = 56;

/**
 * The narrowest column we're willing to split into two: the measure the Wide
 * setting asks for, which is the narrowest line the reader can deliberately
 * choose. Below it the second column stops being a page and becomes a novelty.
 */
const MIN_TWO_COLUMN_WIDTH = MARGIN_MEASURE_PX.wide;

/**
 * Whether two columns fit in `availableWidth` — the window, less whatever the
 * chat panel has taken (see bookAreaWidth).
 *
 * The margins are part of the question rather than separate from it: they decide
 * how much of the width is text, so on a laptop the narrowest setting is exactly
 * what tips the page over into two columns. This used to be one flat width
 * threshold, which is why narrowing the margins appeared to do nothing.
 */
export function fitsTwoColumns(
  availableWidth: number,
  margins: ReaderMargins,
  eink = false
): boolean {
  const forText = availableWidth - marginInsetFor(availableWidth, margins, eink) * 2 - COLUMN_GAP;
  return forText / 2 >= MIN_TWO_COLUMN_WIDTH;
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  paged: true,
  columns: "auto",
  margins: "normal",
  // Left, not justified: we have no hyphenation, and justified text without it
  // opens rivers of white space — visible in Kindle's own two-column view.
  align: "left",
  fontStep: DEFAULT_FONT_STEP,
  leading: DEFAULT_LEADING,
  // Floating, because docking costs a column. Two columns at a comfortable
  // measure plus a 448px panel needs about 1780px of window; a 15" laptop hasn't
  // got it, so the honest default is a panel that sits over the page and leaves
  // the book exactly as it was.
  chatDocked: false,
  eink: false,
};

const STORAGE_KEY = "reader:layout";

function clampStep(value: unknown, length: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < length
    ? value
    : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Read this device's settings, falling back to defaults for anything unset or corrupt. */
export function loadSettings(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  let raw: unknown;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_SETTINGS;
    raw = JSON.parse(stored);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const s = raw as Partial<Record<keyof ReaderSettings, unknown>>;
  return {
    paged: typeof s.paged === "boolean" ? s.paged : DEFAULT_SETTINGS.paged,
    columns:
      s.columns === 1 || s.columns === 2 || s.columns === "auto"
        ? s.columns
        : DEFAULT_SETTINGS.columns,
    margins: oneOf(s.margins, ["narrow", "normal", "wide"] as const, DEFAULT_SETTINGS.margins),
    align: oneOf(s.align, ["left", "justify"] as const, DEFAULT_SETTINGS.align),
    fontStep: clampStep(s.fontStep, FONT_STEPS.length, DEFAULT_FONT_STEP),
    leading: clampStep(s.leading, LEADING_STEPS.length, DEFAULT_LEADING),
    chatDocked:
      typeof s.chatDocked === "boolean" ? s.chatDocked : DEFAULT_SETTINGS.chatDocked,
    eink: typeof s.eink === "boolean" ? s.eink : DEFAULT_SETTINGS.eink,
  };
}

/**
 * A tiny store over localStorage, so the reader can subscribe with
 * useSyncExternalStore rather than copying the stored value into React state on
 * mount. Two upsides beyond tidiness: the server renders the defaults without a
 * hydration mismatch, and a change made in one tab reaches the others.
 *
 * getSnapshot has to return a stable reference or React re-renders forever, so
 * the parsed value is cached against the raw string it came from.
 */
let cachedRaw: string | null = null;
let cachedValue: ReaderSettings = DEFAULT_SETTINGS;
const listeners = new Set<() => void>();

function currentRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export const readerSettingsStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  },
  getSnapshot(): ReaderSettings {
    const raw = currentRaw();
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedValue = loadSettings();
    }
    return cachedValue;
  },
  getServerSnapshot(): ReaderSettings {
    return DEFAULT_SETTINGS;
  },
  set(settings: ReaderSettings): void {
    const raw = JSON.stringify(settings);
    cachedRaw = raw;
    cachedValue = settings;
    try {
      window.localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      // Private browsing / quota. Settings don't persist; reading still works.
    }
    for (const listener of listeners) listener();
  },
};

/**
 * Columns actually used, once the request has met the space available.
 *
 * "Auto" and an explicit 2 agree: two columns whenever two columns fit. Asking
 * for two is a preference to be honoured when there's room, not a promise we can
 * keep on a phone — and it's remembered while it can't be, so closing the chat
 * panel gives the second column back.
 */
export function effectiveColumns(settings: ReaderSettings, availableWidth: number): 1 | 2 {
  if (settings.columns === 1) return 1;
  return fitsTwoColumns(availableWidth, settings.margins, settings.eink) ? 2 : 1;
}
