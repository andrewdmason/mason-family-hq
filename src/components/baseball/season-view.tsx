"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { SEASON_BATTING, SEASON_PITCHING, row as statRow, num, formatGameDate, type StatCol } from "@/lib/baseball/stats";
import type { RosterStatRow, SeasonDetail } from "@/lib/baseball/types";
import { MoreStatsSheet } from "./more-stats-sheet";
import { Tabs } from "./tabs";
import { cn } from "@/lib/utils";

function record(games: SeasonDetail["games"]): string {
  const w = games.filter((g) => g.result === "W").length;
  const l = games.filter((g) => g.result === "L").length;
  const t = games.filter((g) => g.result === "T").length;
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

const NAME_KEY = "__name__";

function SortArrow({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return null;
  return dir === "asc" ? <ChevronUp className="inline h-3 w-3" /> : <ChevronDown className="inline h-3 w-3" />;
}

// Sortable roster stat table. Click a header to sort by it; click again to flip
// direction. Default is alphabetical by player (the focus player is highlighted
// but not pinned). Numeric columns sort high-to-low first.
function RosterTable({
  cols,
  rows,
  blob,
  showMore,
  teamName,
  defaultSortKey = NAME_KEY,
  defaultDir = "asc",
}: {
  cols: StatCol[];
  rows: RosterStatRow[];
  blob: "batting" | "pitching";
  showMore: boolean;
  teamName: string;
  defaultSortKey?: string;
  defaultDir?: "asc" | "desc";
}) {
  const [sortKey, setSortKey] = useState<string>(defaultSortKey);
  const [dir, setDir] = useState<"asc" | "desc">(defaultDir);

  const sorted = [...rows].sort((a, b) => {
    const cmp =
      sortKey === NAME_KEY
        ? a.name.localeCompare(b.name)
        : (num(a[blob], sortKey) ?? -Infinity) - (num(b[blob], sortKey) ?? -Infinity);
    return dir === "asc" ? cmp : -cmp;
  });

  const onHeader = (key: string, numeric: boolean) => {
    if (sortKey === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir(numeric ? "desc" : "asc"); // stats read best high-to-low
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
            <th
              onClick={() => onHeader(NAME_KEY, false)}
              aria-sort={sortKey === NAME_KEY ? (dir === "asc" ? "ascending" : "descending") : "none"}
              className="cursor-pointer select-none px-3 py-2 text-left font-medium hover:text-foreground"
            >
              Player <SortArrow active={sortKey === NAME_KEY} dir={dir} />
            </th>
            {cols.map((c) => (
              <th
                key={c.key}
                onClick={() => onHeader(c.key, true)}
                aria-sort={sortKey === c.key ? (dir === "asc" ? "ascending" : "descending") : "none"}
                className="cursor-pointer select-none px-2 py-2 text-right font-medium tabular-nums hover:text-foreground"
              >
                {c.label} <SortArrow active={sortKey === c.key} dir={dir} />
              </th>
            ))}
            {showMore && <th className="px-2 py-2" />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.teamPlayerId} className={cn("border-b border-border/60 last:border-0", p.isFocus && "bg-amber-500/10")}>
              <td className="whitespace-nowrap px-3 py-2">
                <span className={cn("text-foreground", p.isFocus && "font-semibold")}>{p.name}</span>
                {p.jersey ? <span className="ml-1 text-xs text-muted-foreground">#{p.jersey}</span> : null}
              </td>
              {statRow(p[blob], cols).map((cell, i) => (
                <td key={i} className="px-2 py-2 text-right tabular-nums text-foreground">{cell.value}</td>
              ))}
              {showMore && (
                <td className="px-2 py-2 text-right">
                  {p.isFocus && <MoreStatsSheet title={`${p.name} · ${teamName}`} gcStats={p.gcStats} />}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type TabKey = "batting" | "pitching" | "games";

export function SeasonView({ kidSlug, detail }: { kidSlug: string; detail: SeasonDetail }) {
  const { team, roster, games } = detail;
  const pitchers = roster.filter((r) => r.pitching);

  const tabs: { key: TabKey; label: string }[] = [
    { key: "batting", label: "Batting" },
    ...(pitchers.length > 0 ? [{ key: "pitching" as const, label: "Pitching" }] : []),
    { key: "games", label: "Games" },
  ];
  const [tab, setTab] = useState<TabKey>("batting");

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <Link href={`/baseball/${kidSlug}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Career
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">{team.name}</h1>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{[team.seasonName, team.level].filter(Boolean).join(" · ")} · {record(games)}</span>
          {team.gcPublicId && (
            <a
              href={`https://web.gc.com/teams/${team.gcPublicId}/x/season-stats`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 whitespace-nowrap text-xs transition-colors hover:text-foreground"
            >
              GameChanger <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      <div className="mt-5">
        <Tabs<TabKey> tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div className="mt-4">
        {tab === "batting" && (
          <RosterTable cols={SEASON_BATTING} rows={roster} blob="batting" showMore teamName={team.name} defaultSortKey="AVG" defaultDir="desc" />
        )}

        {tab === "pitching" && pitchers.length > 0 && (
          <RosterTable cols={SEASON_PITCHING} rows={pitchers} blob="pitching" showMore={false} teamName={team.name} defaultSortKey="ERA" defaultDir="asc" />
        )}

        {tab === "games" &&
          (games.length === 0 ? (
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
          ))}
      </div>
    </main>
  );
}
