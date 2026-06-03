/**
 * Builds links to buy a book at external stores.
 *
 * We don't store store URLs — they're derived from what we already know about
 * the book. An ISBN gives the most precise search; without one we fall back to
 * title (and author), which still lands the reader on the right results page.
 */

function storeQuery(book: {
  isbn: string | null;
  title: string;
  author: string | null;
}): string {
  const isbn = book.isbn?.trim();
  if (isbn) return isbn;
  return [book.title, book.author].filter(Boolean).join(" ");
}

/** Amazon search for this book (ISBN when known, otherwise title + author). */
export function amazonHref(book: {
  isbn: string | null;
  title: string;
  author: string | null;
}): string {
  return `https://www.amazon.com/s?k=${encodeURIComponent(storeQuery(book))}`;
}

/** Kobo search for this book (ISBN when known, otherwise title + author). */
export function koboHref(book: {
  isbn: string | null;
  title: string;
  author: string | null;
}): string {
  return `https://www.kobo.com/us/en/search?query=${encodeURIComponent(
    storeQuery(book)
  )}`;
}
