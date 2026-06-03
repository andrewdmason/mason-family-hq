import type { JournalOpeningCandidate } from "@/lib/types";

/**
 * Coerce a stored `opening_candidates` value into the current object shape.
 * Tolerates legacy rows that stored a plain string[] (no type labels).
 * Client-safe — no server imports — so the picker and server code can share it.
 */
export function normalizeCandidates(raw: unknown): JournalOpeningCandidate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c): JournalOpeningCandidate => {
      if (typeof c === "string") return { text: c, type: null, visibility: "private" };
      const obj = (c ?? {}) as {
        text?: unknown;
        type?: unknown;
        visibility?: unknown;
        reading_book_id?: unknown;
      };
      return {
        text: typeof obj.text === "string" ? obj.text : "",
        type: typeof obj.type === "string" ? obj.type : null,
        // Legacy rows (and any unexpected value) default to private — sharing is
        // always an explicit, opt-in act.
        visibility: obj.visibility === "family" ? "family" : "private",
        // Preserved so a picked currently-reading candidate can link its book.
        reading_book_id:
          typeof obj.reading_book_id === "string" ? obj.reading_book_id : null,
      };
    })
    .filter((c) => c.text.length > 0);
}

/** Look up a candidate by its exact question text. */
export function candidateByText(
  raw: unknown,
  text: string
): JournalOpeningCandidate | undefined {
  return normalizeCandidates(raw).find((c) => c.text === text);
}

/** Just the question texts, for skip/avoid lists. */
export function candidateTexts(raw: unknown): string[] {
  return normalizeCandidates(raw).map((c) => c.text);
}

/** A human label from a kebab-case type name (e.g. "recent-calendar" → "Recent calendar"). */
export function typeLabel(type: string | null): string | null {
  if (!type) return null;
  const s = type.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
