import Link from "next/link";
import { CheckCircle2, NotebookPen, PenLine, Users } from "lucide-react";
import { WidgetCard } from "./widget-card";
import { cn } from "@/lib/utils";
import type { JournalStatus } from "@/lib/home/journal";
import type { HomeJournalAudience } from "@/lib/home/types";

/** Whole days between two YYYY-MM-DD dates (a − b), via UTC midnight. */
function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
  );
}

/** "Last post yesterday" / "Last post 3 days ago" / "No posts yet". */
function recencyLabel(lastPosted: string | null, today: string): string {
  if (!lastPosted) return "No posts yet";
  const days = daysBetween(today, lastPosted);
  if (days <= 1) return "Last post yesterday";
  if (days < 7) return `Last post ${days} days ago`;
  if (days < 14) return "Last post last week";
  if (days < 60) return `Last post ${Math.round(days / 7)} weeks ago`;
  return `Last post ${Math.round(days / 30)} months ago`;
}

/** The trailing 7 calendar days (oldest first), each flagged if posted. */
function trailingWeek(
  today: string,
  recentDates: string[]
): { date: string; posted: boolean }[] {
  const set = new Set(recentDates);
  const days: { date: string; posted: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const ds = d.toISOString().slice(0, 10);
    days.push({ date: ds, posted: set.has(ds) });
  }
  return days;
}

/**
 * A compact, side-by-side journal card (personal or family). No questions —
 * just where you stand: a celebratory note if you've already posted today,
 * otherwise how long it's been, a seven-day frequency strip, and a CTA into the
 * new-entry flow with the right audience pre-set.
 */
export function JournalStatusWidget({
  audience,
  status,
  today,
}: {
  audience: HomeJournalAudience;
  status: JournalStatus;
  today: string;
}) {
  const isFamily = audience === "family";
  const postedToday = status.lastPosted === today;
  const week = trailingWeek(today, status.recentDates);
  const count = status.recentDates.length;

  return (
    <WidgetCard
      title={isFamily ? "Family journal" : "Personal journal"}
      icon={isFamily ? Users : NotebookPen}
      href={isFamily ? "/family" : "/journal"}
    >
      <div className="flex h-full flex-col">
        {postedToday ? (
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="size-4 shrink-0" />
            <span className="font-serif text-sm font-medium">
              {isFamily ? "Shared with the family today" : "You journaled today"}
            </span>
          </div>
        ) : (
          <p className="font-serif text-sm text-foreground">
            {recencyLabel(status.lastPosted, today)}
          </p>
        )}

        <div className="mt-3 flex items-center gap-2">
          <div className="flex items-center gap-1" aria-hidden>
            {week.map((d) => (
              <span
                key={d.date}
                className={cn(
                  "size-2 rounded-full",
                  d.posted ? "bg-primary" : "bg-muted-foreground/20"
                )}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {count === 0
              ? "nothing in the last 7 days"
              : `${count} ${count === 1 ? "day" : "days"} in the last 7`}
          </span>
        </div>

        <Link
          href={`/journal/new?audience=${isFamily ? "family" : "private"}`}
          className={cn(
            "mt-4 inline-flex h-9 items-center justify-center gap-1.5 rounded-md border font-serif text-sm transition-colors",
            postedToday
              ? "border-muted bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground"
              : "border-foreground/15 bg-foreground/[0.03] text-foreground hover:border-foreground/40 hover:bg-foreground/[0.06]"
          )}
        >
          <PenLine className="size-4" />
          {postedToday
            ? "Add another"
            : isFamily
              ? "Share something"
              : "Write today's entry"}
        </Link>
      </div>
    </WidgetCard>
  );
}
