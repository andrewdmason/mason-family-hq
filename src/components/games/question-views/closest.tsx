"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ClosestPayload } from "@/lib/games/types";

/**
 * "Closest wins" answer area. Both teams give a number; the host enters each.
 * On submit the runner scores the nearer guess. When revealed, the target and
 * each guess are shown with the winner highlighted.
 */
export function ClosestView({
  payload,
  teams,
  revealed,
  guesses,
  winnerKey,
  onSubmit,
}: {
  payload: ClosestPayload;
  teams: { key: string; name: string }[];
  revealed: boolean;
  guesses: Record<string, number> | null;
  winnerKey: string | null;
  onSubmit: (guesses: Record<string, number>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  function submit() {
    const parsed: Record<string, number> = {};
    for (const t of teams) {
      const n = Number(values[t.key]);
      parsed[t.key] = Number.isFinite(n) ? n : 0;
    }
    onSubmit(parsed);
  }

  if (revealed && guesses) {
    return (
      <div className="space-y-3">
        <p className="text-center text-sm text-muted-foreground">
          Answer:{" "}
          <span className="font-semibold text-foreground">
            {payload.answer}
            {payload.unit ? ` ${payload.unit}` : ""}
          </span>
        </p>
        {teams.map((t) => (
          <div
            key={t.key}
            className={cn(
              "flex items-center justify-between rounded-lg border px-4 py-2",
              t.key === winnerKey
                ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                : "border-border"
            )}
          >
            <span>{t.name}</span>
            <span className="font-mono">{guesses[t.key]}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {teams.map((t) => (
        <div key={t.key} className="space-y-1">
          <Label htmlFor={`guess-${t.key}`}>{t.name}&rsquo;s guess</Label>
          <Input
            id={`guess-${t.key}`}
            type="number"
            inputMode="numeric"
            value={values[t.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [t.key]: e.target.value }))}
            placeholder={payload.unit ?? "number"}
          />
        </div>
      ))}
      <Button onClick={submit} className="w-full">
        Reveal answer
      </Button>
    </div>
  );
}
