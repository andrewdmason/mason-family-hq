"use client";

import { useState } from "react";
import {
  Ban,
  Check,
  Pause,
  Phone,
  Scissors,
  Sparkles,
  UserPlus,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { askGrandma, type GrandmaGuess } from "@/lib/games/grandma";
import { McView } from "@/components/games/question-views/mc";
import { ListView } from "@/components/games/question-views/list";
import { ClosestView } from "@/components/games/question-views/closest";
import type {
  ClosestPayload,
  DeckQuestion,
  GameMode,
  ListPayload,
  McPayload,
  ResolvedTeam,
} from "@/lib/games/types";

const BASE = 2; // points for a normal correct answer
const STEAL = 1; // points for a successful steal (half, rounded)

type Lifeline = "fifty" | "grandma" | "parent" | "double";
type Phase = "answer" | "steal" | "revealed";

export type RunnerPlayer = { userId: string; name: string; role: string };
export type FinalResult = { scores: Record<string, number>; winner: string };

export function TriviaRunner({
  deck,
  teams,
  players,
  mode,
  targetScore,
  onComplete,
  onToss,
  onAbandon,
}: {
  deck: DeckQuestion[];
  teams: ResolvedTeam[];
  players: RunnerPlayer[];
  mode: GameMode;
  targetScore: number | null;
  onComplete: (result: FinalResult) => void;
  onToss: (questionId: string) => void;
  onAbandon: () => void;
}) {
  const teamKeys = teams.map((t) => t.key);
  const [scores, setScores] = useState<Record<string, number>>(
    Object.fromEntries(teamKeys.map((k) => [k, 0]))
  );
  const [used, setUsed] = useState<Record<string, Lifeline[]>>(
    Object.fromEntries(teamKeys.map((k) => [k, []]))
  );
  const [turn, setTurn] = useState(0);
  const [paused, setPaused] = useState(false);

  // Per-turn ephemeral state.
  const [phase, setPhase] = useState<Phase>("answer");
  const [removed, setRemoved] = useState<number[]>([]);
  const [noPeek, setNoPeek] = useState(false);
  const [doubleDown, setDoubleDown] = useState(false);
  const [grandma, setGrandma] = useState<GrandmaGuess | null>(null);
  const [parentAssist, setParentAssist] = useState(false);
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const [closestGuesses, setClosestGuesses] = useState<Record<string, number> | null>(null);
  const [closestWinner, setClosestWinner] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const q = deck[turn];
  const spotlightPlayer = players.find((p) => p.userId === q.spotlightUserId);
  const spotTeam = teams.find((t) => t.memberUserIds.includes(q.spotlightUserId));
  const spotKey = spotTeam?.key ?? teamKeys[0];
  const otherKey = teamKeys.find((k) => k !== spotKey) ?? teamKeys[0];
  const isKidSpotlight = spotlightPlayer?.role === "kid";
  const multiplier = doubleDown || noPeek ? 2 : 1;

  function isUsed(l: Lifeline) {
    return used[spotKey]?.includes(l) ?? false;
  }
  function markUsed(l: Lifeline) {
    setUsed((u) => ({ ...u, [spotKey]: [...(u[spotKey] ?? []), l] }));
  }

  function resetTurn() {
    setPhase("answer");
    setRemoved([]);
    setNoPeek(false);
    setDoubleDown(false);
    setGrandma(null);
    setParentAssist(false);
    setChosenIndex(null);
    setClosestGuesses(null);
    setClosestWinner(null);
    setOutcome(null);
  }

  function finish(finalScores: Record<string, number>) {
    const max = Math.max(...teamKeys.map((k) => finalScores[k] ?? 0));
    const leaders = teamKeys.filter((k) => (finalScores[k] ?? 0) === max);
    const winner = leaders.length === 1 ? leaders[0] : "tie";
    onComplete({ scores: finalScores, winner });
  }

  function advance(latest: Record<string, number>) {
    const reachedTarget =
      mode === "target" &&
      targetScore != null &&
      teamKeys.some((k) => (latest[k] ?? 0) >= targetScore);
    if (reachedTarget || turn + 1 >= deck.length) {
      finish(latest);
      return;
    }
    setTurn((t) => t + 1);
    resetTurn();
  }

  // ---- Lifelines (spotlight team) ----
  function useFifty() {
    if (q.type !== "mc" || isUsed("fifty")) return;
    const p = q.payload as McPayload;
    const wrong = p.options
      .map((_, i) => i)
      .filter((i) => i !== p.correctIndex);
    // Drop two wrong options.
    setRemoved(wrong.sort(() => Math.random() - 0.5).slice(0, 2));
    markUsed("fifty");
  }
  function useGrandma() {
    if (isUsed("grandma")) return;
    const visible =
      q.type === "mc"
        ? (q.payload as McPayload).options.map((_, i) => i).filter((i) => !removed.includes(i))
        : undefined;
    setGrandma(askGrandma(q, visible));
    markUsed("grandma");
  }
  function useParent() {
    if (isUsed("parent")) return;
    setParentAssist(true);
    markUsed("parent");
  }
  function useDouble() {
    if (isUsed("double")) return;
    setDoubleDown(true);
    setNoPeek(false);
    markUsed("double");
  }

  // ---- Resolution ----
  function resolveSpotlight(correct: boolean, chosen: number | null) {
    setChosenIndex(chosen);
    if (correct) {
      const pts = BASE * multiplier;
      const next = { ...scores, [spotKey]: scores[spotKey] + pts };
      setScores(next);
      setOutcome(`${spotTeam?.name} got it — +${pts}`);
      setPhase("revealed");
    } else if (q.type === "mc") {
      setPhase("steal"); // other team gets a shot
    } else {
      setOutcome("Missed it — no points");
      setPhase("revealed");
    }
  }

  function mcPick(i: number) {
    resolveSpotlight(i === (q.payload as McPayload).correctIndex, i);
  }
  function stealPick(i: number) {
    const correct = i === (q.payload as McPayload).correctIndex;
    setChosenIndex(i);
    if (correct) {
      const next = { ...scores, [otherKey]: scores[otherKey] + STEAL };
      setScores(next);
      setOutcome(`${teams.find((t) => t.key === otherKey)?.name} stole it — +${STEAL}`);
    } else {
      setOutcome("Steal missed — no points");
    }
    setPhase("revealed");
  }
  function noPeekResolve(gotIt: boolean) {
    if (gotIt) resolveSpotlight(true, null);
    else setPhase("steal");
  }
  function listFinish(named: number) {
    const p = q.payload as ListPayload;
    const success = named >= p.target;
    const pts = success ? BASE * (doubleDown ? 2 : 1) : 0;
    const next = success ? { ...scores, [spotKey]: scores[spotKey] + pts } : scores;
    if (success) setScores(next);
    setOutcome(`${named} named — ${success ? `bonus! +${pts}` : "no bonus"}`);
    setPhase("revealed");
  }
  function closestSubmit(guesses: Record<string, number>) {
    const p = q.payload as ClosestPayload;
    const dist = (k: string) => Math.abs((guesses[k] ?? 0) - p.answer);
    // Tie on distance favors the spotlight team.
    const winner = dist(spotKey) <= dist(otherKey) ? spotKey : otherKey;
    const pts = BASE * (doubleDown && winner === spotKey ? 2 : 1);
    const next = { ...scores, [winner]: scores[winner] + pts };
    setScores(next);
    setClosestGuesses(guesses);
    setClosestWinner(winner);
    setOutcome(`${teams.find((t) => t.key === winner)?.name} was closest — +${pts}`);
    setPhase("revealed");
  }

  function tossThis() {
    onToss(q.id);
    setOutcome("Question tossed — no points");
    advance(scores);
  }

  // ---- Render ----
  const lifelineBtn = (
    l: Lifeline,
    label: string,
    Icon: typeof Phone,
    onClick: () => void,
    show: boolean
  ) =>
    show && (
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={isUsed(l) || phase !== "answer"}
        onClick={onClick}
      >
        <Icon className="size-3.5" />
        {label}
      </Button>
    );

  return (
    <div className="relative">
      {/* Scoreboard */}
      <div className="flex items-stretch gap-2">
        {teams.map((t) => (
          <div
            key={t.key}
            className={cn(
              "flex-1 rounded-xl border px-4 py-3 text-center",
              t.key === spotKey ? "border-foreground/40 bg-accent" : "border-border"
            )}
          >
            <div className="truncate text-xs text-muted-foreground">{t.name}</div>
            <div className="font-serif text-2xl text-foreground">{scores[t.key]}</div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Question {turn + 1} of {deck.length}
        </span>
        <button
          type="button"
          onClick={() => setPaused(true)}
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          <Pause className="size-3.5" /> Pause
        </button>
      </div>

      {/* Spotlight + collaboration hint */}
      <div className="mt-4 rounded-lg bg-muted/50 px-4 py-2 text-sm">
        <span className="font-medium text-foreground">{spotlightPlayer?.name}</span>
        {isKidSpotlight ? (
          <span className="text-muted-foreground">
            {" "}
            — your question! Grown-ups, stay quiet{parentAssist ? "… (assist used!)" : " unless you use Parent Assist"}.
          </span>
        ) : (
          <span className="text-muted-foreground"> — kids can help on this one!</span>
        )}
      </div>

      {/* Question */}
      <div className="mt-4 rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {doubleDown && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
              <Zap className="size-3" /> Double down
            </span>
          )}
          {noPeek && (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-900">
              No-peek 2×
            </span>
          )}
        </div>
        <p className="font-serif text-lg leading-snug text-foreground">{q.prompt}</p>

        {grandma && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900">
            📞 Grandma: &ldquo;{grandma.phrase} {grandma.text}!&rdquo;
          </p>
        )}

        <div className="mt-4">
          {q.type === "mc" && (
            <>
              {phase === "answer" && noPeek ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Answering blind for double. Did they get it?
                  </p>
                  <div className="flex gap-2">
                    <Button className="flex-1 gap-1" onClick={() => noPeekResolve(true)}>
                      <Check className="size-4" /> Got it
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 gap-1"
                      onClick={() => noPeekResolve(false)}
                    >
                      <X className="size-4" /> Missed
                    </Button>
                  </div>
                </div>
              ) : (
                <McView
                  payload={q.payload as McPayload}
                  removed={removed}
                  chosenIndex={chosenIndex}
                  revealed={phase === "revealed"}
                  onPick={phase === "steal" ? stealPick : mcPick}
                />
              )}
              {phase === "steal" && (
                <p className="mt-2 text-center text-sm text-amber-800">
                  Steal! {teams.find((t) => t.key === otherKey)?.name}, pick an answer.
                </p>
              )}
            </>
          )}

          {q.type === "list" && (
            <ListView
              payload={q.payload as ListPayload}
              revealed={phase === "revealed"}
              onFinish={listFinish}
            />
          )}

          {q.type === "closest" && (
            <ClosestView
              payload={q.payload as ClosestPayload}
              teams={teams.map((t) => ({ key: t.key, name: t.name }))}
              revealed={phase === "revealed"}
              guesses={closestGuesses}
              winnerKey={closestWinner}
              onSubmit={closestSubmit}
            />
          )}
        </div>
      </div>

      {/* Lifelines + toss (during answering) */}
      {phase === "answer" && (
        <div className="mt-4 flex flex-wrap gap-2">
          {q.type === "mc" &&
            lifelineBtn("fifty", "50/50", Scissors, useFifty, true)}
          {lifelineBtn("grandma", "Phone Grandma", Phone, useGrandma, true)}
          {isKidSpotlight && lifelineBtn("parent", "Parent assist", UserPlus, useParent, true)}
          {lifelineBtn("double", "Double down", Zap, useDouble, true)}
          {q.type === "mc" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={isUsed("double")}
              onClick={() => {
                setNoPeek((v) => !v);
                setDoubleDown(false);
              }}
            >
              <Sparkles className="size-3.5" />
              {noPeek ? "Cancel no-peek" : "No-peek 2×"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={tossThis}
          >
            <Ban className="size-3.5" /> Toss
          </Button>
        </div>
      )}

      {/* Reveal + next */}
      {phase === "revealed" && (
        <div className="mt-4 space-y-3 text-center">
          {outcome && <p className="font-medium text-foreground">{outcome}</p>}
          <Button size="lg" className="w-full" onClick={() => advance(scores)}>
            {turn + 1 >= deck.length ? "See results" : "Next question"}
          </Button>
        </div>
      )}

      {/* Pause overlay */}
      {paused && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-xl bg-background/95 p-8">
          <p className="font-serif text-xl text-foreground">Paused</p>
          <div className="flex gap-2">
            <Button onClick={() => setPaused(false)}>Resume</Button>
            <Button variant="outline" className="gap-1.5" onClick={onAbandon}>
              <Ban className="size-4" /> Abandon game
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
