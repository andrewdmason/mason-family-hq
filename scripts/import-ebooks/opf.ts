/**
 * Calibre .opf metadata reader for the one-time eBook import.
 *
 * Calibre writes one .opf per book alongside the .epub, so it — not the
 * filename — is the authoritative source for title and author. Titles still
 * carry edition cruft ("(Vintage International)", ": 3 (The Three-Body Problem
 * Series)") that the library doesn't want, so `cleanTitle` strips it down to
 * something an Open Library search can match.
 */

import { readFile } from "node:fs/promises";
import { DOMParser } from "@xmldom/xmldom";

export type OpfMetadata = {
  title: string | null;
  author: string | null;
  /** Publication year from dc:date, when it parses. */
  year: number | null;
  publisher: string | null;
  /** Amazon ASIN — every book in this library has one; none have ISBNs. */
  asin: string | null;
};

function textOf(doc: Document, tag: string): string | null {
  const nodes = doc.getElementsByTagName(tag);
  const value = nodes.length > 0 ? (nodes[0].textContent ?? "").trim() : "";
  return value || null;
}

export async function readOpf(path: string): Promise<OpfMetadata> {
  const xml = await readFile(path, "utf8");
  const doc = new DOMParser({
    onError: () => {},
  }).parseFromString(xml, "text/xml") as unknown as Document;

  const rawAuthor = textOf(doc, "dc:creator");
  // Calibre writes a literal "Unknown" when it couldn't determine the author.
  const author = rawAuthor && rawAuthor !== "Unknown" ? rawAuthor : null;

  const dateText = textOf(doc, "dc:date");
  const year = dateText ? Number(dateText.slice(0, 4)) : NaN;

  let asin: string | null = null;
  const ids = doc.getElementsByTagName("dc:identifier");
  for (let i = 0; i < ids.length; i++) {
    const scheme = ids[i].getAttribute("opf:scheme") ?? "";
    if (/ASIN/i.test(scheme)) {
      asin = (ids[i].textContent ?? "").trim() || null;
      break;
    }
  }

  return {
    title: textOf(doc, "dc:title"),
    author,
    year: Number.isFinite(year) && year > 1000 ? year : null,
    publisher: textOf(doc, "dc:publisher"),
    asin,
  };
}

/** Publisher-series and edition noise that shouldn't reach the library. */
const EDITION_NOISE =
  /\b(vintage international|penguin classics|penguin twentieth-century classics|collins business essentials|oprah'?s book club|deluxe edition|\d+(st|nd|rd|th) edition|a culture novel|remembrance of earth'?s past|the three-body problem series|millennium series|a song of ice and fire|the myths|international library of psychology|nonviolent communication guides|very short introductions|ancient wisdom for modern readers|brightsummaries\.com)\b/i;

/**
 * Reduce a Calibre title to the plain book title.
 *
 * Returns two forms. `title` keeps the subtitle but drops trailing
 * parentheticals that name an edition or series, plus a volume number
 * masquerading as a subtitle ("Death's End: 3" → "Death's End"). `short` goes
 * further: every trailing parenthetical and the subtitle come off, because Open
 * Library indexes most books under the bare title and the existing library uses
 * bare titles throughout ("The Buried Giant", not "The Buried Giant (Vintage
 * International)").
 */
export function cleanTitle(raw: string): { title: string; short: string } {
  let t = raw.trim();

  // Strip parentheticals that are edition/series noise, repeatedly.
  for (;;) {
    const next = t.replace(/\s*\(([^()]*)\)\s*$/, (whole, inner: string) =>
      EDITION_NOISE.test(inner) || /\bbook \d+\b/i.test(inner) ? "" : whole
    );
    if (next === t) break;
    t = next.trim();
  }

  // "Death's End: 3" — a bare volume number masquerading as a subtitle. Keep an
  // explicit "Book 6" though: for a series like My Struggle the volume *is* the
  // title, and stripping it collapses six books into one.
  t = t.replace(/:\s*\d+\s*$/, "").trim();
  t = t.replace(/\s+/g, " ").replace(/[:\s]+$/, "").trim();

  // The short form: no trailing parentheticals of any kind, no subtitle — unless
  // the subtitle is the volume number, which has to survive.
  let s = t;
  for (;;) {
    const next = s.replace(/\s*\([^()]*\)\s*$/, "").trim();
    if (next === s || !next) break;
    s = next;
  }
  if (!/:\s*book\s*\d+\s*$/i.test(s)) {
    s = s.split(/\s*:\s*/)[0].trim() || s;
  }

  return { title: t, short: s };
}

/**
 * The one author to file a book under. Calibre joins co-authors with "&"; the
 * library shows a single name, and the first is the one people search for.
 */
export function primaryAuthor(raw: string | null): string | null {
  if (!raw) return null;
  let first = raw.split(/\s*&\s*/)[0].trim();
  if (!first) return null;
  // Undo a "Surname, Given" sort form.
  const inverted = first.match(/^([^,]+),\s*([^,]+)$/);
  if (inverted) first = `${inverted[2].trim()} ${inverted[1].trim()}`;
  // Trailing credentials are noise on a bookshelf.
  first = first.replace(/[,\s]+(ph\.?\s?d\.?|m\.?d\.?|psy\.?d\.?)\.?\s*$/i, "").trim();
  return first || null;
}

/**
 * Whether a name has been mangled by a bad case conversion somewhere upstream —
 * "Gabriel GarcÍA MÁRquez". The tell is an accented capital sitting mid-word,
 * which never happens in a correctly-cased name.
 */
export function looksMiscased(name: string): boolean {
  return /[a-z][ÀÁÂÃÄÅÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ]/.test(name);
}

/**
 * Whether a title looks like it was stored in sentence case (Open Library is
 * inconsistent about this). Calibre's titles are properly cased, so a
 * sentence-cased match is a cue to keep the local title for display.
 */
export function looksSentenceCased(title: string): boolean {
  const words = title.split(/\s+/).filter((w) => /[a-z]/i.test(w));
  if (words.length < 3) return false;
  const capitalized = words.filter((w) => /^[A-Z]/.test(w)).length;
  return capitalized / words.length < 0.5;
}

/**
 * Whether two titles differ only by a leading article. Open Library files some
 * works without one ("Art of Community"); the shelf wants it back.
 */
export function sameButForArticle(a: string, b: string): boolean {
  const bare = (s: string) =>
    s.toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[^a-z0-9]+/g, "");
  return bare(a) === bare(b) && a.toLowerCase() !== b.toLowerCase();
}
