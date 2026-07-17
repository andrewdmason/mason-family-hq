import { AlertTriangle, BookOpen } from "lucide-react";
import Link from "next/link";
import { WidgetCard } from "./widget-card";
import { cn } from "@/lib/utils";
import { quizTakeHref } from "@/lib/reading/links";
import { activeQuizState } from "@/lib/reading/quiz-due";
import { chapterTargetLabel } from "@/lib/reading/chapter-target";
import type { ActiveBookQuiz, ReadingBookWithProgress } from "@/lib/types";

/** Uppercase the first letter (for goal phrasing like "Finish Chapter 8"). */
function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

/** The pill label + classes for an active quiz's state. */
const QUIZ_BADGE = {
  ready: { label: "Quiz ready", className: "bg-primary/10 text-primary" },
  due: {
    label: "Due now",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  retake: {
    label: "Needs retake",
    className: "bg-destructive/15 text-destructive",
  },
} as const;

/**
 * A window into the active book. For parents (`variant="default"`) it shows this
 * week's progress toward the page goal. For kids (`variant="goal"`) it strips that
 * chrome down to the page they're aiming for ("Goal: Page 180") and a loud alert
 * when they've blown past the deadline. Either way, a published, unpassed quiz on
 * the book surfaces a "Take quiz" CTA (the kid needs that nudge most). The title
 * opens the Reader either way.
 */
export function ReaderWidget({
  book,
  weeklyPageGoal,
  activeQuiz,
  variant = "default",
  today,
}: {
  book: ReadingBookWithProgress;
  weeklyPageGoal: number;
  activeQuiz: ActiveBookQuiz | null;
  variant?: "default" | "goal";
  today?: string;
}) {
  const pct =
    weeklyPageGoal > 0
      ? Math.min(100, Math.round((book.pagesReadThisWeek / weeklyPageGoal) * 100))
      : 0;

  // Goal variant: whole days from today to the target's Friday deadline.
  // Negative once the deadline has passed; null when there's no target/today.
  const daysUntilDue =
    variant === "goal" && book.target_due != null && today != null
      ? Math.round(
          (new Date(`${book.target_due}T12:00:00`).getTime() -
            new Date(`${today}T12:00:00`).getTime()) /
            86_400_000
        )
      : null;

  // The goal is still in play (kid hasn't reached the target page yet).
  const goalUnmet =
    variant === "goal" &&
    book.target_page != null &&
    book.current_page < book.target_page;

  const overdue = goalUnmet && daysUntilDue != null && daysUntilDue < 0;

  const dueCountdown =
    daysUntilDue == null
      ? null
      : daysUntilDue === 0
        ? "Due today"
        : daysUntilDue === 1
          ? "Due tomorrow"
          : `Due in ${daysUntilDue} days`;

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
            {book.target_chapter && book.total_pages
              ? // Chapter books have no real page numbers — show honest progress
                // as a percentage rather than a made-up page count.
                `${Math.round((book.current_page / book.total_pages) * 100)}% through`
              : book.total_pages
                ? `Page ${book.current_page} of ${book.total_pages}`
                : `Page ${book.current_page}`}
          </p>
          {variant === "goal" && book.target_page != null && (
            <p className="mt-1.5 text-sm font-semibold text-foreground">
              Goal:{" "}
              {book.target_chapter
                ? capitalize(chapterTargetLabel(book.target_chapter))
                : `Page ${book.target_page}`}
            </p>
          )}
          {variant === "goal" &&
            goalUnmet &&
            (overdue ? (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive">
                <AlertTriangle className="size-3.5" />
                Overdue by {-daysUntilDue!}{" "}
                {-daysUntilDue! === 1 ? "day" : "days"}
              </div>
            ) : (
              dueCountdown && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {dueCountdown}
                </p>
              )
            ))}
          {activeQuiz &&
            (() => {
              const state = activeQuizState(
                activeQuiz.attempted,
                activeQuiz.dueNow
              );
              const badge = QUIZ_BADGE[state];
              return (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[0.7rem] font-medium",
                      badge.className
                    )}
                  >
                    {badge.label}
                  </span>
                  <Link
                    href={quizTakeHref(activeQuiz.quizId)}
                    className="inline-flex items-center rounded-md border border-primary/30 px-2 py-0.5 text-[0.7rem] font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    {state === "retake" ? "Retake quiz" : "Take quiz"}
                  </Link>
                </div>
              );
            })()}
        </div>
      </div>

      {variant === "default" && weeklyPageGoal > 0 && (
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
