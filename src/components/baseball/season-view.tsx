import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SEASON_BATTING, SEASON_PITCHING, row as statRow, formatGameDate } from "@/lib/baseball/stats";
import type { RosterStatRow, SeasonDetail } from "@/lib/baseball/types";
import { MoreStatsSheet } from "./more-stats-sheet";
import { cn } from "@/lib/utils";

function record(games: SeasonDetail["games"]): string {
  const w = games.filter((g) => g.result === "W").length;
  const l = games.filter((g) => g.result === "L").length;
  const t = games.filter((g) => g.result === "T").length;
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function focusFirst(a: RosterStatRow, b: RosterStatRow) {
  return Number(b.isFocus) - Number(a.isFocus) || a.name.localeCompare(b.name);
}

export function SeasonView({ kidSlug, detail }: { kidSlug: string; detail: SeasonDetail }) {
  const { team, roster, games } = detail;
  const batters = [...roster].sort(focusFirst);
  const pitchers = roster.filter((r) => r.pitching).sort(focusFirst);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <Link href={`/baseball/${kidSlug}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Career
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">{team.name}</h1>
        <span className="text-sm text-muted-foreground">
          {[team.seasonName, team.level].filter(Boolean).join(" · ")} · {record(games)}
        </span>
      </div>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Batting</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Player</th>
                {SEASON_BATTING.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-right font-medium tabular-nums">{c.label}</th>
                ))}
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {batters.map((p) => (
                <tr key={p.teamPlayerId} className={cn("border-b border-border/60 last:border-0", p.isFocus && "bg-amber-500/10")}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={cn("text-foreground", p.isFocus && "font-semibold")}>{p.name}</span>
                    {p.jersey ? <span className="ml-1 text-xs text-muted-foreground">#{p.jersey}</span> : null}
                  </td>
                  {statRow(p.batting, SEASON_BATTING).map((cell, i) => (
                    <td key={i} className="px-2 py-2 text-right tabular-nums text-foreground">{cell.value}</td>
                  ))}
                  <td className="px-2 py-2 text-right">
                    {p.isFocus && <MoreStatsSheet title={`${p.name} · ${team.name}`} batting={p.batting} pitching={p.pitching} />}
                  </td>
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
                  {SEASON_PITCHING.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-right font-medium tabular-nums">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pitchers.map((p) => (
                  <tr key={p.teamPlayerId} className={cn("border-b border-border/60 last:border-0", p.isFocus && "bg-amber-500/10")}>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={cn("text-foreground", p.isFocus && "font-semibold")}>{p.name}</span>
                      {p.jersey ? <span className="ml-1 text-xs text-muted-foreground">#{p.jersey}</span> : null}
                    </td>
                    {statRow(p.pitching, SEASON_PITCHING).map((cell, i) => (
                      <td key={i} className="px-2 py-2 text-right tabular-nums text-foreground">{cell.value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Games</h2>
        {games.length === 0 ? (
          <p className="text-sm text-muted-foreground">No games imported.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {games.map((g) => (
              <li key={g.gameId}>
                <Link href={`/baseball/${kidSlug}/${team.id}/games/${g.gameId}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent/50">
                  <span className="flex items-center gap-3">
                    {g.result && (
                      <span className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                        g.result === "W" && "bg-emerald-500/15 text-emerald-600",
                        g.result === "L" && "bg-rose-500/15 text-rose-600",
                        g.result === "T" && "bg-muted text-muted-foreground",
                      )}>{g.result}</span>
                    )}
                    <span className="text-sm text-foreground">{g.homeAway === "away" ? "@ " : "vs "}{g.opponentName ?? "Opponent"}</span>
                  </span>
                  <span className="flex items-center gap-3 text-sm text-muted-foreground">
                    {g.teamScore != null && g.opponentScore != null && (
                      <span className="tabular-nums text-foreground">{g.teamScore}–{g.opponentScore}</span>
                    )}
                    <span className="text-xs">{formatGameDate(g.playedOn)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
