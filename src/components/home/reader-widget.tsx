import { BookOpen } from "lucide-react";
import Link from "next/link";
import { WidgetCard } from "./widget-card";
import { cn } from "@/lib/utils";
import { quizTakeHref } from "@/lib/reading/links";
import type { ActiveBookQuiz, ReadingBookWithProgress } from "@/lib/types";

/**
 * A window into the active book: this week's progress toward the page goal, and
 * a "quiz ready" flag when one's waiting. The title opens the Reader to check
 * in or take the quiz.
 */
export function ReaderWidget({
  book,
  weeklyPageGoal,
  activeQuiz,
}: {
  book: ReadingBookWithProgress;
  weeklyPageGoal: number;
  activeQuiz: ActiveBookQuiz | null;
}) {
  const pct =
    weeklyPageGoal > 0
      ? Math.min(100, Math.round((book.pagesReadThisWeek / weeklyPageGoal) * 100))
      : 0;

  return (
    <WidgetCard title="Reading" icon={BookOpen} href="/reader">
      <div className="flex items-start gap-3">
        {book.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={book.cover_image_url}
            alt=""
            className="h-20 w-14 shrink-0 rounded object-cover shadow-sm"
          />
        ) : (
          <div className="flex h-20 w-14 shrink-0 items-center justify-center rounded bg-muted">
            <BookOpen className="size-5 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-base leading-snug text-foreground">
            {book.title}
          </p>
          {book.author && (
            <p className="truncate text-xs text-muted-foreground">
              {book.author}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {book.total_pages
              ? `Page ${book.current_page} of ${book.total_pages}`
              : `Page ${book.current_page}`}
          </p>
          {activeQuiz && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[0.7rem] font-medium text-primary">
                Quiz ready
              </span>
              <Link
                href={quizTakeHref(activeQuiz.quizId)}
                className="inline-flex items-center rounded-md border border-primary/30 px-2 py-0.5 text-[0.7rem] font-medium text-primary transition-colors hover:bg-primary/10"
              >
                Take quiz
              </Link>
            </div>
          )}
        </div>
      </div>

      {weeklyPageGoal > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>This week</span>
            <span>
              {book.pagesReadThisWeek} / {weeklyPageGoal} pages
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full bg-primary transition-all",
                pct >= 100 && "bg-green-600"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </WidgetCard>
  );
}
