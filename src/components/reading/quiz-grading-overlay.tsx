"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

/** Playful lines that cycle while the tutor "reads" the essay, so the wait feels alive. */
const MESSAGES = [
  "Reading it closely…",
  "Weighing your point of view…",
  "Looking for your examples…",
  "Thinking it over…",
  "Almost there…",
];

/**
 * A full-screen blocking overlay shown while an essay is being graded (the few seconds
 * the AI call takes). Captures all clicks, cycles a few encouraging lines, and runs a
 * light animation so the reader knows the tutor is working — not that it's frozen.
 */
export function EssayGradingOverlay() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % MESSAGES.length), 1600);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label="Grading your essay"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-border bg-card px-8 py-10 text-center shadow-xl">
        <div className="relative flex size-16 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20" />
          <span className="flex size-16 items-center justify-center rounded-full bg-emerald-600/10">
            <Sparkles className="size-7 animate-pulse text-emerald-700 dark:text-emerald-400" />
          </span>
        </div>
        <div>
          <p className="font-serif text-2xl tracking-tight text-foreground">
            Grading…
          </p>
          <p className="mt-1 min-h-5 text-sm text-muted-foreground">
            {MESSAGES[i]}
          </p>
        </div>
        <div className="flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((d) => (
            <span
              key={d}
              className="size-2 animate-bounce rounded-full bg-foreground/40"
              style={{ animationDelay: `${d * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
