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
 * Space between columns. Wide enough to hold a 24px chat marker with air on both
 * sides, because in two-column mode the gap is the left column's only gutter.
 */
export const COLUMN_GAP = 56;

/** Below this viewport width, "auto" columns resolves to one. */
export const TWO_COLUMN_MIN_WIDTH = 1180;

export const DEFAULT_SETTINGS: ReaderSettings = {
  paged: true,
  columns: "auto",
  margins: "normal",
  // Left, not justified: we have no hyphenation, and justified text without it
  // opens rivers of white space — visible in Kindle's own two-column view.
  align: "left",
  fontStep: DEFAULT_FONT_STEP,
  leading: DEFAULT_LEADING,
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

/** Columns actually used, once "auto" has met the viewport. */
export function effectiveColumns(settings: ReaderSettings, viewportWidth: number): 1 | 2 {
  if (settings.columns === 1) return 1;
  if (settings.columns === 2) return viewportWidth >= TWO_COLUMN_MIN_WIDTH ? 2 : 1;
  return viewportWidth >= TWO_COLUMN_MIN_WIDTH ? 2 : 1;
}
