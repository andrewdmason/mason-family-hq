/**
 * The Plain English settings, in one place.
 *
 * Client-safe (no "server-only"): the reader needs the numbers that size the
 * estimate and pace the polling, and nothing here is a secret. The model names
 * are read from the environment on the server only (see translate.ts).
 */

/**
 * Largest stretch of paragraphs sent in one request, in characters.
 *
 * Not a quality limit — a wall-clock one. A live chapter is translated inside a
 * request with a five-minute ceiling, and the model thinks before it writes, so
 * each call has to be small enough to finish with room to rerun. Ten thousand
 * characters is a few pages: long enough that the translator has the argument
 * in view, short enough that a validation failure costs seconds, not minutes.
 */
export const PLAIN_CHUNK_CHARS = 10_000;

/**
 * A translated paragraph shorter than this fraction of its original is a
 * summary wearing a translation's clothes, and the chunk is rerun.
 *
 * Six tenths rather than nine: plain prose is legitimately a little shorter
 * than ornate prose once the stacked synonyms and semicolon chains are gone.
 */
export const PLAIN_LENGTH_FLOOR = 0.6;

/** How many times the primary model gets a chunk before the fallback takes it. */
export const PLAIN_PRIMARY_ATTEMPTS = 2;

/** How many chunks of one chapter are in flight at once. */
export const PLAIN_CONCURRENCY = 3;

/**
 * A `preparing` chapter older than this is assumed dead and can be re-claimed.
 * Same reasoning as the audiobook claim: a request killed mid-flight never
 * writes `failed`, and without this the chapter would wedge forever.
 */
export const PLAIN_CLAIM_STALE_MS = 8 * 60 * 1000;

/** A peek claim older than this is dead and may be taken over. */
export const PLAIN_PEEK_STALE_MS = 3 * 60 * 1000;

/**
 * Dollars per 1,000 characters of original text, for the estimate shown before
 * a whole-book run.
 *
 * Measured, not derived, and labelled "about" in the UI. The model's thinking
 * is billed as output and reruns re-bill a whole chunk, so a list price times a
 * character count undercounts. On 2026-09-04 the Satprem fixture (2,268 chars,
 * four paragraphs) cost $0.080 live on claude-fable-5-1 at medium effort —
 * 1,921 input and 1,218 output tokens — which is $0.035 per 1k chars live and
 * half that batched. Most of a book is batched and two chapters go live, so the
 * blended figure sits near two cents. Recalibrate from `input_tokens` and
 * `output_tokens` on reading_plain_chapters as real books run.
 */
export const PLAIN_DOLLARS_PER_1K_CHARS = 0.02;

/** What translating this many characters costs, in dollars. */
export function estimatePlainCost(chars: number): number {
  return (chars / 1000) * PLAIN_DOLLARS_PER_1K_CHARS;
}

/** How often the reader asks after pending chapters, in milliseconds. */
export const PLAIN_POLL_MS = 4_000;

/**
 * The Message Batches API caps `custom_id` at 64 characters of
 * `[a-zA-Z0-9_-]`. A 64-hex content hash already fills that, so the id carries
 * only the chapter and chunk; the batch itself is scoped to one hash.
 */
export function batchCustomId(chapterIndex: number, chunkIndex: number): string {
  return `c${chapterIndex}-k${chunkIndex}`;
}

export function parseBatchCustomId(
  id: string
): { chapterIndex: number; chunkIndex: number } | null {
  const m = /^c(\d+)-k(\d+)$/.exec(id);
  if (!m) return null;
  return { chapterIndex: Number(m[1]), chunkIndex: Number(m[2]) };
}
