import { Award } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getIsOwner } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { getFamilyProgress, getBenchmarkPRs } from "@/lib/workouts/progress";
import { FitnessStatBlock } from "@/components/workouts/fitness-stat-block";
import { WorkoutsHeader } from "@/components/workouts/workouts-header";
import { formatScore, formatSessionDate } from "@/lib/workouts/format";

export const dynamic = "force-dynamic";

const RX_LABEL = { scaled: "Scaled", rx: "Rx", rx_plus: "Rx+" } as const;

export default async function PRsPage() {
  const supabase = await createClient();
  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  const [families, benchmarks, isOwner] = await Promise.all([
    getFamilyProgress(supabase, today),
    getBenchmarkPRs(supabase),
    getIsOwner(supabase),
  ]);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <WorkoutsHeader active="prs" isOwner={isOwner} />

      <section className="mb-8">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Strength by family
        </h2>
        <FitnessStatBlock families={families} today={today} />
      </section>

      {benchmarks.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Award className="size-3.5" />
            Benchmark PRs
          </h2>
          <ul className="flex flex-col gap-2">
            {benchmarks.map((b) => {
              const score = formatScore(b.scoreType, b.best);
              return (
                <li
                  key={b.benchmarkId}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-serif text-base text-foreground">{b.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.attempts} {b.attempts === 1 ? "attempt" : "attempts"} · last{" "}
                      {formatSessionDate(b.lastDate)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-medium tabular-nums text-foreground">
                      {score ?? "—"}
                    </p>
                    {b.bestRxLevel && (
                      <p className="text-xs text-muted-foreground">
                        {RX_LABEL[b.bestRxLevel]}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
