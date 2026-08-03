/**
 * Where sentences begin and end.
 *
 * The unit the follow-along highlight moves in. It wants to be the sentence
 * rather than the word — a word-by-word highlight on a page of prose reads as a
 * strobe, and it wants far more timing data than a sentence does — and rather
 * than the paragraph, which on a long paragraph leaves the highlight sitting
 * still for two minutes.
 *
 * Deliberately a heuristic and not a parser. It is used for two things, and
 * both degrade gently: choosing where the highlight jumps, and lining a cleaned
 * sentence up with the source sentence it came from. A missed split merges two
 * sentences into one highlight; a spurious one splits a highlight in half.
 * Neither is worth a dependency.
 */

/** Half-open character range within the text it was split from. */
export type SentenceRange = { start: number; end: number };

/**
 * Words that end in a period without ending a sentence. Trailing period omitted
 * — the check adds it back — and matched case-insensitively against the last
 * word before the candidate break.
 */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "rev", "hon", "st", "sr", "jr",
  "vs", "etc", "eg", "ie", "cf", "al", "approx", "dept", "est",
  "fig", "no", "vol", "ch", "pp", "ed", "trans", "orig",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "mon", "tue", "wed", "thu", "fri", "sat", "sun",
]);

/** The word immediately before `index`, lowercased and stripped of punctuation. */
function wordBefore(text: string, index: number): string {
  let end = index;
  while (end > 0 && /[.\s]/.test(text[end - 1])) end--;
  let start = end;
  while (start > 0 && /[^\s]/.test(text[start - 1])) start--;
  return text.slice(start, end).toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * True when the period at `index` is part of an initial ("J. R. R. Tolkien") or
 * a single-letter abbreviation, where the preceding "word" is one letter.
 */
function isInitial(text: string, index: number): boolean {
  const before = wordBefore(text, index);
  return before.length === 1;
}

/**
 * Split `text` into sentences, as ranges into the original string.
 *
 * Ranges are contiguous and cover the whole text including the whitespace
 * between sentences — trailing space belongs to the sentence that precedes it —
 * so the ranges can be mapped straight back onto the source without gaps.
 * Returns a single whole-text range for anything with no detectable break.
 */
export function splitSentences(text: string): SentenceRange[] {
  const out: SentenceRange[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;

    // Run past any closing punctuation that belongs to this sentence: an
    // ellipsis, a quote mark, a bracket. "…" and "?!" both end one sentence.
    let end = i;
    while (end + 1 < text.length && /[.!?"'”’)\]]/.test(text[end + 1])) end++;

    const next = text[end + 1];
    // A break needs whitespace after it. Without that, this is a decimal point,
    // a URL, or a version number.
    if (next !== undefined && !/\s/.test(next)) continue;

    if (ch === "." && (ABBREVIATIONS.has(wordBefore(text, i)) || isInitial(text, i))) {
      continue;
    }

    // Consume the whitespace so the next sentence starts on a real character.
    let after = end + 1;
    while (after < text.length && /\s/.test(text[after])) after++;

    // The following sentence should look like one: a capital, a digit, or an
    // opening quote. Lowercase after a period is usually an abbreviation we
    // don't know about.
    const following = text[after];
    if (following !== undefined && !/[A-Z0-9"'“‘(\[]/.test(following)) continue;

    if (after > start) {
      out.push({ start, end: after });
      start = after;
    }
    i = after - 1;
  }

  if (start < text.length) out.push({ start, end: text.length });
  return out.length > 0 ? out : [{ start: 0, end: text.length }];
}
