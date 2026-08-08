"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { AppHeaderContent } from "@/components/layout/app-header";
import { ArticleCard } from "@/components/reading/article-card";
import { QueueList } from "@/components/reading/queue-list";
import { QueueRecommendations } from "@/components/reading/queue-recommendations";
import { ReaderBookTile } from "@/components/reading/reader-book-tile";
import { RATING_OPTIONS } from "@/components/reading/rating-picker";
import { READING_STATUSES } from "@/lib/reading/status";
import { cn } from "@/lib/utils";
import type {
  ReadingBookStatus,
  ReadingBookWithProgress,
  ReadingRating,
  ReadingRecommendation,
} from "@/lib/types";

/** Reading and Queue are always offered, so an empty queue is still reachable. */
const ALWAYS_SHOWN: ReadingBookStatus[] = ["in_progress", "queued"];

/** How the archive stacks up: unrated first (a nudge to rate), then best to
 * worst, with "didn't finish" at the bottom. */
const RATING_GROUPS: (ReadingRating | "unrated")[] = [
  "unrated",
  "loved",
  "liked",
  "neutral",
  "disliked",
  "didnt_finish",
];

function groupHeading(group: ReadingRating | "unrated"): string {
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
 */
export function ReaderShelf({
  books,
  recommendations,
  recsHasSignal,
  recsGenres,
  actions,
}: {
  books: ReadingBookWithProgress[];
  recommendations: ReadingRecommendation[];
  recsHasSignal: boolean;
  recsGenres: string[];
  /** Reader settings, the overflow menu, Add a book — handed down from the page
   * so the header slot has a single publisher. The slot holds one node, so the
   * shelf (which owns which tab is showing) has to carry these up with it. */
  actions?: React.ReactNode;
}) {
  const [pausedOpen, setPausedOpen] = useState(false);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of books) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [books]);

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

  const visible = books.filter((b) => b.status === activeTab);
  const visibleBooks = visible.filter((b) => (b.type ?? "book") === "book");
  const visibleArticles = visible.filter((b) => b.type === "article");
  const pausedBooks = books.filter(
    (b) => b.status === "paused" && (b.type ?? "book") === "book"
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
      {actions && (
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      )}
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

  return (
    <div className="mt-5 sm:mt-0">
      {header}

      <div className="flex flex-wrap gap-1.5 border-b border-border pb-3 sm:hidden">
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
      </div>

      {activeTab === "queued" && (
        <QueueRecommendations
          recommendations={recommendations}
          hasSignal={recsHasSignal}
          genres={recsGenres}
        />
      )}

      {visible.length === 0 ? (
        activeTab === "queued" ? null : (
          <p className="mt-4 rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            {emptyMessage(activeTab)}
          </p>
        )
      ) : activeTab === "queued" ? (
        /* The Queue is where you decide what's next, so it's a ranked list you
           drag rather than a grid of covers: each row argues for its book, and
           articles take their place in the same order instead of being exiled
           below the grid for want of cover art. */
        <QueueList books={visible} />
      ) : (
        <>
          {visibleBooks.length > 0 &&
            (activeTab === "archive" ? (
              <ArchiveGroups books={visibleBooks} />
            ) : (
              <BookGrid books={visibleBooks} className="mt-5" />
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
  );
}

/** The archive, still stacked by your verdict — it's how you find a book you
 * loved, and what "Copy books as markdown" pastes into a chatbot. */
function ArchiveGroups({ books }: { books: ReadingBookWithProgress[] }) {
  const byGroup = new Map<ReadingRating | "unrated", ReadingBookWithProgress[]>();
  for (const book of books) {
    const key = book.rating ?? "unrated";
    (byGroup.get(key) ?? byGroup.set(key, []).get(key)!).push(book);
  }

  return (
    <div className="mt-5 flex flex-col gap-8">
      {RATING_GROUPS.map((group) => {
        const groupBooks = byGroup.get(group);
        if (!groupBooks || groupBooks.length === 0) return null;
        return (
          <section key={group}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
              <span>{groupHeading(group)}</span>
              <span className="tabular-nums text-xs text-muted-foreground">
                {groupBooks.length}
              </span>
            </h2>
            <BookGrid books={groupBooks} />
          </section>
        );
      })}
    </div>
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
