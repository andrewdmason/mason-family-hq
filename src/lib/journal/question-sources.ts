import type { CalendarWindow } from "@/lib/journal/calendar/types";

// Single source of truth for which data each question type loads into its prompt.
//
// CONTEXT_SPECS drives prompt assembly on the server (opening-candidates.ts builds
// each candidate against only its spec's sources), and sourcesFor() derives the
// human-facing "pills" shown under each type in the questions editor. This file is
// client-safe — types only, no server imports — so the editor can import it too.

/** The family-followup question type's kebab name. */
export const FAMILY_FOLLOWUP = "family-followup";

/** The currently-reading question type's kebab name. */
export const CURRENTLY_READING = "currently-reading";

/**
 * The sources a question type is allowed to see. Each candidate is generated in
 * its own model call against a prompt built from only these sources, so a type
 * structurally *cannot* draw on data it isn't given — no prose "never ask about…"
 * guard required. `calendar` also picks the time window (see CalendarWindow):
 * "recent" carries only past + already-happened events; "ahead" is the only
 * window that looks forward.
 */
export type CategoryContextSpec = {
  present: boolean;
  past: boolean;
  history: boolean;
  calendar: CalendarWindow | "none";
};

/**
 * Per-built-in source specs. A type's `base_description` still says what it asks
 * about; this controls what data it can actually see while asking. Keep the two
 * in sync — e.g. me-topic's description says "stays in the Present doc" and its
 * spec gives it only the Present doc.
 */
export const CONTEXT_SPECS: Record<string, CategoryContextSpec> = {
  "recent-calendar": { present: false, past: false, history: false, calendar: "recent" },
  "historical-followup": { present: false, past: false, history: true, calendar: "none" },
  "me-topic": { present: true, past: false, history: false, calendar: "none" },
  "deep-introspective": { present: true, past: true, history: true, calendar: "none" },
  gratitude: { present: true, past: false, history: true, calendar: "none" },
  intentions: { present: true, past: false, history: false, calendar: "ahead" },
  relationship: { present: true, past: false, history: true, calendar: "none" },
  curveball: { present: false, past: false, history: false, calendar: "none" },
  favorites: { present: false, past: false, history: false, calendar: "none" },
  imagination: { present: false, past: false, history: false, calendar: "none" },
  "proud-moment": { present: false, past: false, history: true, calendar: "none" },
  "funny-moment": { present: false, past: false, history: true, calendar: "none" },
  reminiscence: { present: false, past: true, history: false, calendar: "none" },
  "family-followup": { present: false, past: false, history: false, calendar: "none" },
  principles: { present: true, past: true, history: true, calendar: "none" },
  // The book itself is folded into the category description (like family-followup),
  // so the spec only governs the standard docs: history lets it pick up earlier
  // entries about the book; no present/calendar so it stays on the reading thread.
  "currently-reading": { present: false, past: false, history: true, calendar: "none" },
};

/**
 * Custom (user-authored) types and the untyped fallback get generous grounding
 * minus the calendar — the calendar is the big drift source, and a custom type
 * shouldn't silently inherit it. They still get Present, Past, and history so a
 * user-authored type has material to work with.
 */
export const DEFAULT_SPEC: CategoryContextSpec = {
  present: true,
  past: true,
  history: true,
  calendar: "none",
};

export function specFor(name: string | undefined): CategoryContextSpec {
  return (name && CONTEXT_SPECS[name]) || DEFAULT_SPEC;
}

/** The data-source pills shown under a question type, in the order they load. */
export type QuestionSource =
  | "user/present"
  | "user/past"
  | "journal/history"
  | "calendar/past"
  | "calendar/future"
  | "family"
  | "reading";

/**
 * The sources a question type can load into its prompt, for display. Derived from
 * its CONTEXT_SPECS entry (custom types fall back to DEFAULT_SPEC).
 *
 * Two deliberate departures from the raw spec flags:
 * - `family` isn't a spec flag — only family-followup pulls another member's
 *   shared entry (folded into its prompt separately), so it's keyed off the name.
 * - `reading` isn't a spec flag either — only currently-reading folds the book
 *   you're reading into its prompt, so it's likewise keyed off the name.
 * - The always-on family *doc* is omitted: it loads for every type, so showing it
 *   per-type wouldn't distinguish anything.
 */
export function sourcesFor(name: string | undefined): QuestionSource[] {
  const spec = specFor(name);
  const sources: QuestionSource[] = [];
  if (spec.present) sources.push("user/present");
  if (spec.past) sources.push("user/past");
  if (spec.history) sources.push("journal/history");
  if (spec.calendar === "recent") sources.push("calendar/past");
  if (spec.calendar === "ahead") sources.push("calendar/future");
  if (name === FAMILY_FOLLOWUP) sources.push("family");
  if (name === CURRENTLY_READING) sources.push("reading");
  return sources;
}
