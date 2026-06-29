"use client";

import { useState } from "react";
import Link from "next/link";
import { CAREER_BATTING, CAREER_PITCHING, row as statRow, num, formatIP } from "@/lib/baseball/stats";
import { formatGameDate } from "@/lib/baseball/stats";
import type { Career, CareerGame, SeasonRow, StatBlob, TeamRecord } from "@/lib/baseball/types";
import { Tabs } from "./tabs";
import { cn } from "@/lib/utils";

type TabKey = "teams" | "games";

function recordText(r: TeamRecord): string {
  return r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
}

// "1-for-3, HR, 2 RBI, BB" — a readable per-game batting line.
function battingLine(b: StatBlob | null): string | null {
  if (!b) return null;
  const ab = num(b, "AB") ?? 0;
  const h = num(b, "H") ?? 0;
  const extras: string[] = [];
  const add = (key: string, label: string) => {
    const v = num(b, key) ?? 0;
    if (v) extras.push(`${v} ${label}`);
  };
  add("HR", "HR");
  add("3B", "3B");
  add("2B", "2B");
  add("RBI", "RBI");
  add("R", "R");
  add("BB", "BB");
  add("SB", "SB");
  // A pure walk/no-AB line still reads sensibly as "0-for-0".
  return `${h}-for-${ab}${extras.length ? `, ${extras.join(", ")}` : ""}`;
}

function pitchingLine(p: StatBlob | null): string | null {
  if (!p) return null;
  const bits = [`${formatIP(num(p, "IP") ?? 0)} IP`];
  const k = num(p, "SO") ?? 0;
  if (k) bits.push(`${k} K`);
  bits.push(`${num(p, "ER") ?? 0} ER`);
  return bits.join(", ");
}

function ResultChip({ result }: { result: CareerGame["result"] }) {
  if (!result) return null;
  return (
    <span
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        result === "W" && "bg-emerald-500/15 text-emerald-600",
        result === "L" && "bg-rose-500/15 text-rose-600",
        result === "T" && "bg-muted text-muted-foreground",
      )}
    >
      {result}
    </span>
  );
}

function TeamsTab({ kidSlug, seasons }: { kidSlug: string; seasons: SeasonRow[] }) {
  if (!seasons.length) {
    return <p className="mt-6 text-sm text-muted-foreground">No teams imported yet.</p>;
  }
  // Group consecutive teams under their season (seasons is already sorted newest-first).
  const groups: { season: string; teams: SeasonRow[] }[] = [];
  for (const s of seasons) {
    const label = s.seasonName ?? "Unknown season";
    const last = groups[groups.length - 1];
    if (last && last.season === label) last.teams.push(s);
    else groups.push({ season: label, teams: [s] });
  }

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
                {group.teams.map((s) => (
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

function GamesTab({ kidSlug, games }: { kidSlug: string; games: CareerGame[] }) {
  if (!games.length) {
    return <p className="mt-6 text-sm text-muted-foreground">No games imported yet.</p>;
  }
  return (
    <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
      {games.map((g) => {
        const batting = battingLine(g.batting);
        const pitching = pitchingLine(g.pitching);
        return (
          <li key={g.gameId}>
            <Link href={`/baseball/${kidSlug}/${g.teamId}/games/${g.gameId}`} className="block px-4 py-3 hover:bg-accent/50">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <ResultChip result={g.result} />
                  <span className="text-sm text-foreground">{g.homeAway === "away" ? "@ " : "vs "}{g.opponentName ?? "Opponent"}</span>
                </span>
                <span className="flex items-center gap-3 text-xs text-muted-foreground">
                  {g.teamScore != null && g.opponentScore != null && (
                    <span className="tabular-nums text-foreground">{g.teamScore}–{g.opponentScore}</span>
                  )}
                  <span>{formatGameDate(g.playedOn)}</span>
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>{g.teamName}</span>
                {batting && <span>· {batting}</span>}
                {pitching && <span>· {pitching}</span>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
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
        <GamesTab kidSlug={kidSlug} games={career.games} />
      )}
    </>
  );
}
