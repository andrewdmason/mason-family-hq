/**
 * Shared URL builders for the two reading surfaces.
 *
 * Reader (`/reader`) is the adults' e-reader: their own books and saved
 * articles, always self-scoped. Bookshelf (`/books`) is the kids' reading
 * program — current book, queue, quizzes — which a parent administers by
 * passing `?member=<kid email>`.
 *
 * Because the surfaces don't overlap, each builder belongs to exactly one of
 * them; there's no "which app am I in?" ambiguity to thread through.
 */

function withMember(path: string, memberEmail?: string | null): string {
  const email = memberEmail?.trim();
  return email ? `${path}?member=${encodeURIComponent(email)}` : path;
}

/** The adults' book list. `/reader` itself resumes the last book, so links that
 * mean "show me the shelf" have to name the library explicitly. */
export function readerLibraryHref(): string {
  return "/reader/library";
}

/** The reader for a book whose content is ready. Adults only. */
export function bookReaderHref(
  bookId: string,
  memberEmail?: string | null
): string {
  return withMember(`/reader/${bookId}/read`, memberEmail);
}

/**
 * The reader for a book, opened with everything you've marked in it already
 * showing. What the shelf's annotation count points at, so the number is a way
 * into what you wrote rather than a fact about the book.
 */
export function bookNotesHref(
  bookId: string,
  memberEmail?: string | null
): string {
  const base = bookReaderHref(bookId, memberEmail);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}notes=1`;
}

/** The Bookshelf home: a kid's own shelf, or the parent view of that kid's. */
export function bookshelfHref(memberEmail?: string | null): string {
  return withMember("/books", memberEmail);
}

/** A parent's draft review/edit screen for a quiz. */
export function quizEditHref(quizId: string, memberEmail?: string | null): string {
  return withMember(`/books/quizzes/${quizId}/edit`, memberEmail);
}

/** The page where a reader takes a published quiz. */
export function quizTakeHref(quizId: string, memberEmail?: string | null): string {
  return withMember(`/books/quizzes/${quizId}`, memberEmail);
}

/** A graded quiz's results/feedback. `celebrate` shows a milestone-reached banner. */
export function quizResultsHref(
  quizId: string,
  memberEmail?: string | null,
  celebrate?: string | null
): string {
  const base = withMember(`/books/quizzes/${quizId}/results`, memberEmail);
  if (!celebrate) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}celebrate=${encodeURIComponent(celebrate)}`;
}
