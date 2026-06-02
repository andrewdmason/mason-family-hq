"use client";

import { useMemo, useState } from "react";
import { ArchiveShelf } from "@/components/reading/archive-shelf";
import { BookCard } from "@/components/reading/book-card";
import { PausedSection } from "@/components/reading/paused-section";
import { QueueRecommendations } from "@/components/reading/queue-recommendations";
import { READING_STATUSES } from "@/lib/reading/status";
import { cn } from "@/lib/utils";
import type {
  ReadingBookStatus,
  ReadingBookWithProgress,
  ReadingRecommendation,
} from "@/lib/types";

type Tab = ReadingBookStatus;

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
  soleBookId,
  soleBookTargetPage,
  emphasizeCheckIn,
  memberEmail = null,
  recommendations,
  recsHasSignal,
  recsGenres,
}: {
  books: ReadingBookWithProgress[];
  soleBookId: string | null;
  soleBookTargetPage: number | null;
  emphasizeCheckIn: boolean;
  memberEmail?: string | null;
  recommendations: ReadingRecommendation[];
  recsHasSignal: boolean;
  recsGenres: string[];
}) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of books) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [books]);

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

  const pausedBooks = books.filter((b) => b.status === "paused");

  const [active, setActive] = useState<Tab>(
    (counts["in_progress"] ?? 0) > 0 ? "in_progress" : "queued"
  );
  const activeTab = tabs.some((t) => t.value === active)
    ? active
    : tabs[0]?.value ?? "in_progress";

  const visible = books.filter((b) => b.status === activeTab);

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
      ) : activeTab === "archive" ? (
        <ArchiveShelf books={visible} memberEmail={memberEmail} />
      ) : (
        <div className="mt-3 space-y-3">
          {visible.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              targetPage={book.id === soleBookId ? soleBookTargetPage : null}
              emphasizeCheckIn={emphasizeCheckIn}
              memberEmail={memberEmail}
            />
          ))}
        </div>
      )}

      <PausedSection books={pausedBooks} memberEmail={memberEmail} />
    </div>
  );
}
