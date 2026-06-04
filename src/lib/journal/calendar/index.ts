import { loadFeedCached } from "./cache";
import { formatCalendarBlock } from "./format";
import { loadCalendarSources } from "./sources";
import type { CalendarWindow, FeedResult } from "./types";

export { clearCalendarCache } from "./cache";

const DAY_MS = 86400000;

// Recurring posts scale the calendar window to their cadence; clamp so a wild
// custom cadence can't ask for a year of events.
const MAX_LOOKBACK_DAYS = 92;
const MAX_LOOKAHEAD_DAYS = 31;

/**
 * Build the calendar context block for the interviewer's system prompt.
 * Returns null when there's nothing to inject (no sources, all failed and
 * empty, etc.) — caller treats that as "skip the block."
 *
 * `window` defaults to "recent": the block carries only past + already-happened
 * events, so a prompt can't surface something upcoming. Pass "ahead" only when
 * generating a forward-looking question (intentions).
 *
 * `spanDays` scales the window's primary direction to a recurring post's cadence
 * — a weekly recap looks back ~7 days, a monthly one ~30 (and "ahead" reaches
 * that far forward). Omitted, it keeps the built-in 3-back / 7-ahead window.
 */
export async function loadCalendarBlock(
  today: string,
  tz: string,
  window: CalendarWindow = "recent",
  spanDays?: number,
): Promise<string | null> {
  let sources;
  try {
    sources = await loadCalendarSources();
  } catch (err) {
    console.error("[journal/calendar] failed to load sources:", err);
    return null;
  }
  if (sources.length === 0) return null;

  // "recent" scales its lookback; "ahead" keeps a short 3-day tail and scales the
  // forward reach. Built-ins (no spanDays) get the original 3-back / 7-ahead.
  const span = Math.max(1, Math.round(spanDays ?? (window === "ahead" ? 7 : 3)));
  const lookbackDays = window === "recent" ? Math.min(span, MAX_LOOKBACK_DAYS) : 3;
  const lookaheadDays =
    window === "ahead" ? Math.min(span, MAX_LOOKAHEAD_DAYS) : 0;

  // Always fetch a fixed superset range so the per-feed cache (keyed by URL, not
  // range) can't serve a narrow fetch to a wide request. formatCalendarBlock
  // then trims to the window actually asked for. The pad absorbs TZ-boundary
  // drift in ical-expander's UTC comparison.
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const rangeStart = new Date(todayMs - (MAX_LOOKBACK_DAYS + 1) * DAY_MS);
  const rangeEnd = new Date(todayMs + (MAX_LOOKAHEAD_DAYS + 2) * DAY_MS);

  const settled = await Promise.allSettled(
    sources.map((s) => loadFeedCached(s, rangeStart, rangeEnd)),
  );

  const results: FeedResult[] = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    return {
      ok: false,
      sourceId: sources[i].id,
      sourceName: sources[i].displayName,
      error: s.reason instanceof Error ? s.reason.message : String(s.reason),
    };
  });

  for (const r of results) {
    if (!r.ok) {
      console.error(
        `[journal/calendar] feed "${r.sourceName}" failed: ${r.error}`,
      );
    }
  }

  const block = formatCalendarBlock(
    results,
    today,
    tz,
    new Date(),
    window,
    lookbackDays,
    lookaheadDays,
  );
  return block === "" ? null : block;
}
