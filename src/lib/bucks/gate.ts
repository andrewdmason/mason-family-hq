// Mason Bucks journal-entry reward gate, shared by the server-side award
// (lib/bucks/earn.ts) and the live editor nudge (journal/chat-surface.tsx) so the
// two can never drift. Client-safe: no "server-only" import here.

/** Bucks granted for a qualifying journal entry. */
export const JOURNAL_BUCKS = 5;
/** Minimum words of the writer's own content. */
export const JOURNAL_MIN_WORDS = 150;
/** Minimum wall-clock seconds from writing start to close. */
export const JOURNAL_MIN_SECONDS = 5 * 60;

/** Count words in a blob of the writer's own text. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}
