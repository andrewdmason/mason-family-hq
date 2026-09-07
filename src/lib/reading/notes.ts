/**
 * The reader's notepad: one document per book, with pills set into the text.
 *
 * Pure and client-safe. The editor, the server actions and the prompt builders
 * all share this vocabulary, and the one thing that must never drift between
 * them is what a PILL looks like in the stored markdown — because a pill the
 * editor writes that the prompt can't read is a citation the assistant never
 * sees, and one the prompt writes that the editor can't parse is a link that
 * renders as its own syntax.
 *
 * Three kinds of pill, one stored form: a markdown link whose target names the
 * kind.
 *
 *   [p. 41](place:12345)              a place in the book
 *   [p. 41](place:12345?mark=9f1c…)   the same, pulled in from one of your marks
 *   [Ask](thread:9f1c…)               a conversation that branched off here
 *   [Sep 7, 2026](date:2026-09-07)    a day — no longer written (a date is
 *                                     plain text now), still read
 *
 * A link rather than a bespoke syntax because it degrades well. Anything that
 * reads the markdown without knowing about pills — a future export, a person
 * looking at the row — sees the label as text and the target as a URL it can
 * ignore. The scheme is what the editor keys on.
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
 * `mark` is set when the place came from one of the reader's marks — a
 * highlight landing in the notes — so tapping the pill can open that mark's
 * thread as well as go to the passage. Null for a place stamped from where the
 * reader was.
 */
export type NotePlace = {
  char: number;
  /** "p. 41", "27%", or "Ch. 3 · p. 41" — see placeLabel. */
  label: string;
  mark: string | null;
};

export type NotePill =
  | ({ kind: "place" } & NotePlace)
  | { kind: "date"; date: string; label: string }
  | { kind: "thread"; thread: string; label: string };

/** A pill without its label — what a link's target alone can tell you. */
export type PillTarget = NotePill extends infer P
  ? P extends NotePill
    ? Omit<P, "label">
    : never
  : never;

const PILL_LINK_RE =
  /\[([^\]\n]*)\]\((place:(\d+)(?:\?mark=([A-Za-z0-9-]+))?|date:(\d{4}-\d{2}-\d{2})|thread:([A-Za-z0-9-]+))\)/g;

/** The target half of a pill's link. */
export function pillHref(pill: NotePill): string {
  switch (pill.kind) {
    case "place": {
      const mark = pill.mark ? `?mark=${pill.mark}` : "";
      return `place:${Math.max(0, Math.round(pill.char))}${mark}`;
    }
    case "date":
      return `date:${pill.date}`;
    case "thread":
      return `thread:${pill.thread}`;
  }
}

/** The inverse of pillHref, without the label. Null for anything that isn't one. */
export function parsePillHref(href: string | null | undefined): PillTarget | null {
  if (!href) return null;
  let m = /^place:(\d+)(?:\?mark=([A-Za-z0-9-]+))?$/.exec(href);
  if (m) return { kind: "place", char: Number(m[1]), mark: m[2] ?? null };
  m = /^date:(\d{4}-\d{2}-\d{2})$/.exec(href);
  if (m) return { kind: "date", date: m[1] };
  m = /^thread:([A-Za-z0-9-]+)$/.exec(href);
  if (m) return { kind: "thread", thread: m[1] };
  return null;
}

/** A pill as it is written into the markdown. */
export function pillMarkdown(pill: NotePill): string {
  // Square brackets are the only characters that could break the link form;
  // a label is a page, a date or a word and never contains them, but the
  // writer shouldn't be the one relying on that.
  const label = pill.label.replace(/[[\]]/g, "");
  return `[${label}](${pillHref(pill)})`;
}

/** Every pill in a document, in document order. */
export function pillsIn(markdown: string): NotePill[] {
  const out: NotePill[] = [];
  for (const m of markdown.matchAll(PILL_LINK_RE)) {
    const label = m[1];
    if (m[3] != null) out.push({ kind: "place", label, char: Number(m[3]), mark: m[4] ?? null });
    else if (m[5] != null) out.push({ kind: "date", label, date: m[5] });
    else if (m[6] != null) out.push({ kind: "thread", label, thread: m[6] });
  }
  return out;
}

/** Every place in a document, in document order. */
export function placesIn(markdown: string): NotePlace[] {
  return pillsIn(markdown).flatMap((p) =>
    p.kind === "place" ? [{ char: p.char, label: p.label, mark: p.mark }] : []
  );
}

/** Every day in a document, in document order, as YYYY-MM-DD. */
export function datesIn(markdown: string): string[] {
  return pillsIn(markdown).flatMap((p) => (p.kind === "date" ? [p.date] : []));
}

// Kept under their old names for the place-only callers.
export const placeHref = (place: Pick<NotePlace, "char" | "mark">) =>
  pillHref({ kind: "place", label: "", ...place });
export const placeMarkdown = (place: NotePlace) => pillMarkdown({ kind: "place", ...place });
export function parsePlaceHref(href: string | null | undefined): {
  char: number;
  mark: string | null;
} | null {
  const p = parsePillHref(href);
  return p?.kind === "place" ? { char: p.char, mark: p.mark } : null;
}

/**
 * What a place pill says.
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today, in the reader's own calendar, as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * What a date pill says: "Sep 7, 2026". The year always, because a notepad is
 * the kind of thing you reread years later, when "Sep 7" has stopped meaning
 * anything.
 */
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** A date pill for a day. */
export function datePill(iso: string): NotePill {
  return { kind: "date", date: iso, label: dateLabel(iso) };
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

/**
 * A passage as it lands in the stored markdown when the notepad isn't open to
 * take it — a highlight made on a phone with the panel shut. The same shape
 * the editor makes (clipContent): a quote, with the place pill on its last
 * line, and a blank paragraph after it for the next thought.
 */
export function appendClipMarkdown(markdown: string, quote: string, place: NotePlace): string {
  const lines = quote
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const paragraphs = lines.length > 0 ? lines : [quote.trim()];
  const last = paragraphs.length - 1;
  const block = paragraphs
    .map((l, i) => `> ${l}${i === last ? ` ${placeMarkdown(place)}` : ""}`)
    .join("\n>\n");
  const head = markdown.replace(/\s+$/, "");
  return head ? `${head}\n\n${block}\n` : `${block}\n`;
}

/** Words in the document, with pill labels counted as nothing. */
export function noteWordCount(markdown: string): number {
  const text = markdown
    .replace(PILL_LINK_RE, " ")
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
 * Pills become a bracketed aside — "(at p. 41)", "(Sep 7, 2026)", "(a
 * conversation branched off here)" — so the model sees WHERE and WHEN each
 * stretch of notes was written without seeing the link syntax, which it would
 * otherwise be tempted to reproduce. Trimmed from the end when over budget:
 * the front of a document is where its structure lives.
 */
export function notesForPrompt(markdown: string): {
  text: string;
  truncated: boolean;
} | null {
  const withPills = markdown
    .replace(PILL_LINK_RE, (_m, label: string, href: string) => {
      if (href.startsWith("place:")) return `(at ${label})`;
      if (href.startsWith("date:")) return `(${label})`;
      return "(a conversation branched off here)";
    })
    .trim();
  if (!withPills) return null;
  if (withPills.length <= NOTES_PROMPT_MAX_CHARS) {
    return { text: withPills, truncated: false };
  }
  const cut = withPills.slice(0, NOTES_PROMPT_MAX_CHARS);
  const lastBreak = cut.lastIndexOf("\n");
  return {
    text: lastBreak > NOTES_PROMPT_MAX_CHARS / 2 ? cut.slice(0, lastBreak) : cut,
    truncated: true,
  };
}
