import { Music, TrendingDown, TrendingUp } from "lucide-react";
import { WidgetCard } from "./widget-card";
import { formatMinutes } from "@/lib/timer-utils";
import { cn } from "@/lib/utils";
import type { TrailingPracticeData } from "@/lib/types";

/**
 * Owner-only window into the practice log: practice volume over the last 7 days
 * versus the 7 days before that (a trailing comparison, so it doesn't reset
 * every Monday), a 14-day daily sparkline with the recent week highlighted, and
 * the current streak. The title opens the full reports.
 */
export function PracticeTrendWidget({
  trailing,
  currentStreak,
}: {
  trailing: TrailingPracticeData;
  currentStreak: number;
}) {
  const { currentSeconds, previousSeconds, dailySeconds } = trailing;
  const delta =
    previousSeconds > 0
      ? Math.round(((currentSeconds - previousSeconds) / previousSeconds) * 100)
      : currentSeconds > 0
        ? 100
        : 0;
  const up = currentSeconds >= previousSeconds;

  // Days actually practiced in the trailing 7 (the recent half of dailySeconds).
  const daysPracticed = dailySeconds.slice(7).filter((s) => s > 0).length;

  const max = Math.max(1, ...dailySeconds);

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
            {formatMinutes(currentSeconds)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">last 7 days</p>
        </div>
        {previousSeconds > 0 && (
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
            {delta}% vs prior 7 days
          </span>
        )}
      </div>

      <div className="mt-4 flex h-12 items-end gap-1">
        {dailySeconds.map((seconds, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 rounded-sm",
              // The trailing 7 days (recent half) are emphasized; the prior week
              // is dimmed so the comparison window reads at a glance.
              i >= 7 ? "bg-primary" : "bg-primary/30"
            )}
            style={{
              height: `${Math.max(4, Math.round((seconds / max) * 100))}%`,
            }}
          />
        ))}
      </div>

      {currentStreak > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {currentStreak}-day streak · {daysPracticed}/7 days practiced
        </p>
      )}
    </WidgetCard>
  );
}
