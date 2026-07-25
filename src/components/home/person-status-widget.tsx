import { BookOpen, CalendarDays, UserRound } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { WidgetCard } from "./widget-card";
import { formatTimeRange } from "@/lib/calendar/calendar-utils";
import { quizTakeHref, bookshelfHref } from "@/lib/reading/links";
import { chapterTargetLabel } from "@/lib/reading/chapter-target";
import { cn } from "@/lib/utils";
import type {
  HomePersonStatus,
  HomeReadingBookStatus,
  HomeReadingQuizState,
} from "@/lib/home/types";

const QUIZ_BADGE: Record<
  HomeReadingQuizState,
  { label: string; className: string }
> = {
  ready: { label: "Quiz ready", className: "bg-primary/10 text-primary" },
  due: {
    label: "Due now",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  retake: {
    label: "Needs retake",
    className: "bg-destructive/15 text-destructive",
  },
};

function roleLabel(role: HomePersonStatus["role"]): string {
  if (role === "kid") return "Kid";
  return "Parent";
}

function readingStatus(book: HomeReadingBookStatus): {
  label: string;
  className: string;
} {
  if (book.quiz) return QUIZ_BADGE[book.quiz.state];
  if (book.targetPage != null && book.currentPage >= book.targetPage) {
    return {
      label: "Target reached",
      className: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400",
    };
  }
  return {
    label: "Reading",
    className: "bg-muted text-muted-foreground",
  };
}

function pageLine(book: HomeReadingBookStatus): string {
  // Chapter books have no real page numbers — show the chapter, never a page.
  if (book.targetChapter) {
    const label = chapterTargetLabel(book.targetChapter);
    return `Goal: ${label.charAt(0).toUpperCase()}${label.slice(1)}`;
  }
  if (book.targetPage != null) return `Goal: Page ${book.targetPage}`;
  const total = book.totalPages ? ` of ${book.totalPages}` : "";
  return `Page ${book.currentPage}${total}`;
}

function ReadingBookRow({
  book,
  memberEmail,
}: {
  book: HomeReadingBookStatus;
  memberEmail: string;
}) {
  const status = readingStatus(book);
  return (
    <li className="rounded-md border border-border/70 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-serif text-sm leading-snug text-foreground">
            {book.title}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {pageLine(book)}
          </p>
        </div>
        <Badge className={cn("shrink-0 border-0", status.className)}>
          {status.label}
        </Badge>
      </div>
      {book.quiz && (
        <div className="mt-1 flex items-center justify-end gap-2 text-xs">
          <Link
            href={quizTakeHref(book.quiz.id, memberEmail)}
            className="font-medium text-primary transition-colors hover:text-primary/75"
          >
            View quiz
          </Link>
        </div>
      )}
    </li>
  );
}

export function PersonStatusWidget({
  person,
  tz,
}: {
  person: HomePersonStatus;
  tz: string;
}) {
  const reading = person.reading;
  // Only a kid's reading is administered in Bookshelf. The other parent's books
  // are theirs alone — Reader is self-scoped — so their card doesn't link out.
  const readingHref = person.role === "kid" ? bookshelfHref(person.email) : null;
  const visibleBooks = reading?.books.slice(0, 1) ?? [];

  return (
    <WidgetCard
      title={person.name}
      icon={UserRound}
      href="/calendar"
      hrefLabel={`Open ${person.name}'s calendar`}
      action={
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: person.color }}
          />
          {roleLabel(person.role)}
        </span>
      }
    >
      <div className="space-y-4">
        {visibleBooks.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              {readingHref ? (
                <Link
                  href={readingHref}
                  className="inline-flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground transition-colors hover:text-foreground"
                >
                  <BookOpen className="size-3.5" />
                  Reading
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
                  <BookOpen className="size-3.5" />
                  Reading
                </span>
              )}
              {reading && reading.weeklyPageGoal > 0 && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {reading.pagesReadThisWeek}/{reading.weeklyPageGoal} pages
                </span>
              )}
            </div>

            <ul className="space-y-2">
              {visibleBooks.map((book) => (
                <ReadingBookRow
                  key={book.id}
                  book={book}
                  memberEmail={person.email}
                />
              ))}
            </ul>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase text-muted-foreground">
            <CalendarDays className="size-3.5" />
            Today
          </div>
          {person.events.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
              No more events today.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {person.events.map((event) => (
                <li key={event.id} className="text-sm leading-snug">
                  <span className="text-muted-foreground">
                    {formatTimeRange(
                      event.start_time,
                      event.end_time,
                      event.all_day,
                      tz
                    )}
                  </span>{" "}
                  <span className="text-foreground">{event.title}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </WidgetCard>
  );
}
