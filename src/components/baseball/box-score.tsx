import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { GAME_BATTING, GAME_PITCHING, row as statRow, formatGameDate } from "@/lib/baseball/stats";
import type { GameDetail } from "@/lib/baseball/types";
import { cn } from "@/lib/utils";

export function BoxScore({ kidSlug, detail }: { kidSlug: string; detail: GameDetail }) {
  const { game, rows } = detail;
  const pitchers = rows.filter((r) => r.pitching);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <Link href={`/baseball/${kidSlug}/${game.teamId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> {game.teamName || "Season"}
      </Link>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-serif text-xl tracking-tight text-foreground">
          {game.homeAway === "away" ? "@ " : "vs "}{game.opponentName ?? "Opponent"}
        </h1>
        <span className="flex items-center gap-3 text-sm">
          {game.result && (
            <span className={cn(
              "inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold",
              game.result === "W" && "bg-emerald-500/15 text-emerald-600",
              game.result === "L" && "bg-rose-500/15 text-rose-600",
              game.result === "T" && "bg-muted text-muted-foreground",
            )}>{game.result}</span>
          )}
          {game.teamScore != null && game.opponentScore != null && (
            <span className="tabular-nums text-foreground">{game.teamScore}–{game.opponentScore}</span>
          )}
          <span className="text-xs text-muted-foreground">{formatGameDate(game.playedOn)}</span>
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No box score captured for this game.</p>
      ) : (
        <>
          <section className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-foreground">Batting</h2>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Player</th>
                    {GAME_BATTING.map((c) => (
                      <th key={c.key} className="px-2 py-2 text-right font-medium tabular-nums">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p, idx) => (
                    <tr key={idx} className={cn("border-b border-border/60 last:border-0", p.isFocus && "bg-amber-500/10")}>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className={cn("text-foreground", p.isFocus && "font-semibold")}>{p.name}</span>
                        {p.jersey ? <span className="ml-1 text-xs text-muted-foreground">#{p.jersey}</span> : null}
                      </td>
                      {statRow(p.batting, GAME_BATTING).map((cell, i) => (
                        <td key={i} className="px-2 py-2 text-right tabular-nums text-foreground">{cell.value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {pitchers.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-2 text-sm font-semibold text-foreground">Pitching</h2>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Player</th>
                      {GAME_PITCHING.map((c) => (
                        <th key={c.key} className="px-2 py-2 text-right font-medium tabular-nums">{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pitchers.map((p, idx) => (
                      <tr key={idx} className={cn("border-b border-border/60 last:border-0", p.isFocus && "bg-amber-500/10")}>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className={cn("text-foreground", p.isFocus && "font-semibold")}>{p.name}</span>
                          {p.jersey ? <span className="ml-1 text-xs text-muted-foreground">#{p.jersey}</span> : null}
                        </td>
                        {statRow(p.pitching, GAME_PITCHING).map((cell, i) => (
                          <td key={i} className="px-2 py-2 text-right tabular-nums text-foreground">{cell.value}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
