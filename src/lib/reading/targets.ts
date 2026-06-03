/**
 * Per-book reading-target math. A book aims for current_page + increment each
 * week, capped at the last page. Pure and dependency-free.
 */

/** Clamp a target to the book's last page (no-op when total pages are unknown). */
export function capTarget(target: number, totalPages: number | null): number {
  return totalPages != null ? Math.min(target, totalPages) : target;
}

/**
 * The default target for a freshly-started or just-advanced stretch. Returns null
 * when there's nothing to aim for: a zero/negative increment, or a book already at
 * or past its final page.
 */
export function defaultTargetPage(
  currentPage: number,
  increment: number,
  totalPages: number | null
): number | null {
  if (increment <= 0) return null;
  if (totalPages != null && currentPage >= totalPages) return null;
  return capTarget(currentPage + increment, totalPages);
}
