import {
  genreLabel,
  genreOrder,
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

/** Preferences are kept per tab: the archive and a four-book queue want
 * different things, and carrying one tab's filters onto another reads as a bug. */
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
 * Where display preferences live: this device, not the account, and not the URL.
 *
 * A view preference rather than a place — a link to the shelf should open the
 * shelf, not somebody's half-applied genre filter. Same store shape the reader's
 * layout settings use, so the server renders the defaults without a hydration
 * mismatch and a change in one tab reaches the others.
 *
 * getSnapshot has to return a stable reference or React re-renders forever, so
 * the parsed value is cached against the raw string it came from.
 */
const STORAGE_KEY = "reader-shelf-view";
const EMPTY: ShelfViews = {};

let cachedRaw: string | null = null;
let cachedValue: ShelfViews = EMPTY;
const listeners = new Set<() => void>();

function currentRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): ShelfViews {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY;
    return parsed as ShelfViews;
  } catch {
    return EMPTY;
  }
}

export const shelfViewStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  },
  getSnapshot(): ShelfViews {
    const raw = currentRaw();
    if (raw !== cachedRaw) {
      cachedRaw = raw;
      cachedValue = parse(raw);
    }
    return cachedValue;
  },
  getServerSnapshot(): ShelfViews {
    return EMPTY;
  },
  set(views: ShelfViews): void {
    const raw = JSON.stringify(views);
    cachedRaw = raw;
    cachedValue = views;
    try {
      window.localStorage.setItem(STORAGE_KEY, raw);
    } catch {
      // Private browsing / quota. The choice still applies for this session.
    }
    for (const listener of listeners) listener();
  },
};

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

/** The archive's verdict order: unrated first (a nudge to rate), then best to
 * worst, with "didn't finish" at the bottom. */
const RATING_ORDER: ShelfRating[] = [
  "unrated",
  "loved",
  "liked",
  "neutral",
  "disliked",
  "didnt_finish",
];

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
