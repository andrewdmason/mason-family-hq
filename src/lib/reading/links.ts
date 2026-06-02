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
