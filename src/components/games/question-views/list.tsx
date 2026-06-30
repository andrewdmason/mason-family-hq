"use client";

import { useEffect, useState } from "react";
import { Check, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ListPayload } from "@/lib/games/types";

export const LIST_SECONDS = 60;

/**
 * "List it" answer area. The host starts a timer and taps each item as the team
 * names it; on Done or timeout the named count is reported. Reaching `target`
 * earns the points (scoring lives in the runner). When revealed, it's read-only.
 */
export function ListView({
  payload,
  revealed,
  onFinish,
}: {
  payload: ListPayload;
  revealed: boolean;
  onFinish: (namedCount: number) => void;
}) {
  const [started, setStarted] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [timeLeft, setTimeLeft] = useState(LIST_SECONDS);

  useEffect(() => {
    if (!started || revealed) return;
    if (timeLeft <= 0) {
      onFinish(checked.size);
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [started, revealed, timeLeft, checked, onFinish]);

  function toggle(i: number) {
    if (revealed) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Name {payload.target} of {payload.items.length} for the points
        </span>
        {started && !revealed && (
          <span className="inline-flex items-center gap-1 font-mono text-foreground">
            <Timer className="size-4" />
            {timeLeft}s
          </span>
        )}
      </div>

      {!started && !revealed ? (
        <Button onClick={() => setStarted(true)} className="w-full">
          Start the clock
        </Button>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {payload.items.map((item, i) => {
              const got = checked.has(i);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={revealed}
                  onClick={() => toggle(i)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors",
                    got
                      ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                      : revealed
                        ? "opacity-60"
                        : "hover:border-foreground/30 hover:bg-accent"
                  )}
                >
                  {got && <Check className="size-4 shrink-0 text-emerald-600" />}
                  <span>{item}</span>
                </button>
              );
            })}
          </div>
          {!revealed && (
            <Button
              variant="outline"
              onClick={() => onFinish(checked.size)}
              className="mt-3 w-full"
            >
              Done — {checked.size} named
            </Button>
          )}
        </>
      )}
    </div>
  );
}
