import { Award } from "lucide-react";
import { formatScore, formatSessionDate } from "@/lib/workouts/format";
import type { WorkoutScoreType, WorkoutRxLevel } from "@/lib/workouts/types";

export type BenchmarkAttempt = {
  date: string;
  scoreType: WorkoutScoreType;
  score: {
    seconds: number | null;
    rounds: number | null;
    reps: number | null;
    load: number | null;
    distance: number | null;
    calories: number | null;
  };
  rxLevel: WorkoutRxLevel | null;
};

const RX_LABEL: Record<WorkoutRxLevel, string> = {
  scaled: "Scaled",
  rx: "Rx",
  rx_plus: "Rx+",
};

/**
 * Names a benchmark workout and shows how you've done it before, segmented by Rx
 * level — the motivating "Fran: last 7:42, PR 6:58" comparison.
 */
export function BenchmarkBanner({
  name,
  attempts,
}: {
  name: string;
  attempts: BenchmarkAttempt[];
}) {
  const withScore = attempts.filter(
    (a) => formatScore(a.scoreType, a.score) !== null
  );

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
      <div className="flex items-center gap-2">
        <Award className="size-4 text-primary" />
        <span className="font-serif text-sm text-foreground">
          Benchmark — {name}
        </span>
      </div>
      {withScore.length > 0 ? (
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
          {withScore.slice(0, 4).map((a, i) => (
            <li key={i} className="tabular-nums">
              <span className="font-medium text-foreground">
                {formatScore(a.scoreType, a.score)}
              </span>
              {a.rxLevel && (
                <span className="text-muted-foreground/80"> {RX_LABEL[a.rxLevel]}</span>
              )}
              <span className="text-muted-foreground/60">
                {" "}
                · {formatSessionDate(a.date)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">
          First recorded attempt — set the bar.
        </p>
      )}
    </div>
  );
}
