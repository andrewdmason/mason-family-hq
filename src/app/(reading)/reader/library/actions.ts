"use server";

import { getReadingHome } from "../actions";
import { getDiscover } from "../discover/actions";

/**
 * Everything the shelf renders that can change behind it — your books and the
 * recommendations beneath them — in one read, so the mounted shelf can re-read
 * itself in place (see src/components/reading/library-shelf.tsx) instead of
 * re-running the route. The recipient list for "pass this book on" is not here:
 * it's the household roster, and it doesn't change between a launch and lunch.
 */
export async function loadLibrarySnapshot() {
  const [home, discover] = await Promise.all([
    getReadingHome(null),
    getDiscover(null),
  ]);
  return {
    books: home.books,
    recommendations: discover.recommendations,
    recsHasSignal: discover.hasSignal,
    recsGenres: discover.genres,
  };
}

export type LibrarySnapshot = Awaited<ReturnType<typeof loadLibrarySnapshot>>;
