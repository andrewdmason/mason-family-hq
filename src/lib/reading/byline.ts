/**
 * "Amor Towles · 2016" — who wrote a book and when it came out, as one line.
 *
 * The year belongs next to the author rather than down in the meta line with the
 * page count, because it's the same kind of fact: it tells you what the book *is*
 * before you've read a word of the argument for it. A 1927 novel and a 2019
 * thriller ask completely different things of an evening, and until now the queue
 * and the recommendation card made you already know which was which.
 *
 * Shared by both so a book reads the same way wherever you meet it. Either half
 * can be missing — plenty of titles resolve without a year — and the separator
 * only appears when there are two things to separate.
 */
export function bookByline(
  author: string | null,
  publishedYear: number | null
): string | null {
  const parts: string[] = [];
  if (author?.trim()) parts.push(author.trim());
  if (publishedYear && publishedYear > 0) parts.push(String(publishedYear));
  return parts.length > 0 ? parts.join(" · ") : null;
}
