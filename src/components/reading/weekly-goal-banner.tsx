import { CheckInDialog } from "@/components/reading/check-in-dialog";
import { cn } from "@/lib/utils";
import type { ReadingBook } from "@/lib/types";

function daysLeftLabel(days: number): string {
  if (days <= 0) return "due today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

/**
 * The week's reading target: what page to reach, that it's due Sunday, how many
 * days are left, and a quick way to check in. Target page only exists when
 * there's a single active book (the per-person goal maps to one page then);
 * other cases get a minimal goal line.
 */
export function WeeklyGoalBanner({
  weeklyPageGoal,
  targetPage,
  currentPage,
  daysRemaining,
  checkInBook,
  memberEmail = null,
}: {
  weeklyPageGoal: number;
  /** This week's target page, when the member has exactly one active book. */
  targetPage: number | null;
  currentPage: number | null;
  daysRemaining: number;
  checkInBook: ReadingBook | null;
  memberEmail?: string | null;
}) {
  if (weeklyPageGoal <= 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          No weekly page goal set yet. Ask your family manager to set one in
          settings.
        </p>
      </div>
    );
  }

  // No single active book to point at (none, or several) — keep it minimal.
  if (targetPage == null || !checkInBook) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
        <p className="text-sm text-foreground">
          Weekly goal: {weeklyPageGoal} page{weeklyPageGoal === 1 ? "" : "s"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Due Sunday · {daysLeftLabel(daysRemaining)}
        </p>
      </div>
    );
  }

  const met = currentPage != null && currentPage >= targetPage;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3",
        met ? "border-primary/30 bg-primary/5" : "border-border bg-muted/40"
      )}
    >
      <div className="min-w-0">
        {met ? (
          <>
            <p className="font-serif text-sm text-foreground">
              You&apos;ve hit this week&apos;s target 🎉
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              You&apos;re on page {currentPage} — target was page {targetPage}.
            </p>
          </>
        ) : (
          <>
            <p className="font-serif text-sm text-foreground">
              This week&apos;s target:{" "}
              <span className="font-medium tabular-nums">page {targetPage}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Due Sunday · {daysLeftLabel(daysRemaining)}
            </p>
          </>
        )}
      </div>
      <CheckInDialog
        book={checkInBook}
        emphasize={!met}
        targetPage={targetPage}
        memberEmail={memberEmail}
      />
    </div>
  );
}
