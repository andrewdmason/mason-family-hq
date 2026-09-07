/**
 * The reader's notepad: one document per book, with places in the book set
 * into the text.
 *
 * Pure and client-safe. The editor, the server actions and the prompt builders
 * all share this vocabulary, and the one thing that must never drift between
 * them is what a PLACE looks like in the stored markdown — because a pill the
 * editor writes that the prompt can't read is a citation the assistant never
 * sees, and one the prompt writes that the editor can't parse is a link that
 * renders as its own syntax.
 *
 *   npx tsx scripts/verify-reader-notes.mts
 */

/**
 * A place in the book, as the notepad carries it.
 *
 * `char` is the conversion character offset (block-stream.ts): the same space
 * that holds reading position, bookmarks and every mark, so a place survives a
 * font change, a switch between pages and scrolling, and a swap into Plain
 * English without knowing that any of those exist.
 *
 * `mark` is set when the place was pulled in from one of the reader's marks —
 * the @-mention path — so tapping the pill can open that mark's thread as well
 * as go to the passage. Null for a place stamped from where the reader was.
 */
export type NotePlace = {
  char: number;
  /** "p. 41", "27%", or "Ch. 3 · p. 41" — see placeLabel. */
  label: string;
  mark: string | null;
};

/**
 * The stored form: a markdown link whose target is the place.
 *
 *   [p. 41](place:12345)
 *   [Ch. 3 · p. 41](place:12345?mark=9f1c…)
 *
 * A link rather than a bespoke syntax because it degrades well. Anything that
 * reads the markdown without knowing about places — the prompt builder, a
 * future export, a person looking at the row — sees the label as text and the
 * target as a URL it can ignore. The scheme is what the editor keys on.
 */
export const PLACE_SCHEME = "place:";

/** Everything the editor and the prompt need to recognise a place link. */
const PLACE_LINK_RE = /\[([^\]\n]*)\]\(place:(\d+)(?:\?mark=([A-Za-z0-9-]+))?\)/g;

export function placeHref(place: Pick<NotePlace, "char" | "mark">): string {
  const mark = place.mark ? `?mark=${place.mark}` : "";
  return `${PLACE_SCHEME}${Math.max(0, Math.round(place.char))}${mark}`;
}

/** The inverse of placeHref. Null for anything that isn't one. */
export function parsePlaceHref(href: string | null | undefined): {
  char: number;
  mark: string | null;
} | null {
  if (!href || !href.startsWith(PLACE_SCHEME)) return null;
  const m = /^place:(\d+)(?:\?mark=([A-Za-z0-9-]+))?$/.exec(href);
  if (!m) return null;
  return { char: Number(m[1]), mark: m[2] ?? null };
}

/** A place as it is written into the markdown. */
export function placeMarkdown(place: NotePlace): string {
  // Square brackets are the only characters that could break the link form;
  // a label is a page or a percentage and never contains them, but the writer
  // shouldn't be the one relying on that.
  const label = place.label.replace(/[[\]]/g, "");
  return `[${label}](${placeHref(place)})`;
}

/**
 * Every place in a document, in document order.
 *
 * What the prompt builder walks to say where each passage of notes was written,
 * and what the editor uses on load to find the most recent stamp.
 */
export function placesIn(markdown: string): NotePlace[] {
  const out: NotePlace[] = [];
  for (const m of markdown.matchAll(PLACE_LINK_RE)) {
    out.push({ label: m[1], char: Number(m[2]), mark: m[3] ?? null });
  }
  return out;
}

/**
 * What a pill says.
 *
 * The page where the book has real ones and a percentage everywhere else — the
 * same rule bookmarks use (bookmarkPlace), so the two never name the same spot
 * two ways. The chapter goes in front when it can be said in a word or two:
 * "Ch. 3 · p. 41" reads as a place, "The Shadow and the Persona · p. 41" reads
 * as a sentence, so a chapter with a title rather than a number is left to the
 * pill's tooltip.
 */
export function placeLabel(input: {
  chapterTitle: string | null;
  page: number | null;
  percent: number;
  hasRealPages: boolean;
}): string {
  const where =
    input.hasRealPages && input.page != null
      ? `p. ${input.page}`
      : `${Math.round(input.percent)}%`;
  const chapter = shortChapter(input.chapterTitle);
  return chapter ? `${chapter} · ${where}` : where;
}

/**
 * "Chapter 3", "CHAPTER III", "3", "Ch. 3", "Chapter 3: The Shadow" → "Ch. 3".
 * Anything that isn't a numbered chapter → null.
 */
export function shortChapter(title: string | null): string | null {
  if (!title) return null;
  const t = title.trim();
  const m =
    /^(?:chapter|chap\.?|ch\.?)\s+([0-9]+|[ivxlcdm]+)\b/i.exec(t) ??
    /^([0-9]+)(?:[.:]|\s|$)/.exec(t);
  if (!m) return null;
  const n = m[1];
  return `Ch. ${/^[ivxlcdm]+$/i.test(n) ? n.toUpperCase() : n}`;
}

/**
 * How far the reader has to have moved since the last stamp for a new
 * paragraph to get one.
 *
 * About a paragraph and a half. Any smaller and every thought written on one
 * page gets its own pill, which is noise; much bigger and a note written after
 * turning the page lands under the previous page's stamp, which is wrong.
 */
export const STAMP_MIN_MOVE = 300;

/**
 * Whether a new paragraph should open with a stamp for where the reader is.
 *
 * The rule the auto-stamp lives by: only when they have moved since the last
 * one. A first paragraph in an empty document always gets one — there is no
 * "last" to have moved from.
 */
export function shouldStamp(lastStampChar: number | null, currentChar: number): boolean {
  if (lastStampChar == null) return true;
  return Math.abs(currentChar - lastStampChar) >= STAMP_MIN_MOVE;
}

/** Words in the document, with place labels counted as nothing. */
export function noteWordCount(markdown: string): number {
  const text = markdown
    .replace(PLACE_LINK_RE, " ")
    .replace(/[#>*_`~-]+/g, " ")
    .trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

/** What the Contents says under "Your notes". */
export function noteBlurb(markdown: string, updatedAt: string | null): string {
  const words = noteWordCount(markdown);
  if (words === 0) return "Somewhere to think while you read";
  const when = updatedAt ? shortDate(updatedAt) : null;
  const count = `${words} ${words === 1 ? "word" : "words"}`;
  return when ? `${count} · ${when}` : count;
}

function shortDate(value: string): string | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * Char budget for the notes inside a prompt.
 *
 * Generous — a notepad is prose the reader typed, and a long one is a few
 * thousand words — but capped, because it rides on every chat turn in the book.
 */
export const NOTES_PROMPT_MAX_CHARS = 40_000;

/**
 * The notes as the assistant reads them.
 *
 * Place links become a bracketed aside — "(at p. 41)" — so the model sees WHERE
 * each stretch of notes was written without seeing the link syntax, which it
 * would otherwise be tempted to reproduce. Trimmed from the end when over
 * budget: the front of a document is where its structure lives.
 */
export function notesForPrompt(markdown: string): {
  text: string;
  truncated: boolean;
} | null {
  const withPlaces = markdown.replace(PLACE_LINK_RE, (_m, label: string) => `(at ${label})`).trim();
  if (!withPlaces) return null;
  if (withPlaces.length <= NOTES_PROMPT_MAX_CHARS) {
    return { text: withPlaces, truncated: false };
  }
  const cut = withPlaces.slice(0, NOTES_PROMPT_MAX_CHARS);
  const lastBreak = cut.lastIndexOf("\n");
  return {
    text: lastBreak > NOTES_PROMPT_MAX_CHARS / 2 ? cut.slice(0, lastBreak) : cut,
    truncated: true,
  };
}
