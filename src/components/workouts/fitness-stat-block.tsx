import { TrendingUp, TrendingDown, Minus, Dumbbell } from "lucide-react";
import type { FamilyProgress } from "@/lib/workouts/progress";
import { relativeDays } from "@/lib/workouts/format";

/**
 * The "stat sheet": one card per movement family with strength data, showing
 * each lift's best estimated 1RM and whether it's trending up against your own
 * history (the 90-day comparison). Families with no logged strength data are
 * hidden until there's something to show.
 */
export function FitnessStatBlock({
  families,
  today,
}: {
  families: FamilyProgress[];
  today: string;
}) {
  const withStrength = families.filter((f) => f.lifts.length > 0);
  if (withStrength.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
        <Dumbbell className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          Log a few lifts with loads and your strength stats will build here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {withStrength.map((family) => (
        <div
          key={family.family}
          className="rounded-xl border border-border bg-card p-4"
        >
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="font-serif text-base text-foreground">{family.label}</h3>
            {family.lastDate && (
              <span className="text-xs text-muted-foreground">
                {relativeDays(family.lastDate, today)}
              </span>
            )}
          </div>
          <ul className="flex flex-col gap-1.5">
            {family.lifts.slice(0, 5).map((lift) => {
              const delta =
                lift.priorE1rm != null
                  ? Math.round((lift.bestE1rm - lift.priorE1rm) * 10) / 10
                  : null;
              return (
                <li
                  key={lift.movementId}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="truncate text-foreground">{lift.name}</span>
                  <span className="flex items-center gap-1.5 tabular-nums">
                    <span className="font-medium text-foreground">
                      {lift.bestE1rm}
                    </span>
                    {delta != null && delta > 0 ? (
                      <span className="inline-flex items-center text-primary">
                        <TrendingUp className="size-3.5" />
                        {delta}
                      </span>
                    ) : delta != null && delta < 0 ? (
                      <span className="inline-flex items-center text-muted-foreground">
                        <TrendingDown className="size-3.5" />
                        {Math.abs(delta)}
                      </span>
                    ) : delta === 0 ? (
                      <Minus className="size-3.5 text-muted-foreground" />
                    ) : (
                      <span className="text-[10px] uppercase text-muted-foreground/70">
                        new
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 border-t border-border/40 pt-2 text-xs text-muted-foreground">
            {family.totalReps.toLocaleString()} reps
            {family.totalVolumeLoad > 0 && (
              <> · {family.totalVolumeLoad.toLocaleString()} lb volume</>
            )}
          </p>
        </div>
      ))}
    </div>
  );
}
