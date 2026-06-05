import { Music, TrendingDown, TrendingUp } from "lucide-react";
import { WidgetCard } from "./widget-card";
import { formatMinutes } from "@/lib/timer-utils";
import { cn } from "@/lib/utils";
import type { StreakData, WeeklyPracticeData } from "@/lib/types";

/**
 * Owner-only window into the practice log: this week's total volume versus
 * recent weeks, with a small bar trend and the current streak. The title opens
 * the full reports.
 */
export function PracticeTrendWidget({
  weekly,
  streak,
}: {
  weekly: WeeklyPracticeData[];
  streak: StreakData;
}) {
  const thisWeek = weekly[weekly.length - 1]?.totalSeconds ?? 0;
  const lastWeek = weekly[weekly.length - 2]?.totalSeconds ?? 0;
  const delta =
    lastWeek > 0
      ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
      : thisWeek > 0
        ? 100
        : 0;
  const up = thisWeek >= lastWeek;

  // Last 8 weeks as a tiny bar sparkline, scaled to the tallest bar.
  const recent = weekly.slice(-8);
  const max = Math.max(1, ...recent.map((w) => w.totalSeconds));

  return (
    <WidgetCard
      title="Practice"
      icon={Music}
      href="/practice/reports"
      hrefLabel="Open practice reports"
    >
      <div className="flex items-end justify-between">
        <div>
          <p className="font-serif text-2xl leading-none text-foreground">
            {formatMinutes(thisWeek)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">this week</p>
        </div>
        {lastWeek > 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium",
              up ? "text-green-600" : "text-muted-foreground"
            )}
          >
            {up ? (
              <TrendingUp className="size-3.5" />
            ) : (
              <TrendingDown className="size-3.5" />
            )}
            {delta > 0 ? "+" : ""}
            {delta}% vs last week
          </span>
        )}
      </div>

      <div className="mt-4 flex h-12 items-end gap-1">
        {recent.map((w, i) => (
          <div
            key={w.weekStart}
            title={`${w.weekLabel}: ${formatMinutes(w.totalSeconds)}`}
            className={cn(
              "flex-1 rounded-sm",
              i === recent.length - 1 ? "bg-primary" : "bg-primary/30"
            )}
            style={{
              height: `${Math.max(4, Math.round((w.totalSeconds / max) * 100))}%`,
            }}
          />
        ))}
      </div>

      {streak.currentStreak > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {streak.currentStreak}-day streak · {streak.daysPracticedThisWeek}/7 days
          this week
        </p>
      )}
    </WidgetCard>
  );
}
