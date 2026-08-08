"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronRight, Settings } from "lucide-react";
import { AppHeaderContent } from "@/components/layout/app-header";
import { ArticleCard } from "@/components/reading/article-card";
import { QueueList } from "@/components/reading/queue-list";
import { QueueRecommendations } from "@/components/reading/queue-recommendations";
import { ReaderBookTile } from "@/components/reading/reader-book-tile";
import { ReaderOverflowMenu } from "@/components/reading/reader-overflow-menu";
import { RATING_OPTIONS } from "@/components/reading/rating-picker";
import {
  ShelfBooksProvider,
  useOptimisticShelf,
} from "@/components/reading/shelf-books";
import { ShelfDisplayMenu } from "@/components/reading/shelf-display-menu";
import { READING_STATUSES } from "@/lib/reading/status";
import {
  defaultView,
  filterBooks,
  groupBooks,
  isDefaultView,
  shelfViewStore,
  type ShelfRating,
  type ShelfView,
} from "@/lib/reading/shelf-view";
import { cn } from "@/lib/utils";
import type {
  ReadingBookStatus,
  ReadingBookWithProgress,
  ReadingRecommendation,
} from "@/lib/types";

/** Reading and Queue are always offered, so an empty queue is still reachable. */
const ALWAYS_SHOWN: ReadingBookStatus[] = ["in_progress", "queued"];

function groupHeading(group: ShelfRating): string {
  if (group === "unrated") return "Unrated";
  const option = RATING_OPTIONS.find((o) => o.value === group);
  const glyph = option?.emoji ?? option?.chip ?? "";
  return `${glyph}  ${option?.label ?? group}`;
}

function emptyMessage(tab: ReadingBookStatus): string {
  switch (tab) {
    case "queued":
      return "Your queue is empty. Add a book and set its status to Queue.";
    case "in_progress":
      return "Nothing in progress right now. Add a book to start reading.";
    case "archive":
      return "Books you finish or set aside land here.";
    default:
      return "No books here yet.";
  }
}

/**
 * The Reader shelf: your books as cover art, the way a Kindle opens. The status
 * tabs still sort the shelf — Reading, Queue, what you're done with — with paused
 * books tucked away at the bottom and saved articles listed after the grid, since
 * they have no cover to show.
 *
 * The Queue is the exception, and deliberately so: it's the only tab you visit to
 * make a decision rather than to find something you already know, so it's a ranked
 * list carrying each book's reason for being there. Covers are for recognising a
 * book; rows are for comparing them.
 *
 * How a tab is arranged is yours to set, behind the display button: the archive is
 * a hundred covers, and grouping it by verdict is one good answer rather than the
 * only one. Preferences are kept per tab — what you want from the archive is
 * rarely what you want from a four-book queue.
 */
export function ReaderShelf({
  books: serverBooks,
  recommendations,
  recsHasSignal,
  recsGenres,
  actions,
}: {
  books: ReadingBookWithProgress[];
  recommendations: ReadingRecommendation[];
  recsHasSignal: boolean;
  recsGenres: string[];
  /** Add a book — handed down from the page (it needs the recipient list) so the
   * header slot keeps a single publisher. The slot holds one node, so the shelf,
   * which owns which tab is showing, has to carry it up with the tabs. Reader
   * settings and the markdown copy sit next to it and are rendered here. */
  actions?: React.ReactNode;
}) {
  const [pausedOpen, setPausedOpen] = useState(false);

  /* Rate a book, move it to another shelf, retitle it, throw it away: all of it
     lands on screen now, and the save catches up behind it. Everything below
     reads from this list rather than from the server's, so the tabs, the counts,
     the filter chips and whatever the tab is grouped by all re-sort in the same
     frame as the click. */
  const { books, optimistic, error } = useOptimisticShelf(serverBooks);

  const counts: Record<string, number> = {};
  for (const b of books) counts[b.status] = (counts[b.status] ?? 0) + 1;

  const tabs = READING_STATUSES.filter(
    (s) =>
      s.value !== "paused" &&
      (ALWAYS_SHOWN.includes(s.value) || (counts[s.value] ?? 0) > 0)
  ).map((s) => ({ ...s, count: counts[s.value] ?? 0 }));

  const [active, setActive] = useState<ReadingBookStatus>(
    (counts["in_progress"] ?? 0) > 0 ? "in_progress" : "queued"
  );
  const activeTab = tabs.some((t) => t.value === active)
    ? active
    : (tabs[0]?.value ?? "in_progress");

  // Subscribed rather than copied into state on mount, so the server renders the
  // defaults without a hydration mismatch and a second tab stays in step.
  const views = useSyncExternalStore(
    shelfViewStore.subscribe,
    shelfViewStore.getSnapshot,
    shelfViewStore.getServerSnapshot
  );
  const view = views[activeTab] ?? defaultView(activeTab);
  const setView = (next: ShelfView) =>
    shelfViewStore.set({ ...views, [activeTab]: next });

  const inTab = books.filter((b) => b.status === activeTab);
  const tabBooks = inTab.filter((b) => (b.type ?? "book") === "book");

  // Counted before filtering, so a chip always shows how many books it would
  // bring back rather than how many survive the filters already applied.
  const genreCounts = new Map<string, number>();
  const ratingCounts = new Map<string, number>();
  for (const b of tabBooks) {
    if (b.genre) genreCounts.set(b.genre, (genreCounts.get(b.genre) ?? 0) + 1);
    const rated = b.rating ?? "unrated";
    ratingCounts.set(rated, (ratingCounts.get(rated) ?? 0) + 1);
  }

  const visibleBooks = filterBooks(tabBooks, view);
  const groups = groupBooks(visibleBooks, view.groupBy, groupHeading);

  // Articles have no cover, no genre and no rating, so outside the Queue they sit
  // apart from the grouping — the text search is the only display option that
  // reaches them, since that's the one you'd use to find a saved page again.
  const visibleArticles = filterBooks(
    inTab.filter((b) => b.type === "article"),
    { ...defaultView(activeTab), query: view.query }
  );

  // The Queue keeps books and articles in one hand-ranked list, so it filters as
  // one. A genre or rating filter drops articles, which is honest — they have
  // neither — but a plain search still reaches them.
  const visibleQueue = filterBooks(inTab, view);

  const pausedBooks = books.filter(
    (b) => b.status === "paused" && (b.type ?? "book") === "book"
  );

  const displayMenu = (
    <ShelfDisplayMenu
      view={view}
      onChange={setView}
      tab={activeTab}
      genreCounts={genreCounts}
      ratingCounts={ratingCounts}
      // A hand-ranked queue has one order and it's yours. Offering to regroup it
      // would bury the ranking the whole tab exists to let you set.
      showGrouping={activeTab !== "queued"}
    />
  );

  /* Which shelf you're on belongs in the chrome, next to the app's name — the
     same place Practice keeps its sections. Below sm the header has no room, so
     the tabs stay in the page as the pill row they've always been; they're a
     segmented control rather than navigation, and folding them into the hamburger
     would mean tapping one and watching the sheet stay open over the shelf you
     just switched to.

     Published even when the shelf is empty: an empty shelf is exactly when you
     need Add a book, and it lives up here now. */
  const header = (
    <AppHeaderContent>
      <nav className="hidden h-14 items-center gap-6 pl-4 sm:flex">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setActive(t.value)}
            aria-current={activeTab === t.value ? "page" : undefined}
            className={cn(
              "relative flex h-14 items-center gap-1.5 text-sm font-medium transition-colors hover:text-foreground",
              activeTab === t.value
                ? "text-foreground after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:bg-primary"
                : "text-muted-foreground"
            )}
          >
            {t.label}
            <span className="tabular-nums text-xs opacity-60">{t.count}</span>
          </button>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2">
        {/* Travels with the tabs it belongs to, and only on the layout that has
            them up here — the narrow shelf carries its own below. First in the
            group for the same reason: it acts on the shelf you're looking at,
            where the three to its right are about the app around it. */}
        {books.length > 0 && (
          <span className="hidden sm:flex">{displayMenu}</span>
        )}
        <Link
          href="/reader/settings"
          aria-label="Reader settings"
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </Link>
        {/* Rendered here rather than handed down with the rest of the toolbar,
            because what it copies is the shelf as it stands — ratings included,
            which no longer wait on a page re-render. The header slot publishes a
            closure over this render, not a subtree, so the live list can only
            reach it from in here. */}
        <ReaderOverflowMenu books={books} title="Books I've read" />
        {actions}
      </div>
    </AppHeaderContent>
  );

  if (books.length === 0) {
    return (
      <>
        {header}
        <p className="mt-8 rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          No books yet. Add the one you&apos;re reading — or a few for your queue
          — to start tracking.
        </p>
      </>
    );
  }

  const nothingShown =
    activeTab === "queued"
      ? visibleQueue.length === 0
      : visibleBooks.length === 0 && visibleArticles.length === 0;
  const untouched = isDefaultView(view, activeTab);

  return (
    <ShelfBooksProvider value={optimistic}>
      <div className="mt-5 sm:mt-0">
        {header}

        <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-3 sm:hidden">
          {tabs.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setActive(t.value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                activeTab === t.value
                  ? "bg-foreground text-background"
                  : "bg-muted/70 text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              <span className="ml-1.5 tabular-nums opacity-70">{t.count}</span>
            </button>
          ))}
          {displayMenu}
        </div>

        {/* A change that didn't stick. It lives here rather than on a tile
            because the tile is often gone by the time we know — deleted, moved
            to a shelf you're not looking at, or filtered out of the one you are. */}
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

        {activeTab === "queued" && (
          <QueueRecommendations
            recommendations={recommendations}
            hasSignal={recsHasSignal}
            genres={recsGenres}
          />
        )}

        {nothingShown ? (
          activeTab === "queued" && untouched ? null : (
            <p className="mt-4 rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              {untouched
                ? emptyMessage(activeTab)
                : "Nothing matches. Try clearing a filter."}
            </p>
          )
        ) : activeTab === "queued" ? (
          /* The Queue is where you decide what's next, so it's a ranked list you
             drag rather than a grid of covers: each row argues for its book, and
             articles take their place in the same order instead of being exiled
             below the grid for want of cover art. */
          <QueueList books={visibleQueue} />
        ) : (
          <>
            {visibleBooks.length > 0 &&
              (groups.length === 1 && !groups[0].heading ? (
                <BookGrid books={groups[0].books} className="mt-5" />
              ) : (
                <div className="mt-5 flex flex-col gap-8">
                  {groups.map((group) => (
                    <section key={group.key}>
                      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                        <span>{group.heading}</span>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {group.books.length}
                        </span>
                      </h2>
                      <BookGrid books={group.books} />
                    </section>
                  ))}
                </div>
              ))}
            {visibleArticles.length > 0 && (
              <div className="mt-5 space-y-3">
                {visibleArticles.map((article) => (
                  <ArticleCard key={article.id} article={article} canRead />
                ))}
              </div>
            )}
          </>
        )}

        {/* Paused books aren't a tab — they're set aside, so they stay collapsed
            at the bottom until you go looking for them. */}
        {pausedBooks.length > 0 && (
          <div className="mt-8 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setPausedOpen((o) => !o)}
              aria-expanded={pausedOpen}
              className="flex w-full items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight
                className={cn(
                  "h-4 w-4 transition-transform",
                  pausedOpen && "rotate-90"
                )}
              />
              Paused
              <span className="tabular-nums text-xs opacity-70">
                {pausedBooks.length}
              </span>
            </button>

            {pausedOpen && <BookGrid books={pausedBooks} className="mt-4" />}
          </div>
        )}
      </div>
    </ShelfBooksProvider>
  );
}

/** The cover grid itself — same density wherever books are shown. */
function BookGrid({
  books,
  className,
}: {
  books: ReadingBookWithProgress[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-5",
        className
      )}
    >
      {books.map((book) => (
        <ReaderBookTile key={book.id} book={book} />
      ))}
    </div>
  );
}
