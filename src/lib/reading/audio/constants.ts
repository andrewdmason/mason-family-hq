/**
 * The narration settings, in one place.
 *
 * Client-safe (no "server-only"): the player needs the bucket-independent
 * numbers — chapter sizing, the price used for the spend readout — and nothing
 * here is a secret. The API key lives in the environment and is read only by
 * elevenlabs.ts.
 */

/** Storage bucket holding chapter audio and its timing map. */
export const READING_AUDIO_BUCKET = "reading-audio";

/**
 * The house narrator: one voice, chosen once, for every book.
 *
 * Deliberately not a per-book choice. You spend fifteen hours with whoever this
 * is, and a voice that stays the same is worth more than one you pick per book —
 * and because audio is cached forever, changing narrators mid-book means either
 * an audible seam or paying for the whole book again. reading_books.audio_voice_id
 * records what a given book was actually voiced in, so a book narrated under an
 * older default keeps playing in the voice it was made with.
 */
export const DEFAULT_VOICE_ID = "Gsndh0O5AnuI2Hj3YUlA";

/**
 * The long-form model, not the fast one.
 *
 * Flash is half the price and sounds it: fine for a news article, wearing over a
 * novel. This one is ElevenLabs' audiobook model and — the property that
 * actually matters here — the most stable across long generations. There is no
 * quality toggle on purpose: two tiers means two caches, two sets of bugs, and a
 * decision to make every time you start a book.
 */
export const NARRATION_MODEL = "eleven_multilingual_v2";

/** 44.1kHz 128kbps MP3. Frame-aligned, so chunks concatenate cleanly. */
export const AUDIO_FORMAT = "mp3_44100_128";
export const AUDIO_MIME = "audio/mpeg";

/**
 * Largest text we send in one narration request.
 *
 * The model's documented ceiling is 10,000 characters; staying meaningfully
 * under it leaves room for the request to land on a paragraph boundary rather
 * than being cut mid-sentence to fit.
 */
export const MAX_REQUEST_CHARS = 8_000;

/**
 * How much of the neighbouring text each request is shown for context.
 *
 * A chapter is longer than one request, so it is spoken in pieces and stitched.
 * Without this the voice's pitch and pacing reset at every join and you hear a
 * small hitch mid-paragraph. Passing the surrounding words lets each piece know
 * what came before and after, which is what makes the seams inaudible.
 */
export const STITCH_CONTEXT_CHARS = 500;

/**
 * Largest chapter we synthesize as a single unit, in characters of source text.
 *
 * Not a quality limit — a wall-clock one. Preparation happens inside a request
 * with a five-minute ceiling, and a chapter this size is about five narration
 * requests, which fits comfortably with room for the cleanup pass. Anything
 * longer is split into parts, which the reader sees as "Chapter Nine (2)".
 *
 * 40k characters is roughly 40 minutes of audio — longer than almost any real
 * chapter, so in practice splitting is rare and mostly catches unchaptered books.
 */
export const MAX_CHAPTER_CHARS = 40_000;

/**
 * Smallest chapter worth being its own track.
 *
 * A table of contents routinely lists a dedication, an epigraph and a part
 * title as separate entries. Left alone they become three tracks of nine
 * seconds each, and skipping a chapter stops meaning anything. Anything shorter
 * than this is folded into the chapter that follows it.
 */
export const MIN_CHAPTER_CHARS = 1_200;

/**
 * How many narration requests are in flight at once for one chapter.
 *
 * The pieces are independent — each is given its neighbours as context rather
 * than depending on their output — so they can be generated in parallel. Held
 * to three to stay well inside the API's rate limits.
 */
export const SYNTHESIS_CONCURRENCY = 3;

/**
 * A `preparing` row older than this is assumed dead and can be re-claimed.
 *
 * Preparation runs inside a request; if that request is killed (a function
 * timeout, a deploy mid-flight) nothing gets the chance to write `failed`, and
 * without this the chapter would sit in `preparing` forever with no way back.
 */
export const CLAIM_STALE_MS = 8 * 60 * 1000;

/**
 * Dollars per 1,000 characters of narration, for the spend readout.
 *
 * An estimate, and labelled as one in the UI: the real figure depends on the
 * plan's credit allowance and where in the month you are. This is the
 * order-of-magnitude number that stops a chapter from being a surprise —
 * roughly $0.17 per thousand characters on the long-form model.
 */
export const DOLLARS_PER_1K_CHARS = 0.17;

/** What a chapter of this many characters costs, in dollars. */
export function estimateCost(chars: number): number {
  return (chars / 1000) * DOLLARS_PER_1K_CHARS;
}

/**
 * Height of the player bar, in CSS pixels.
 *
 * Shared rather than measured because the paged reader has to know it before it
 * lays anything out: the page shrinks by exactly this much while something is
 * playing, so the running foot stays visible and no line of text ends up under
 * a control. Measuring it would mean laying out, measuring, and re-laying out.
 */
export const AUDIOBOOK_BAR_HEIGHT = 56;

/** "$2.40" — the spend readouts and the confirm-before-you-pay prompt. */
export function formatCost(dollars: number): string {
  if (dollars < 0.01) return "under a cent";
  return `$${dollars.toFixed(2)}`;
}
