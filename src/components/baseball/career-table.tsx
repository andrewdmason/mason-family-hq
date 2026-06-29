"use client";

import Link from "next/link";
import { SEASON_BATTING, SEASON_PITCHING, row as statRow, num } from "@/lib/baseball/stats";
import type { SeasonRow } from "@/lib/baseball/types";
import { CareerTrendChart, type TrendPoint } from "./career-trend-chart";
import { MoreStatsSheet } from "./more-stats-sheet";

function seasonLabel(s: SeasonRow): string {
  return s.seasonName ?? (s.seasonYear ? String(s.seasonYear) : s.teamName);
}

export function CareerTable({ kidSlug, seasons }: { kidSlug: string; seasons: SeasonRow[] }) {
  if (!seasons.length) {
    return (
      <p className="mt-8 rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
        No seasons imported for this player yet.
      </p>
    );
  }

  const points: TrendPoint[] = [...seasons]
    .reverse()
    .map((s) => ({ label: seasonLabel(s), AVG: num(s.batting, "AVG"), OPS: num(s.batting, "OPS") }));
  const pitchingSeasons = seasons.filter((s) => s.pitching);

  return (
    <div className="mt-6 space-y-8">
      <CareerTrendChart points={points} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">Batting</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Season</th>
                <th className="px-3 py-2 text-left font-medium">Team</th>
                {SEASON_BATTING.map((c) => (
                  <th key={c.key} className="px-2 py-2 text-right font-medium tabular-nums">{c.label}</th>
                ))}
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {seasons.map((s) => (
                <tr key={s.teamId} className="border-b border-border/60 last:border-0 hover:bg-accent/50">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{seasonLabel(s)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Link href={`/baseball/${kidSlug}/${s.teamId}`} className="font-medium text-foreground hover:underline">
                      {s.teamName}
                    </Link>
                    {s.level ? <span className="ml-1 text-xs text-muted-foreground">{s.level}</span> : null}
                  </td>
                  {statRow(s.batting, SEASON_BATTING).map((cell, i) => (
                    <td key={i} className="px-2 py-2 text-right tabular-nums text-foreground">{cell.value}</td>
                  ))}
                  <td className="px-2 py-2 text-right">
                    <MoreStatsSheet title={`${seasonLabel(s)} · ${s.teamName}`} gcStats={s.gcStats} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {pitchingSeasons.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-foreground">Pitching</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Season</th>
                  <th className="px-3 py-2 text-left font-medium">Team</th>
                  {SEASON_PITCHING.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-right font-medium tabular-nums">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pitchingSeasons.map((s) => (
                  <tr key={s.teamId} className="border-b border-border/60 last:border-0 hover:bg-accent/50">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{seasonLabel(s)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link href={`/baseball/${kidSlug}/${s.teamId}`} className="font-medium text-foreground hover:underline">
                        {s.teamName}
                      </Link>
                    </td>
                    {statRow(s.pitching, SEASON_PITCHING).map((cell, i) => (
                      <td key={i} className="px-2 py-2 text-right tabular-nums text-foreground">{cell.value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
