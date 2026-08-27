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

/**
 * A shared mark, addressed by its CONVERSATION rather than by anyone's copy of
 * the book.
 *
 * Thread-addressed for three reasons. An email can be forwarded, and each
 * recipient has to land in their own copy. The mark in your copy may not exist
 * yet when the link is written — the book gets copied to your shelf afterwards —
 * so there is no id to point at. And this is the one place that knows you have
 * now seen it.
 *
 * The route resolves it and redirects to the mark in your own book. Never carry
 * a character offset in the URL: offsets belong to a particular conversion of a
 * particular file, and the sender's is not yours.
 */
export function sharedMarkHref(threadId: string): string {
  return `/reader/thread/${threadId}`;
}

/** A mark in a book you have, opened and jumped to. The resolved form of the
 *  link above; not something to send anybody. */
export function bookMarkHref(bookId: string, annotationId: string): string {
  return `/reader/${bookId}/read?mark=${encodeURIComponent(annotationId)}`;
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
