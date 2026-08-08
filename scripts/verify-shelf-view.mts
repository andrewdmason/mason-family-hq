/**
 * How the shelf arranges itself once the display menu has been touched.
 *
 * All of this runs on books already in the browser, so it is pure functions over
 * plain rows and every interesting case can be written down rather than clicked
 * through. The ones worth watching hardest:
 *
 *   - The archive must look EXACTLY as it did before this existed until someone
 *     changes something. It has been rating-grouped since it shipped, and a
 *     regression there is a regression for the whole shelf.
 *   - An unclassified book is unknown, not non-fiction. Filtering to Nonfiction
 *     must not sweep up every book the classifier failed to recognise — that is
 *     the exact conflation this feature exists to undo.
 *   - Grouping by genre has to put the fiction genres first, because that
 *     ordering is the only thing making a seventeen-way grouping readable.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-shelf-view.mts
 */

import {
  activeFilterCount,
  defaultView,
  filterBooks,
  groupBooks,
  isDefaultView,
  type ShelfRating,
  type ShelfView,
} from "../src/lib/reading/shelf-view";
import { genreSide } from "../src/lib/reading/book-genres";
import type { ReadingBookWithProgress, ReadingRating } from "../src/lib/types";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

let seq = 0;
function book(
  over: Partial<ReadingBookWithProgress> = {}
): ReadingBookWithProgress {
  seq += 1;
  return {
    id: `b${seq}`,
    title: `Book ${seq}`,
    author: "An Author",
    fiction: null,
    genre: null,
    rating: null,
    status: "archive",
    type: "book",
    created_at: "2026-01-01T00:00:00Z",
    // Nothing else on the row is read by the view layer, so it stays off.
    ...over,
  } as unknown as ReadingBookWithProgress;
}

const view = (over: Partial<ShelfView> = {}): ShelfView => ({
  ...defaultView("archive"),
  ...over,
});

const titles = (books: ReadingBookWithProgress[]) => books.map((b) => b.title);
const headings = (
  books: ReadingBookWithProgress[],
  groupBy: ShelfView["groupBy"]
) => groupBooks(books, groupBy, (r) => `R:${r}`).map((g) => g.heading);

console.log("\nDefaults");
{
  check(
    "the archive still arrives grouped by rating",
    defaultView("archive").groupBy === "rating"
  );
  for (const tab of ["in_progress", "queued", "paused"] as const) {
    check(
      `${tab} is a plain grid, as it was`,
      defaultView(tab).groupBy === "none"
    );
  }
  check(
    "an untouched view reads as untouched",
    isDefaultView(defaultView("archive"), "archive")
  );
  check(
    "and changing the grouping alone counts as touched",
    !isDefaultView(view({ groupBy: "genre" }), "archive")
  );
  check(
    "whitespace in the search box is not a filter",
    isDefaultView(view({ query: "   " }), "archive") &&
      activeFilterCount(view({ query: "   " })) === 0
  );
}

console.log("\nThe fiction filter");
{
  const shelf = [
    book({ title: "A Novel", fiction: true }),
    book({ title: "An Argument", fiction: false }),
    book({ title: "Unclassified", fiction: null }),
  ];
  check(
    "Fiction shows only fiction",
    titles(filterBooks(shelf, view({ fiction: "fiction" }))).join() === "A Novel"
  );
  check(
    "Nonfiction shows only non-fiction",
    titles(filterBooks(shelf, view({ fiction: "nonfiction" }))).join() ===
      "An Argument"
  );
  // The whole point of storing fiction separately: unknown is a third state, and
  // letting it fall into either half is how the old spoiler flag went wrong.
  check(
    "an unclassified book belongs to neither half",
    !titles(filterBooks(shelf, view({ fiction: "fiction" }))).includes(
      "Unclassified"
    ) &&
      !titles(filterBooks(shelf, view({ fiction: "nonfiction" }))).includes(
        "Unclassified"
      )
  );
  check(
    "and All still shows everything",
    filterBooks(shelf, view({ fiction: "all" })).length === 3
  );
}

console.log("\nGenre, rating and search");
{
  const shelf = [
    book({ title: "Dune", genre: "science_fiction", rating: "loved" }),
    book({ title: "Stoner", genre: "literary_fiction", rating: null }),
    book({ title: "Influence", genre: "psychology_self", rating: "liked" }),
  ];
  check(
    "an empty genre list hides nothing",
    filterBooks(shelf, view({ genres: [] })).length === 3
  );
  check(
    "picking two genres shows both",
    titles(
      filterBooks(shelf, view({ genres: ["science_fiction", "psychology_self"] }))
    ).join() === "Dune,Influence"
  );
  check(
    "an unrated book is reachable as a rating",
    titles(filterBooks(shelf, view({ ratings: ["unrated"] }))).join() === "Stoner"
  );
  check(
    "search matches the title, case-insensitively",
    titles(filterBooks(shelf, view({ query: "DUN" }))).join() === "Dune"
  );
  check(
    "search matches the author too",
    filterBooks(shelf, view({ query: "an author" })).length === 3
  );
  check(
    "filters compound rather than replace each other",
    filterBooks(
      shelf,
      view({ genres: ["science_fiction"], ratings: ["unrated"] })
    ).length === 0
  );
}

console.log("\nGrouping");
{
  const rated = [
    book({ rating: "loved" as ReadingRating }),
    book({ rating: null }),
    book({ rating: "didnt_finish" as ReadingRating }),
  ];
  check(
    "rating keeps its order: unrated first, DNF last",
    headings(rated, "rating").join() === "R:unrated,R:loved,R:didnt_finish"
  );
  check(
    "and an empty rating bucket draws no heading",
    !headings(rated, "rating").includes("R:disliked")
  );

  // The ordering that makes a 17-way grouping legible at all.
  const mixed = [
    book({ genre: "psychology_self" }),
    book({ genre: "science_fiction" }),
    book({ genre: null }),
    book({ genre: "literary_fiction" }),
  ];
  const genreGroups = groupBooks(mixed, "genre", (r) => r);
  check(
    "genre groups run fiction first, then non-fiction",
    genreGroups
      .map((g) => g.key)
      .filter((k) => k !== "uncategorized")
      .every((k, i, all) =>
        i === 0
          ? true
          : genreSide(all[i - 1]) !== "nonfiction" || genreSide(k) === "nonfiction"
      ),
    genreGroups.map((g) => g.key).join()
  );
  check(
    "uncategorized sorts last, as a to-do rather than a category",
    genreGroups.at(-1)!.heading === "Uncategorized"
  );

  const kinds = [
    book({ fiction: false }),
    book({ fiction: null }),
    book({ fiction: true }),
  ];
  check(
    "fiction groups read Fiction, Nonfiction, Unclear",
    headings(kinds, "fiction").join() === "Fiction,Nonfiction,Unclear"
  );

  const authors = [
    book({ author: "Woolf" }),
    book({ author: null }),
    book({ author: "Baldwin" }),
  ];
  check(
    "authors are alphabetical with the unknown one last",
    headings(authors, "author").join() === "Baldwin,Woolf,Unknown author"
  );

  const added = [
    book({ created_at: "2025-11-03T00:00:00Z" }),
    book({ created_at: "2026-08-06T00:00:00Z" }),
  ];
  check(
    "date added is newest month first",
    headings(added, "added").join() === "August 2026,November 2025"
  );

  // The caller renders a lone unheaded group as a plain grid, so "no grouping"
  // has to produce exactly that rather than one heading saying nothing.
  const none = groupBooks(rated, "none", (r) => r);
  check(
    "no grouping is a single unheaded group",
    none.length === 1 && none[0].heading === ""
  );
  check(
    "and an empty shelf is too, whatever the grouping",
    groupBooks([], "genre", (r) => r).length === 1
  );
  check(
    "grouping never loses or duplicates a book",
    (["rating", "genre", "fiction", "author", "added", "none"] as const).every(
      (mode) =>
        groupBooks(mixed, mode, (r: ShelfRating) => r).reduce(
          (n, g) => n + g.books.length,
          0
        ) === mixed.length
    )
  );
}

console.log(
  failures === 0
    ? "\nAll shelf-view checks passed."
    : `\n${failures} shelf-view check(s) FAILED.`
);
process.exit(failures === 0 ? 0 : 1);
