import {
  genreLabel,
  genreOrder,
  isReadingGenre,
  type ReadingGenre,
} from "@/lib/reading/book-genres";
import type {
  ReadingBookStatus,
  ReadingBookWithProgress,
  ReadingRating,
} from "@/lib/types";

/**
 * How the shelf is arranged: what it groups by, what it hides, what you typed.
 *
 * Pure data and pure functions, kept out of the component so the grouping rules
 * are readable on their own and can be asserted without rendering anything.
 *
 * Everything here runs on books already in the browser — the library page loads
 * the whole shelf in one query — so filtering and search never hit the server.
 */

export type ShelfGroupBy =
  | "none"
  | "rating"
  | "genre"
  | "fiction"
  | "author"
  | "added";

/** The coarse cut. "all" means don't filter on it. */
export type ShelfFiction = "all" | "fiction" | "nonfiction";

/** A rating bucket, including books nobody has rated yet. */
export type ShelfRating = ReadingRating | "unrated";

/** The archive's verdict order: unrated first (a nudge to rate), then best to
 * worst, with "didn't finish" at the bottom. Doubles as the list of ratings a
 * URL is allowed to name. */
const RATING_ORDER: ShelfRating[] = [
  "unrated",
  "loved",
  "liked",
  "neutral",
  "disliked",
  "didnt_finish",
];

export type ShelfView = {
  groupBy: ShelfGroupBy;
  fiction: ShelfFiction;
  /** Empty means every genre — a filter nobody set shouldn't hide anything. */
  genres: ReadingGenre[];
  /** Empty means every rating. */
  ratings: ShelfRating[];
  /** Matched against title and author. */
  query: string;
};

/** Arrangements are kept per tab: the archive and a four-book queue want
 * different things, and carrying one tab's filters onto another reads as a bug.
 * Only the tab you're on is in the URL; the others are remembered for as long as
 * you're on the page, so flipping across and back doesn't lose your place. */
export type ShelfViews = Partial<Record<ReadingBookStatus, ShelfView>>;

export const GROUP_BY_OPTIONS: { value: ShelfGroupBy; label: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "rating", label: "Rating" },
  { value: "genre", label: "Genre" },
  { value: "fiction", label: "Fiction/Nonfiction" },
  { value: "author", label: "Author" },
  { value: "added", label: "Date added" },
];

export const FICTION_OPTIONS: { value: ShelfFiction; label: string }[] = [
  { value: "all", label: "All" },
  { value: "fiction", label: "Fiction" },
  { value: "nonfiction", label: "Nonfiction" },
];

/**
 * The archive is the one shelf that's always been grouped — by your verdict — and
 * that stays the default. Everywhere else a grid of eight books needs no headings.
 */
export function defaultView(tab: ReadingBookStatus): ShelfView {
  return {
    groupBy: tab === "archive" ? "rating" : "none",
    fiction: "all",
    genres: [],
    ratings: [],
    query: "",
  };
}

/** True when the view still shows everything, i.e. the trigger stays untinted. */
export function isDefaultView(view: ShelfView, tab: ReadingBookStatus): boolean {
  const base = defaultView(tab);
  return (
    view.groupBy === base.groupBy &&
    view.fiction === "all" &&
    view.genres.length === 0 &&
    view.ratings.length === 0 &&
    view.query.trim() === ""
  );
}

/** How many filters are narrowing the shelf, for the trigger's badge. */
export function activeFilterCount(view: ShelfView): number {
  return (
    (view.fiction === "all" ? 0 : 1) +
    (view.genres.length > 0 ? 1 : 0) +
    (view.ratings.length > 0 ? 1 : 0) +
    (view.query.trim() === "" ? 0 : 1)
  );
}

/**
 * Where the shelf's state lives: the address bar.
 *
 * Which shelf you're looking at and how you've narrowed it is *where you are*,
 * not a device preference — so a refresh, a bookmark, or a link you hand to
 * someone else all reopen the shelf you were actually looking at. Filters that
 * survive a reload but vanish on one are the confusing half of both worlds.
 *
 * Only what you changed is written down: an untouched shelf keeps a clean
 * /reader/library, and the tab is named only when it isn't the one you'd land on
 * anyway. The slugs are the words on the tabs ("reading", "queue"), not the
 * status values the database stores, because a URL is read by people.
 *
 * Anything unrecognised is dropped rather than honoured, so a mangled link opens
 * the shelf instead of an empty one.
 */

/** Just enough of URLSearchParams to read a link — Next's read-only params fit. */
export type ShelfSearchParams = { get(name: string): string | null };

const TAB_SLUGS: Record<ReadingBookStatus, string> = {
  in_progress: "reading",
  queued: "queue",
  archive: "archive",
  paused: "paused",
};

const TAB_BY_SLUG = new Map(
  (Object.keys(TAB_SLUGS) as ReadingBookStatus[]).map((s) => [TAB_SLUGS[s], s])
);

function one(params: ShelfSearchParams, key: string): string | null {
  const raw = params.get(key)?.trim();
  return raw ? raw : null;
}

function many(params: ShelfSearchParams, key: string): string[] {
  return (one(params, key) ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function isShelfRating(value: string): value is ShelfRating {
  return (RATING_ORDER as string[]).includes(value);
}

/** The tab a link names, or null when it names none (or one we don't have). */
export function parseShelfTab(
  params: ShelfSearchParams
): ReadingBookStatus | null {
  return TAB_BY_SLUG.get(one(params, "tab") ?? "") ?? null;
}

/** How a link says this tab is arranged, falling back field by field to the
 * tab's own defaults — so `?rating=loved` still arrives grouped as usual. */
export function parseShelfView(
  params: ShelfSearchParams,
  tab: ReadingBookStatus
): ShelfView {
  const base = defaultView(tab);
  const group = GROUP_BY_OPTIONS.find((o) => o.value === one(params, "group"));
  const kind = FICTION_OPTIONS.find((o) => o.value === one(params, "kind"));
  return {
    groupBy: group?.value ?? base.groupBy,
    fiction: kind?.value ?? base.fiction,
    genres: many(params, "genre").filter(isReadingGenre),
    ratings: many(params, "rating").filter(isShelfRating),
    query: one(params, "q") ?? "",
  };
}

/**
 * The query string that reopens this shelf — "" when there's nothing to say.
 *
 * `landingTab` is the tab the shelf opens on by itself, so staying there costs
 * the URL nothing; the moment anything else is set, the tab is written too, or a
 * reload would apply your filters to whichever shelf happened to open.
 */
export function shelfQueryString(
  tab: ReadingBookStatus,
  view: ShelfView,
  landingTab: ReadingBookStatus
): string {
  const filters: [string, string][] = [];
  const base = defaultView(tab);
  if (view.groupBy !== base.groupBy) filters.push(["group", view.groupBy]);
  if (view.fiction !== "all") filters.push(["kind", view.fiction]);
  if (view.genres.length > 0) filters.push(["genre", view.genres.join(",")]);
  if (view.ratings.length > 0) filters.push(["rating", view.ratings.join(",")]);
  if (view.query.trim()) filters.push(["q", view.query.trim()]);

  const params = new URLSearchParams();
  if (tab !== landingTab || filters.length > 0) params.set("tab", TAB_SLUGS[tab]);
  for (const [key, value] of filters) params.set(key, value);

  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD");

/** Apply the filters and the search box. Order within the list is untouched. */
export function filterBooks(
  books: ReadingBookWithProgress[],
  view: ShelfView
): ReadingBookWithProgress[] {
  const query = norm(view.query.trim());
  const genres = new Set<string>(view.genres);
  const ratings = new Set<string>(view.ratings);

  return books.filter((book) => {
    if (view.fiction === "fiction" && book.fiction !== true) return false;
    // A book we couldn't classify is genuinely unknown, not non-fiction, so it
    // stays out of both halves rather than defaulting into one.
    if (view.fiction === "nonfiction" && book.fiction !== false) return false;
    if (genres.size > 0 && !(book.genre && genres.has(book.genre))) return false;
    if (ratings.size > 0 && !ratings.has(book.rating ?? "unrated")) return false;
    if (query) {
      const haystack = `${book.title} ${book.author ?? ""}`;
      if (!norm(haystack).includes(query)) return false;
    }
    return true;
  });
}

export type ShelfGroup = {
  key: string;
  heading: string;
  books: ReadingBookWithProgress[];
};

/** How a book's author sorts and reads as a heading. */
function authorKey(book: ReadingBookWithProgress): string {
  return book.author?.trim() || "";
}

/** The month a book was added, as a stable sort key and a readable heading. */
function addedKey(book: ReadingBookWithProgress): string {
  return book.created_at.slice(0, 7);
}

function addedHeading(key: string): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return "Unknown";
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Split books into ordered, headed sections.
 *
 * Every mode returns a single unheaded group when it has nothing to say, so the
 * caller can render one code path — a lone group with an empty heading is drawn
 * as a plain grid.
 */
export function groupBooks(
  books: ReadingBookWithProgress[],
  groupBy: ShelfGroupBy,
  ratingHeading: (rating: ShelfRating) => string
): ShelfGroup[] {
  if (groupBy === "none" || books.length === 0) {
    return [{ key: "all", heading: "", books }];
  }

  const buckets = new Map<string, ReadingBookWithProgress[]>();
  const put = (key: string, book: ReadingBookWithProgress) => {
    const list = buckets.get(key);
    if (list) list.push(book);
    else buckets.set(key, [book]);
  };

  for (const book of books) {
    switch (groupBy) {
      case "rating":
        put(book.rating ?? "unrated", book);
        break;
      case "genre":
        put(book.genre ?? "", book);
        break;
      case "fiction":
        put(
          book.fiction === true
            ? "fiction"
            : book.fiction === false
              ? "nonfiction"
              : "",
          book
        );
        break;
      case "author":
        put(authorKey(book), book);
        break;
      case "added":
        put(addedKey(book), book);
        break;
    }
  }

  const entries = [...buckets.entries()];

  switch (groupBy) {
    case "rating":
      return RATING_ORDER.filter((r) => buckets.has(r)).map((r) => ({
        key: r,
        heading: ratingHeading(r),
        books: buckets.get(r)!,
      }));
    case "genre":
      // Taxonomy order, which puts the fiction genres first — so grouping by
      // genre reads as a fiction half then a non-fiction half. Uncategorized
      // last, since it's a to-do rather than a category.
      return entries
        .sort((a, b) => genreOrder(a[0] || null) - genreOrder(b[0] || null))
        .map(([key, group]) => ({
          key: key || "uncategorized",
          heading: key ? genreLabel(key) : "Uncategorized",
          books: group,
        }));
    case "fiction": {
      const order = ["fiction", "nonfiction", ""];
      const label: Record<string, string> = {
        fiction: "Fiction",
        nonfiction: "Nonfiction",
        "": "Unclear",
      };
      return order
        .filter((k) => buckets.has(k))
        .map((k) => ({
          key: k || "unclear",
          heading: label[k],
          books: buckets.get(k)!,
        }));
    }
    case "author":
      return entries
        .sort((a, b) => {
          // Unknown authors last, then alphabetical by the name as written.
          if (!a[0]) return 1;
          if (!b[0]) return -1;
          return a[0].localeCompare(b[0]);
        })
        .map(([key, group]) => ({
          key: key || "unknown",
          heading: key || "Unknown author",
          books: group,
        }));
    case "added":
      // Newest month first: what you added recently is what you're looking for.
      return entries
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([key, group]) => ({
          key,
          heading: addedHeading(key),
          books: group,
        }));
    default:
      return [{ key: "all", heading: "", books }];
  }
}
