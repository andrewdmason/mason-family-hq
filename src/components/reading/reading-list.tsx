"use client";

import { useMemo, useState } from "react";
import { ArchiveShelf } from "@/components/reading/archive-shelf";
import { ArticleCard } from "@/components/reading/article-card";
import { BookCard } from "@/components/reading/book-card";
import { PausedSection } from "@/components/reading/paused-section";
import { QueueRecommendations } from "@/components/reading/queue-recommendations";
import { READING_STATUSES } from "@/lib/reading/status";
import { cn } from "@/lib/utils";
import type {
  ActiveBookQuiz,
  ReadingBookStatus,
  ReadingBookWithProgress,
  ReadingRecommendation,
} from "@/lib/types";

type Tab = ReadingBookStatus;
type TypeFilter = "all" | "book" | "article";

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "book", label: "Books" },
  { value: "article", label: "Articles" },
];

function emptyMessage(tab: Tab): string {
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

export function ReadingList({
  books,
  emphasizeCheckIn,
  memberEmail = null,
  isAdult = false,
  canRead = false,
  activeQuizzesByBook = {},
  recommendations,
  recsHasSignal,
  recsGenres,
}: {
  books: ReadingBookWithProgress[];
  emphasizeCheckIn: boolean;
  memberEmail?: string | null;
  isAdult?: boolean;
  /** Reader only — Bookshelf uploads book files but never opens them. */
  canRead?: boolean;
  /** Per-book active check-in quiz, keyed by book id. */
  activeQuizzesByBook?: Record<string, ActiveBookQuiz>;
  recommendations: ReadingRecommendation[];
  recsHasSignal: boolean;
  recsGenres: string[];
}) {
  // Books and saved web articles share this list; the type filter narrows it
  // before the status tabs. The filter only appears once there's an article to
  // separate — book-only members see the list exactly as before.
  const hasArticles = useMemo(
    () => books.some((b) => b.type === "article"),
    [books]
  );
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const filtered = useMemo(
    () =>
      typeFilter === "all"
        ? books
        : books.filter((b) => (b.type ?? "book") === typeFilter),
    [books, typeFilter]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of filtered) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [filtered]);

  // Always offer the forward-looking tabs (Reading, Queue) so the queue is
  // reachable even when empty; show the rest only when they have books. Paused
  // isn't a tab — it lives in a collapsed section at the bottom.
  const ALWAYS_SHOWN: ReadingBookStatus[] = ["in_progress", "queued"];
  const tabs: { value: Tab; label: string; count: number }[] =
    READING_STATUSES.filter(
      (s) =>
        s.value !== "paused" &&
        (ALWAYS_SHOWN.includes(s.value) || (counts[s.value] ?? 0) > 0)
    ).map((s) => ({
      value: s.value as Tab,
      label: s.label,
      count: counts[s.value] ?? 0,
    }));

  const pausedBooks = filtered.filter((b) => b.status === "paused");

  const [active, setActive] = useState<Tab>(
    (counts["in_progress"] ?? 0) > 0 ? "in_progress" : "queued"
  );
  const activeTab = tabs.some((t) => t.value === active)
    ? active
    : tabs[0]?.value ?? "in_progress";

  const visible = filtered.filter((b) => b.status === activeTab);
  const visibleBooks = visible.filter((b) => (b.type ?? "book") === "book");
  const visibleArticles = visible.filter((b) => b.type === "article");

  if (books.length === 0) {
    return (
      <p className="mt-8 rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
        No books yet. Add the one you&apos;re reading — or a few for your queue —
        to start tracking.
      </p>
    );
  }

  return (
    <div className="mt-5">
      {hasArticles && (
        <div className="mb-3 inline-flex rounded-lg bg-muted/60 p-0.5">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setTypeFilter(f.value)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                typeFilter === f.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
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
          memberEmail={memberEmail}
        />
      )}

      {visible.length === 0 ? (
        activeTab === "queued" ? null : (
          <p className="mt-3 rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            {emptyMessage(activeTab)}
          </p>
        )
      ) : (
        <div className="mt-3 space-y-3">
          {/* Books: the archive tab uses the cover shelf; other tabs use cards. */}
          {visibleBooks.length > 0 &&
            (activeTab === "archive" ? (
              <ArchiveShelf
                books={visibleBooks}
                memberEmail={memberEmail}
                canRead={canRead}
              />
            ) : (
              visibleBooks.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  emphasizeCheckIn={emphasizeCheckIn}
                  memberEmail={memberEmail}
                  isAdult={isAdult}
                  canRead={canRead}
                  activeQuiz={activeQuizzesByBook[book.id] ?? null}
                />
              ))
            ))}
          {/* Saved web articles always render as article cards. */}
          {visibleArticles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              memberEmail={memberEmail}
              canRead={canRead}
            />
          ))}
        </div>
      )}

      <PausedSection
        books={pausedBooks}
        memberEmail={memberEmail}
        isAdult={isAdult}
        canRead={canRead}
        activeQuizzesByBook={activeQuizzesByBook}
      />
    </div>
  );
}
