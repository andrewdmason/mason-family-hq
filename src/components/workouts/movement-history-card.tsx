import { TrendingUp, History, GitCompareArrows } from "lucide-react";
import type { MovementHistory } from "@/lib/workouts/queries";
import type { SiblingHint } from "@/lib/workouts/sibling";
import { relativeDays } from "@/lib/workouts/format";

/**
 * The "how have I done this before" panel that sits next to a movement's sets at
 * the gym. For a loaded lift it shows your best estimated 1RM, the suggested load
 * for today's prescribed reps (WodUp's killer feature), and recent top results.
 */
export function MovementHistoryCard({
  canonicalName,
  history,
  prescribedReps,
  prescribedLoad,
  today,
  siblingHint,
}: {
  canonicalName: string;
  history: MovementHistory;
  prescribedReps: number | null;
  prescribedLoad: number | null;
  today: string;
  siblingHint?: SiblingHint | null;
}) {
  const best = history.bestE1rmStrict;
  const suggested = prescribedReps ? history.suggestedFor(prescribedReps) : null;
  const percent =
    prescribedLoad != null ? history.percentOf(prescribedLoad) : null;

  if (!best && history.recent.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
        {siblingHint ? (
          <span className="inline-flex flex-wrap items-center gap-1">
            <GitCompareArrows className="size-3.5 text-muted-foreground" />
            No {canonicalName} history yet — from your {siblingHint.fromName}, est.
            1RM ≈{" "}
            <span className="font-medium tabular-nums text-foreground">
              {siblingHint.estimate.low}–{siblingHint.estimate.high} lb
            </span>{" "}
            <span className="text-muted-foreground/70">(typical ratio)</span>
          </span>
        ) : (
          <>First time logging {canonicalName} — this becomes your baseline.</>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {best != null && (
          <span className="inline-flex items-center gap-1.5 text-foreground">
            <TrendingUp className="size-3.5 text-primary" />
            <span className="font-medium tabular-nums">{best}</span>
            <span className="text-xs text-muted-foreground">est. 1RM</span>
          </span>
        )}
        {suggested != null && prescribedReps != null && (
          <span className="text-xs text-muted-foreground">
            Today&apos;s {prescribedReps} ≈{" "}
            <span className="font-medium tabular-nums text-foreground">
              {suggested} lb
            </span>
          </span>
        )}
        {percent != null && (
          <span className="text-xs text-muted-foreground">
            Rx load = <span className="tabular-nums">{percent}%</span> of max
          </span>
        )}
      </div>

      {history.recent.length > 0 && (
        <div className="mt-2 flex items-start gap-1.5 border-t border-border/40 pt-2">
          <History className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {history.recent.slice(0, 5).map((s, i) => (
              <li key={i} className="tabular-nums">
                {s.load ? `${s.load}${s.unit ?? "lb"}×${s.reps ?? "?"}` : `×${s.reps ?? "?"}`}
                {s.e1rm != null && (
                  <span className="text-muted-foreground/70">
                    {" "}
                    ({s.e1rm}
                    {s.e1rmIsLoose ? "≈" : ""})
                  </span>
                )}
                <span className="text-muted-foreground/60">
                  {" "}
                  · {relativeDays(s.date, today)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
