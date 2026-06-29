"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CAREER_BATTING,
  CAREER_PITCHING,
  row as statRow,
  formatGameDate,
  formatIP,
  rate3,
  num,
  aggregateBatting,
  aggregatePitching,
} from "@/lib/baseball/stats";
import type { Career, CareerGame, SeasonRow, StatBlob, TeamRecord } from "@/lib/baseball/types";
import { Tabs } from "./tabs";
import { cn } from "@/lib/utils";

type TabKey = "teams" | "games";

function recordText(r: TeamRecord): string {
  return r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
}

// Per-game derived lines: reuse the season aggregators on a single game.
const offensive = (b: StatBlob | null) => (b ? `${num(b, "H") ?? 0}/${num(b, "AB") ?? 0}` : "—");
const gameOps = (b: StatBlob | null) => (b ? rate3(aggregateBatting([b]).OPS) : "—");
const gameIp = (p: StatBlob | null) => (p ? formatIP(num(p, "IP") ?? 0) : "—");
const gameEra = (p: StatBlob | null) => {
  const agg = p ? aggregatePitching([p]) : null;
  return agg ? Number(agg.ERA).toFixed(2) : "—";
};

// Build season groups in newest-first order (using the already-sorted seasons),
// keeping the items (already date-desc for games) within each.
function groupBySeason<T extends { teamId: string }>(seasons: SeasonRow[], items: T[]): { season: string; items: T[] }[] {
  const seasonOfTeam = new Map(seasons.map((s) => [s.teamId, s.seasonName ?? "Unknown season"]));
  const order: string[] = [];
  const seen = new Set<string>();
  for (const s of seasons) {
    const label = s.seasonName ?? "Unknown season";
    if (!seen.has(label)) { seen.add(label); order.push(label); }
  }
  const bySeason = new Map<string, T[]>();
  for (const it of items) {
    const label = seasonOfTeam.get(it.teamId) ?? "Unknown season";
    (bySeason.get(label) ?? bySeason.set(label, []).get(label)!).push(it);
  }
  return order.filter((s) => bySeason.has(s)).map((season) => ({ season, items: bySeason.get(season)! }));
}

function TeamsTab({ kidSlug, seasons }: { kidSlug: string; seasons: SeasonRow[] }) {
  if (!seasons.length) {
    return <p className="mt-6 text-sm text-muted-foreground">No teams imported yet.</p>;
  }
  const groups = groupBySeason(seasons, seasons);

  return (
    <div className="mt-4 space-y-6">
      {groups.map((group) => (
        <section key={group.season}>
          <h2 className="mb-2 text-sm font-semibold text-foreground">{group.season}</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Team</th>
                  <th className="px-2 py-2 text-right font-medium">W-L</th>
                  {CAREER_BATTING.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-right font-medium tabular-nums">{c.label}</th>
                  ))}
                  {CAREER_PITCHING.map((c, i) => (
                    <th key={c.key} className={cn("px-2 py-2 text-right font-medium tabular-nums", i === 0 && "border-l border-border")}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {group.items.map((s) => (
                  <tr key={s.teamId} className="border-b border-border/60 last:border-0 hover:bg-accent/50">
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link href={`/baseball/${kidSlug}/${s.teamId}`} className="font-medium text-foreground hover:underline">
                        {s.teamName}
                      </Link>
                      {s.level ? <span className="ml-1 text-xs text-muted-foreground">{s.level}</span> : null}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{recordText(s.record)}</td>
                    {statRow(s.batting, CAREER_BATTING).map((cell, i) => (
                      <td key={i} className="px-2 py-2 text-right tabular-nums text-foreground">{cell.value}</td>
                    ))}
                    {statRow(s.pitching, CAREER_PITCHING).map((cell, i) => (
                      <td key={i} className={cn("px-2 py-2 text-right tabular-nums text-foreground", i === 0 && "border-l border-border")}>{cell.value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function GamesTab({ kidSlug, seasons, games }: { kidSlug: string; seasons: SeasonRow[]; games: CareerGame[] }) {
  if (!games.length) {
    return <p className="mt-6 text-sm text-muted-foreground">No games imported yet.</p>;
  }
  const groups = groupBySeason(seasons, games);

  return (
    <div className="mt-4 space-y-6">
      {groups.map((group) => (
        <section key={group.season}>
          <h2 className="mb-2 text-sm font-semibold text-foreground">{group.season}</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Team</th>
                  <th className="px-3 py-2 text-left font-medium">Opponent</th>
                  <th className="px-2 py-2 text-right font-medium">Score</th>
                  <th className="px-2 py-2 text-right font-medium">Off (H/AB)</th>
                  <th className="px-2 py-2 text-right font-medium tabular-nums">OPS</th>
                  <th className="px-2 py-2 text-right font-medium tabular-nums">IP</th>
                  <th className="px-2 py-2 text-right font-medium tabular-nums">ERA</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((g) => (
                  <tr key={g.gameId} className="border-b border-border/60 last:border-0 hover:bg-accent/50">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{formatGameDate(g.playedOn)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{g.teamName}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link href={`/baseball/${kidSlug}/${g.teamId}/games/${g.gameId}`} className="text-foreground hover:underline">
                        {g.homeAway === "away" ? "@ " : "vs "}{g.opponentName ?? "Opponent"}
                      </Link>
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-2 py-2 text-right tabular-nums font-medium",
                        g.result === "W" && "text-emerald-600",
                        g.result === "L" && "text-rose-600",
                        (!g.result || g.result === "T") && "text-muted-foreground",
                      )}
                    >
                      {g.teamScore != null && g.opponentScore != null ? `${g.teamScore}–${g.opponentScore}` : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-foreground">{offensive(g.batting)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-foreground">{gameOps(g.batting)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-foreground">{gameIp(g.pitching)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-foreground">{gameEra(g.pitching)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

export function CareerView({ kidSlug, career }: { kidSlug: string; career: Career }) {
  const [tab, setTab] = useState<TabKey>("teams");
  return (
    <>
      <Tabs<TabKey>
        tabs={[
          { key: "teams", label: "Teams" },
          { key: "games", label: "Games" },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === "teams" ? (
        <TeamsTab kidSlug={kidSlug} seasons={career.seasons} />
      ) : (
        <GamesTab kidSlug={kidSlug} seasons={career.seasons} games={career.games} />
      )}
    </>
  );
}
