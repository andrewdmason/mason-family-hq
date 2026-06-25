import { Sparkles, Trophy } from "lucide-react";
import { ProgressBar } from "@/components/reading/progress-bar";
import { cn } from "@/lib/utils";
import type { MilestoneProgress } from "@/lib/types";

function metricLabel(metric: MilestoneProgress["metric"]): string {
  return metric === "bonus_pages" ? "bonus pages" : "pages read";
}

/** A single milestone's progress bar + reward image. `featured` enlarges it. */
function MilestoneRow({
  milestone,
  featured,
}: {
  milestone: MilestoneProgress;
  featured: boolean;
}) {
  const { title, current, threshold, imageUrl, reached, metric } = milestone;
  const pct = Math.min(100, Math.round((current / threshold) * 100));
  const remaining = Math.max(0, threshold - current);

  return (
    <div className="flex items-center gap-3">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={`Reward: ${title}`}
          className={cn(
            "shrink-0 rounded-md object-contain",
            featured ? "h-14 w-auto max-w-16" : "h-10 w-auto max-w-12"
          )}
        />
      ) : (
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
            featured ? "h-14 w-14" : "h-10 w-10"
          )}
        >
          <Trophy className={featured ? "h-6 w-6" : "h-4 w-4"} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate font-medium text-foreground",
              featured ? "text-sm" : "text-xs"
            )}
          >
            {title}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {reached ? (
              <span className="font-medium text-amber-700 dark:text-amber-400">
                Achieved 🎉
              </span>
            ) : (
              `${current.toLocaleString()} / ${threshold.toLocaleString()}`
            )}
          </span>
        </div>
        <ProgressBar pct={pct} reached={reached} className="mt-1.5" />
        {featured && !reached && (
          <p className="mt-1 text-[0.7rem] text-muted-foreground">
            {remaining.toLocaleString()} {metricLabel(metric)} to go
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The reader-home progress header: a lifetime bonus-pages counter and the reader's
 * active reward milestones (the nearest one featured, the rest listed compactly).
 * Renders nothing when there's no bonus banked and no milestones set.
 */
export function ReadingProgressHeader({
  bonusPagesTotal,
  milestones,
}: {
  bonusPagesTotal: number;
  milestones: MilestoneProgress[];
}) {
  if (bonusPagesTotal <= 0 && milestones.length === 0) return null;

  const [featured, ...rest] = milestones;

  return (
    <div className="mt-4 rounded-xl border border-border bg-card/50 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-amber-500" />
        <span className="text-2xl font-semibold tabular-nums text-foreground">
          {bonusPagesTotal.toLocaleString()}
        </span>
        <span className="text-sm text-muted-foreground">bonus pages</span>
      </div>

      {featured && (
        <div className="mt-4 border-t border-border pt-4">
          <MilestoneRow milestone={featured} featured />
          {rest.length > 0 && (
            <div className="mt-3 space-y-2.5">
              {rest.map((m) => (
                <MilestoneRow key={m.id} milestone={m} featured={false} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
