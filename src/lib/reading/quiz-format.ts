/** Human label for a quiz's covered page range, shared across quiz surfaces. */
export function quizRangeLabel(
  fromPage: number | null,
  throughPage: number
): string {
  return fromPage != null && fromPage > 1
    ? `pages ${fromPage}–${throughPage}`
    : `through page ${throughPage}`;
}
