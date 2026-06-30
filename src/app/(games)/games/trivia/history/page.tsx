import Link from "next/link";
import { ChevronLeft, Coins, Trophy } from "lucide-react";
import { loadTriviaHistory } from "@/lib/games/history";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function TriviaHistoryPage() {
  const { games, gamesPlayed, bankReady, bankNeverAsked, topics } = await loadTriviaHistory();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Link
        href="/games/trivia"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Trivia
      </Link>
      <h1 className="mt-2 font-serif text-2xl tracking-tight text-foreground">Game history</h1>

      {/* Recent games */}
      <section className="mt-6">
        <h2 className="font-serif text-lg text-foreground">Recent games</h2>
        {games.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
            No games played yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
            {games.map((g) => (
              <li key={g.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  {g.status === "abandoned" ? (
                    <p className="text-sm text-muted-foreground">Abandoned game</p>
                  ) : (
                    <div className="space-y-0.5">
                      {g.teams.map((t) => (
                        <div key={t.name} className="flex items-center gap-2 text-sm">
                          {t.isWinner && <Trophy className="size-3.5 text-amber-500" />}
                          <span
                            className={cn(
                              "truncate",
                              t.isWinner ? "font-medium text-foreground" : "text-muted-foreground"
                            )}
                          >
                            {t.name}
                          </span>
                          <span className="ml-auto font-mono text-foreground">{t.score}</span>
                        </div>
                      ))}
                      {g.tie && <p className="text-xs text-muted-foreground">Tie</p>}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
                  <span>{fmtDate(g.endedAt)}</span>
                  {g.bucksPaid && (
                    <span className="inline-flex items-center gap-1 text-amber-600">
                      <Coins className="size-3.5" /> Bucks
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Question bank freshness */}
      <section className="mt-8">
        <h2 className="font-serif text-lg text-foreground">Question bank</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {bankReady} ready · {bankNeverAsked} never asked · {gamesPlayed} game
          {gamesPlayed === 1 ? "" : "s"} played
        </p>
        {topics.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
            No questions in the bank yet.{" "}
            <Link href="/games/trivia/generate" className="underline">
              Generate some
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
            {topics.map((t) => (
              <li key={t.topic} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0 truncate text-sm text-foreground">{t.topic}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t.ready} question{t.ready === 1 ? "" : "s"} ·{" "}
                  <span className={cn(t.neverAsked > 0 && "text-emerald-700")}>
                    {t.neverAsked} fresh
                  </span>{" "}
                  · asked {t.totalAsks}×
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
