import { cn } from "@/lib/utils";
import type { Overview } from "@/lib/words/session";
import { STATUS_LABEL, type Status } from "@/lib/words/types";

export const STATUS_TONE: Record<Status, string> = {
  mastered: "bg-emerald-500",
  almost: "bg-sky-400",
  learning: "bg-amber-400",
  new: "bg-muted",
  removed: "bg-muted",
};

export function clock(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function paceLine(done: NonNullable<Overview["doneToday"]>): string {
  const spare = done.limitMs - done.elapsedMs;
  return spare >= 0 ? `${clock(spare)} to spare` : `${clock(spare)} over`;
}

/** Mastered, almost and learning as one bar across all the words. */
export function WordsBar({ overview }: { overview: Overview }) {
  const { counts, totalWords } = overview;
  const order: Status[] = ["mastered", "almost", "learning"];
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {order.map((s) => (
          <div key={s} className={STATUS_TONE[s]} style={{ width: `${(counts[s] / Math.max(1, totalWords)) * 100}%` }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {[...order, "new" as Status].map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", STATUS_TONE[s], s === "new" && "border border-border")} />
            {STATUS_LABEL[s]} <span className="tabular-nums text-foreground">{counts[s]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The last two weeks, a dot a day. */
export function DayDots({ overview }: { overview: Overview }) {
  return (
    <div className="flex items-center gap-1" aria-label={`${overview.recentDays.filter((d) => d.done).length} of the last 14 days done`}>
      {overview.recentDays.map((d) => (
        <span
          key={d.day}
          title={d.day}
          className={cn(
            "size-2.5 rounded-full",
            d.done ? "bg-emerald-500" : "bg-muted",
            d.day === overview.today && !d.done && "ring-1 ring-foreground/40"
          )}
        />
      ))}
    </div>
  );
}
