"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Coins, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TriviaSetup, type StartInput } from "@/components/games/trivia-setup";
import { TriviaRunner, type FinalResult } from "@/components/games/trivia-runner";
import {
  startGame,
  endGame,
  tossQuestion,
  abandonGame,
} from "@/app/(games)/games/trivia/actions";
import type { TriviaAward, TriviaSetupData } from "@/app/(games)/games/trivia/actions";
import type {
  DeckQuestion,
  GameMode,
  ResolvedTeam,
  TriviaLevel,
} from "@/lib/games/types";

const BAND_LABEL: Record<TriviaLevel, string> = {
  younger_kid: "the younger kid",
  older_kid: "the older kid",
  adult: "the grown-ups",
  all: "everyone",
};

type Phase = "setup" | "playing" | "results";

export function TriviaGame({ data }: { data: TriviaSetupData }) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [pending, startTransition] = useTransition();
  const [shortfall, setShortfall] = useState<string | null>(null);

  const [gameId, setGameId] = useState<string | null>(null);
  const [deck, setDeck] = useState<DeckQuestion[]>([]);
  const [teams, setTeams] = useState<ResolvedTeam[]>([]);
  const [mode, setMode] = useState<GameMode>("standard");
  const [targetScore, setTargetScore] = useState<number | null>(null);
  const [result, setResult] = useState<FinalResult | null>(null);
  const [awards, setAwards] = useState<TriviaAward[]>([]);

  function nameOf(userId: string | null) {
    if (!userId) return null;
    return data.players.find((p) => p.userId === userId)?.name ?? null;
  }

  function onStart(input: StartInput) {
    setShortfall(null);
    startTransition(async () => {
      try {
        const res = await startGame(input);
        if (!res.ok) {
          const msgs = res.shortfall.map((s) => {
            const player = data.players.find((p) => p.band === s.band);
            const who = player?.name ?? BAND_LABEL[s.band];
            return `${who} (need ${s.needed}, have ${s.available})`;
          });
          setShortfall(
            `Not enough questions for: ${msgs.join("; ")}. Generate more in the bank.`
          );
          return;
        }
        setGameId(res.gameId);
        setDeck(res.deck);
        setTeams(res.teams);
        setMode(input.mode);
        setTargetScore(input.targetScore);
        setPhase("playing");
      } catch (e) {
        setShortfall(e instanceof Error ? e.message : "Couldn't start the game.");
      }
    });
  }

  function onComplete(final: FinalResult) {
    setResult(final);
    setPhase("results");
    if (!gameId) return;
    startTransition(async () => {
      try {
        const res = await endGame({
          gameId,
          scores: final.scores,
          winner: final.winner,
        });
        setAwards(res.awards);
      } catch {
        setAwards([]);
      }
    });
  }

  function resetToSetup() {
    setPhase("setup");
    setGameId(null);
    setDeck([]);
    setTeams([]);
    setResult(null);
    setAwards([]);
  }

  function onAbandon() {
    if (gameId) abandonGame(gameId).catch(() => {});
    resetToSetup();
  }

  if (phase === "setup") {
    return (
      <TriviaSetup
        data={data}
        starting={pending}
        shortfallMessage={shortfall}
        onStart={onStart}
      />
    );
  }

  if (phase === "playing") {
    return (
      <TriviaRunner
        deck={deck}
        teams={teams}
        players={data.players.map((p) => ({
          userId: p.userId,
          name: p.name,
          role: p.role,
        }))}
        mode={mode}
        targetScore={targetScore}
        onComplete={onComplete}
        onToss={(qid) => {
          if (gameId) tossQuestion(gameId, qid).catch(() => {});
        }}
        onAbandon={onAbandon}
      />
    );
  }

  // results
  const isTie = !result || result.winner === "tie";
  const winningTeam = teams.find((t) => t.key === result?.winner) ?? null;

  // Bucks lines reflect what the ledger actually credited (from endGame), so the
  // celebration can never drift from the payout RPC.
  const bucksLines = awards
    .map((a) => ({ name: nameOf(a.userId), amount: a.amount }))
    .filter((a) => a.name)
    .sort((a, b) => b.amount - a.amount)
    .map((a) => `${a.name} earned ${a.amount}`);

  return (
    <div className="mx-auto max-w-md space-y-6 text-center">
      <Trophy className="mx-auto size-12 text-amber-500" />
      <div>
        <h2 className="font-serif text-2xl text-foreground">
          {isTie ? "It's a tie!" : `${winningTeam?.name} wins!`}
        </h2>
        <div className="mt-3 space-y-1">
          {teams.map((t) => (
            <div key={t.key} className="flex justify-between rounded-lg bg-muted/50 px-4 py-2">
              <span className="text-foreground">{t.name}</span>
              <span className="font-mono text-foreground">{result?.scores[t.key] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        {pending ? (
          <p className="text-sm text-muted-foreground">Tallying Mason Bucks…</p>
        ) : bucksLines.length > 0 ? (
          <div className="flex flex-col items-center gap-1">
            <Coins className="size-5 text-amber-500" />
            {bucksLines.map((l) => (
              <p key={l} className="text-sm text-foreground">
                {l} Mason Bucks 🎉
              </p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Played for fun — no Bucks this time (already earned today).
          </p>
        )}
      </div>

      <div className="flex justify-center gap-2">
        <Button onClick={resetToSetup}>Play again</Button>
        <Button variant="outline" render={<Link href="/games" />}>
          Back to Games
        </Button>
      </div>
    </div>
  );
}
