/**
 * Open Library matching for the one-time eBook import.
 *
 * The library's existing books all have Open Library covers and clean titles,
 * so imports should come in the same way: look the book up, take its title,
 * author, cover and ISBN. A match has to be confident — a wrong match puts the
 * wrong cover on the shelf, which is worse than no cover — so the score has to
 * clear a threshold on title *and* author before it's accepted.
 */

import { searchBooks, type BookSearchResult } from "@/lib/reading/book-search";

/** Lowercase, strip punctuation and leading articles, collapse whitespace. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(the|a|an) /, "")
    .trim();
}

/** Token-overlap similarity in [0,1] — forgiving about word order and extras. */
function similarity(a: string, b: string): number {
  const at = new Set(normalize(a).split(" ").filter(Boolean));
  const bt = new Set(normalize(b).split(" ").filter(Boolean));
  if (at.size === 0 || bt.size === 0) return 0;
  let shared = 0;
  for (const t of at) if (bt.has(t)) shared++;
  return shared / Math.max(at.size, bt.size);
}

/** Surname match is the reliable signal; initials and middle names vary wildly. */
function authorMatches(mine: string | null, theirs: string | null): boolean {
  if (!mine || !theirs) return false;
  const surname = (s: string) => normalize(s).split(" ").filter(Boolean).pop() ?? "";
  return surname(mine) === surname(theirs) || similarity(mine, theirs) >= 0.5;
}

export type MatchOutcome = {
  match: BookSearchResult | null;
  /** 0–1 title similarity of the chosen candidate, for the report. */
  score: number;
  /** Which query found it, so a bad match is traceable in the dry run. */
  via: string | null;
};

/**
 * Find the Open Library record for a book. Tries the full title first, then the
 * short title, each scoped by author when we have one. Returns the best
 * candidate that clears both the title-similarity floor and the author check.
 */
export async function matchOpenLibrary(
  title: string,
  shortTitle: string,
  author: string | null
): Promise<MatchOutcome> {
  const queries: { q: string; label: string }[] = [];
  if (author) {
    queries.push({ q: `${title} ${author}`, label: "title+author" });
    if (shortTitle !== title) {
      queries.push({ q: `${shortTitle} ${author}`, label: "short+author" });
    }
  }
  queries.push({ q: title, label: "title" });
  if (shortTitle !== title) queries.push({ q: shortTitle, label: "short" });

  let best: MatchOutcome = { match: null, score: 0, via: null };

  for (const { q, label } of queries) {
    const results = await searchBooks(q, 8);
    for (const r of results) {
      // Score against both title forms; the library's own titles are short.
      const score = Math.max(similarity(title, r.title), similarity(shortTitle, r.title));
      // Without an author to corroborate, demand a much stronger title match.
      const ok = author
        ? score >= 0.6 && authorMatches(author, r.author)
        : score >= 0.85;
      if (ok && score > best.score) best = { match: r, score, via: label };
    }
    // A near-exact hit is as good as it gets; stop paying for more queries.
    if (best.score >= 0.95) break;
  }

  return best;
}
