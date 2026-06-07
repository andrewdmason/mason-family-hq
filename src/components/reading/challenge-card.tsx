import Link from "next/link";
import { Ticket, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChallengeDescription } from "@/components/reading/challenge-description";
import type { ChallengeWeek, ReadingChallengeProgress } from "@/lib/types";

function fmtDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

/** One Mon–Sun cell in the weekly grid, shaded by how the week went. */
function WeekCell({ week, baseline }: { week: ChallengeWeek; baseline: number }) {
  const tip = week.isFuture
    ? `Week ${week.index}: upcoming`
    : `Week ${week.index}: ${week.pages} page${week.pages === 1 ? "" : "s"}` +
      (baseline > 0 ? ` (goal ${baseline})` : "");
  return (
    <div
      title={tip}
      className={cn(
        "flex h-11 flex-col items-center justify-center rounded-md border text-[11px] tabular-nums transition-colors",
        week.isFuture && "border-dashed border-border bg-transparent text-muted-foreground/50",
        !week.isFuture &&
          week.beatBaseline &&
          "border-emerald-600/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        !week.isFuture &&
          !week.beatBaseline &&
          "border-border bg-muted/40 text-muted-foreground",
        week.isCurrent && "ring-2 ring-amber-500/60",
      )}
    >
      <span className="font-medium">{week.isFuture ? "·" : week.pages}</span>
      <span className="text-[9px] uppercase tracking-wide opacity-60">
        W{week.index}
      </span>
    </div>
  );
}

/**
 * The kid-facing challenge display: a goal progress bar, batting-cage token count,
 * a per-week grid vs. their weekly baseline, and (in full mode) the markdown
 * write-up. Compact mode (on the reading home) links to the full page.
 */
export function ChallengeCard({
  progress,
  href,
  showDescription = false,
}: {
  progress: ReadingChallengeProgress;
  /** When set, the header links to the full challenge page (compact mode). */
  href?: string;
  showDescription?: boolean;
}) {
  const { challenge, totalPages, percent, tokens, weeklyBaseline, weeks, daysRemaining } =
    progress;
  const ended = challenge.status === "archived" || daysRemaining === 0;

  const title = href ? (
    <Link href={href} className="hover:underline underline-offset-4">
      {challenge.title}
    </Link>
  ) : (
    challenge.title
  );

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-serif text-xl tracking-tight text-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">
          {fmtDate(challenge.start_date)} – {fmtDate(challenge.end_date)}
          {challenge.status === "archived"
            ? " · archived"
            : ended
              ? " · wrapped up"
              : ` · ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left`}
        </span>
      </div>

      {/* Goal progress */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-serif text-2xl text-foreground tabular-nums">
            {totalPages.toLocaleString()}
            <span className="text-base text-muted-foreground">
              {" "}
              / {challenge.page_goal.toLocaleString()} pages
            </span>
          </span>
          <span className="text-sm text-muted-foreground tabular-nums">{percent}%</span>
        </div>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Tokens */}
      {challenge.pages_per_token > 0 && (
        <div className="mt-3 flex items-center gap-2 text-sm text-foreground">
          <Ticket className="h-4 w-4 text-amber-500" />
          <span className="tabular-nums font-medium">{tokens}</span>
          <span className="text-muted-foreground">
            batting-cage token{tokens === 1 ? "" : "s"} earned
            <span className="text-muted-foreground/70">
              {" "}
              · 1 per {challenge.pages_per_token} pages
            </span>
          </span>
        </div>
      )}

      {/* Weekly breakdown */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Week by week
          </h3>
          {weeklyBaseline > 0 && (
            <span className="text-[11px] text-muted-foreground">
              green = beat {weeklyBaseline}/wk
            </span>
          )}
        </div>
        <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-11">
          {weeks.map((w) => (
            <WeekCell key={w.weekStart} week={w} baseline={weeklyBaseline} />
          ))}
        </div>
      </div>

      {showDescription && challenge.description.trim() && (
        <div className="mt-6 border-t border-border pt-5">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Trophy className="h-3.5 w-3.5" />
            Prizes &amp; rules
          </div>
          <ChallengeDescription markdown={challenge.description} />
        </div>
      )}
    </section>
  );
}
