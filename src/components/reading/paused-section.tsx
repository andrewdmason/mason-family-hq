"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { BookCard } from "@/components/reading/book-card";
import { cn } from "@/lib/utils";
import type { ActiveBookQuiz, ReadingBookWithProgress } from "@/lib/types";

/**
 * Paused books, tucked into a collapsed disclosure at the bottom of the reading
 * list rather than a tab — they're set aside, so they stay out of the way until
 * expanded.
 */
export function PausedSection({
  books,
  memberEmail = null,
  isOwner = false,
  activeQuizzesByBook = {},
}: {
  books: ReadingBookWithProgress[];
  memberEmail?: string | null;
  isOwner?: boolean;
  activeQuizzesByBook?: Record<string, ActiveBookQuiz>;
}) {
  const [open, setOpen] = useState(false);
  if (books.length === 0) return null;

  return (
    <div className="mt-8 border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
        Paused
        <span className="tabular-nums text-xs opacity-70">{books.length}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              memberEmail={memberEmail}
              isOwner={isOwner}
              activeQuiz={activeQuizzesByBook[book.id] ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
