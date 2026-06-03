/** Shared URL builders for the reading app, so member scoping stays consistent. */

function withMember(path: string, memberEmail?: string | null): string {
  const email = memberEmail?.trim();
  return email ? `${path}?member=${encodeURIComponent(email)}` : path;
}

/** The reading home (book list). */
export function readingHomeHref(memberEmail?: string | null): string {
  return withMember("/reader", memberEmail);
}

/** The reader for a book whose content is ready. */
export function bookReaderHref(
  bookId: string,
  memberEmail?: string | null
): string {
  return withMember(`/reader/${bookId}/read`, memberEmail);
}

/** The owner-facing list of all quizzes and results. */
export function quizzesHref(memberEmail?: string | null): string {
  return withMember("/reader/quizzes", memberEmail);
}

/** The owner's draft review/edit screen for a quiz. */
export function quizEditHref(quizId: string, memberEmail?: string | null): string {
  return withMember(`/reader/quizzes/${quizId}/edit`, memberEmail);
}

/** The page where a reader takes a published quiz. */
export function quizTakeHref(quizId: string, memberEmail?: string | null): string {
  return withMember(`/reader/quizzes/${quizId}`, memberEmail);
}

/** A graded quiz's results/feedback. */
export function quizResultsHref(quizId: string, memberEmail?: string | null): string {
  return withMember(`/reader/quizzes/${quizId}/results`, memberEmail);
}
