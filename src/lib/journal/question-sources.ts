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

/** The reminiscence question type's kebab name. Targets a single
 * under-elaborated timeline event and links the resulting entry back to it. */
export const REMINISCENCE = "reminiscence";

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
  /** Whether the type sees the user's timeline of life events (the structured
   * replacement for the old Past doc). Named `past` for historical continuity. */
  past: boolean;
  history: boolean;
  calendar: CalendarWindow | "none";
  /**
   * Recurring posts only: the user's own past closed entries *of this same type*
   * (the "same category" source — e.g. every school recap sees the prior school
   * recaps). When set without `history`, the history block is narrowed to just
   * this type; with `history` it's the full recent history (which already
   * includes this type). Absent/false on built-ins.
   */
  typeHistory?: boolean;
  /**
   * Recurring posts only: a few recent family-shared posts from other members,
   * folded into the prompt. Generalizes the name-keyed family-followup source so
   * any recurring type can opt into family context. Absent/false on built-ins.
   */
  family?: boolean;
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
 * shouldn't silently inherit it. They still get Present, the timeline, and
 * history so a user-authored type has material to work with.
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

/**
 * The spec for a stored question type, honoring a recurring post's user-chosen
 * `context_spec` when present and otherwise falling back to the name-based spec.
 */
export function specForRow(row: {
  name: string;
  context_spec?: CategoryContextSpec | null;
}): CategoryContextSpec {
  return row.context_spec ?? specFor(row.name);
}

/** A new recurring post's default sources: grounded in who you are now and your
 * prior posts of the same type, nothing else (calendar off — it's the big drift
 * source). The user tunes this in the editor. */
export const DEFAULT_RECURRING_SPEC: CategoryContextSpec = {
  present: true,
  past: false,
  history: false,
  calendar: "none",
  typeHistory: true,
  family: false,
};

/** The data-source pills shown under a question type, in the order they load. */
export type QuestionSource =
  | "user/present"
  | "user/timeline"
  | "journal/history"
  | "journal/this-type"
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
  return sourcesForSpec(specFor(name), name);
}

/**
 * The source pills for an explicit spec — used for recurring posts, whose sources
 * come from their stored `context_spec` rather than their name. `name` still keys
 * the two name-based special sources (family-followup, currently-reading).
 */
export function sourcesForSpec(
  spec: CategoryContextSpec,
  name?: string
): QuestionSource[] {
  const sources: QuestionSource[] = [];
  if (spec.present) sources.push("user/present");
  if (spec.past) sources.push("user/timeline");
  if (spec.history) sources.push("journal/history");
  if (spec.typeHistory) sources.push("journal/this-type");
  if (spec.calendar === "recent") sources.push("calendar/past");
  if (spec.calendar === "ahead") sources.push("calendar/future");
  if (spec.family || name === FAMILY_FOLLOWUP) sources.push("family");
  if (name === CURRENTLY_READING) sources.push("reading");
  return sources;
}
