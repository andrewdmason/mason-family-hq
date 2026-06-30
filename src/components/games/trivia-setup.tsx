"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { GameMode, TeamInput } from "@/lib/games/types";
import type { TriviaSetupData } from "@/app/(games)/games/trivia/actions";

type Slot = "team1" | "team2" | "out";

const MODES: { value: GameMode; label: string; blurb: string }[] = [
  { value: "quick", label: "Quick", blurb: "~8 questions" },
  { value: "standard", label: "Standard", blurb: "~20 questions" },
  { value: "target", label: "To a score", blurb: "first to the target" },
];

export type StartInput = {
  teams: TeamInput[];
  mode: GameMode;
  targetScore: number | null;
  topicScope: string[] | null;
};

export function TriviaSetup({
  data,
  starting,
  shortfallMessage,
  onStart,
}: {
  data: TriviaSetupData;
  starting: boolean;
  shortfallMessage: string | null;
  onStart: (input: StartInput) => void;
}) {
  // Default pairing: adult + kid per team (Andrew+Oscar vs Jenny+Sebastian).
  const initial = useMemo(() => {
    const adults = data.players.filter((p) => p.role !== "kid");
    const kids = data.players.filter((p) => p.role === "kid");
    const slot: Record<string, Slot> = {};
    for (const p of data.players) slot[p.userId] = "out";
    if (adults[0]) slot[adults[0].userId] = "team1";
    if (kids[0]) slot[kids[0].userId] = "team1";
    if (adults[1]) slot[adults[1].userId] = "team2";
    if (kids[1]) slot[kids[1].userId] = "team2";
    return slot;
  }, [data.players]);

  const [slots, setSlots] = useState<Record<string, Slot>>(initial);
  const [mode, setMode] = useState<GameMode>("standard");
  const [target, setTarget] = useState(20);
  const [topics, setTopics] = useState<Set<string>>(new Set());

  function nameFor(userId: string) {
    return data.players.find((p) => p.userId === userId)?.name ?? "Player";
  }

  function buildTeams(): TeamInput[] {
    const t1 = data.players.filter((p) => slots[p.userId] === "team1").map((p) => p.userId);
    const t2 = data.players.filter((p) => slots[p.userId] === "team2").map((p) => p.userId);
    const teamName = (ids: string[]) => ids.map(nameFor).join(" & ");
    return [
      { key: "team1", name: teamName(t1) || "Team 1", memberUserIds: t1 },
      { key: "team2", name: teamName(t2) || "Team 2", memberUserIds: t2 },
    ];
  }

  const teams = buildTeams();
  const ready = teams.every((t) => t.memberUserIds.length > 0);

  function start() {
    onStart({
      teams,
      mode,
      targetScore: mode === "target" ? target : null,
      topicScope: topics.size > 0 ? [...topics] : null,
    });
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-serif text-lg text-foreground">Teams</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pair a grown-up with a kid — each kid gets questions at their level.
        </p>
        <ul className="mt-3 space-y-2">
          {data.players.map((p) => (
            <li
              key={p.userId}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2.5"
            >
              <span className="font-medium text-foreground">{p.name}</span>
              <div className="flex gap-1">
                {(["team1", "team2", "out"] as Slot[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSlots((prev) => ({ ...prev, [p.userId]: s }))}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs transition-colors",
                      slots[p.userId] === s
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {s === "team1" ? "Team 1" : s === "team2" ? "Team 2" : "Sit out"}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-serif text-lg text-foreground">Length</h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={cn(
                "rounded-xl border px-3 py-3 text-center transition-colors",
                mode === m.value
                  ? "border-foreground/40 bg-accent"
                  : "border-border hover:bg-accent/50"
              )}
            >
              <div className="font-serif text-base text-foreground">{m.label}</div>
              <div className="text-xs text-muted-foreground">{m.blurb}</div>
            </button>
          ))}
        </div>
        {mode === "target" && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">First to</span>
            <Input
              type="number"
              min={2}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">points</span>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg text-foreground">Topics</h2>
          <Link
            href="/games/trivia/generate"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Settings2 className="size-3.5" />
            Manage bank
          </Link>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Leave all unchecked for a mixed game, or pick a few for a themed one.
        </p>
        {data.topics.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No questions in the bank yet.{" "}
            <Link href="/games/trivia/generate" className="underline">
              Generate some first
            </Link>
            .
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.topics.map((t) => {
              const on = topics.has(t.topic);
              return (
                <button
                  key={t.topic}
                  type="button"
                  onClick={() =>
                    setTopics((prev) => {
                      const next = new Set(prev);
                      if (next.has(t.topic)) next.delete(t.topic);
                      else next.add(t.topic);
                      return next;
                    })
                  }
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    on
                      ? "border-foreground/40 bg-foreground text-background"
                      : "border-border text-muted-foreground hover:bg-accent"
                  )}
                >
                  {t.topic}{" "}
                  <span className={cn("text-xs", on ? "text-background/70" : "text-muted-foreground/70")}>
                    {t.ready}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {shortfallMessage && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {shortfallMessage}
        </p>
      )}

      <Button onClick={start} disabled={!ready || starting} className="w-full gap-2" size="lg">
        {starting && <Loader2 className="size-4 animate-spin" />}
        Start game
      </Button>
    </div>
  );
}
