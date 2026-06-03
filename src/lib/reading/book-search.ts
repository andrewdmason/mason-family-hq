/**
 * Open Library typeahead search for the add-a-book flow.
 *
 * This module is intentionally free of server-only imports so it can run in the
 * browser: Open Library's search.json is a public, CORS-enabled API, so the
 * client fetches it directly. That skips the extra hop through a server action
 * (and Next's server-action serialization), which is the difference between a
 * snappy typeahead and a laggy one.
 */

/** One Open Library typeahead match for the add-a-book search. */
export type BookSearchResult = {
  /** Open Library work key (e.g. "/works/OL12345W") — a stable list key. */
  key: string;
  title: string;
  author: string | null;
  totalPages: number | null;
  year: number | null;
  /** ISBN-13 of a common edition, null when none is listed. */
  isbn: string | null;
  /** Large cover for storage, null when the edition has no art. */
  coverImageUrl: string | null;
  /** Small cover for the dropdown row, null when the edition has no art. */
  coverThumbUrl: string | null;
};

type SearchDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  number_of_pages_median?: number;
  cover_i?: number;
  isbn?: string[];
};

/** Prefer a 13-digit ISBN; fall back to the first listed. Null when none. */
function pickIsbn(isbns: string[] | undefined): string | null {
  if (!isbns?.length) return null;
  return isbns.find((i) => i.replace(/[^0-9Xx]/g, "").length === 13) ?? isbns[0];
}

/**
 * Typeahead search against Open Library. Matches across title and author (`q=`)
 * so the user can type either. Returns up to `limit` results with author, page
 * count, year and covers. Resilient: any failure (network, timeout, abort, bad
 * input) resolves to an empty list rather than throwing, so the dropdown just
 * shows nothing instead of erroring the form.
 *
 * Pass `signal` to cancel a superseded keystroke's request so only the latest
 * search is ever in flight.
 */
export async function searchBooks(
  query: string,
  limit = 6,
  signal?: AbortSignal
): Promise<BookSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  try {
    const params = new URLSearchParams({
      q: trimmed,
      fields:
        "key,title,author_name,first_publish_year,number_of_pages_median,cover_i,isbn",
      limit: String(limit),
    });
    // Cap the request at 8s, and also honor the caller's cancellation.
    const timeout = AbortSignal.timeout(8000);
    const res = await fetch(`https://openlibrary.org/search.json?${params}`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { docs?: SearchDoc[] };
    return (data.docs ?? [])
      .filter((d): d is SearchDoc & { title: string } => !!d.title)
      .map((d) => ({
        key: d.key ?? d.title,
        title: d.title,
        author: d.author_name?.[0]?.trim() || null,
        totalPages:
          typeof d.number_of_pages_median === "number" &&
          d.number_of_pages_median > 0
            ? d.number_of_pages_median
            : null,
        year:
          typeof d.first_publish_year === "number" ? d.first_publish_year : null,
        isbn: pickIsbn(d.isbn),
        coverImageUrl: d.cover_i
          ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`
          : null,
        coverThumbUrl: d.cover_i
          ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg`
          : null,
      }));
  } catch {
    return [];
  }
}
