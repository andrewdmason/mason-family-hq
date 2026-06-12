"use client";

import { humanizeIssueKey } from "@/lib/swing/format";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SwingFocusArea } from "@/lib/swing/types";

/**
 * One focus area as a field card (F3): the CUE — the thing the coach says —
 * leads big and bold, then the tell to watch for. Those two lines are the
 * entire between-reps reference; drills stay behind a disclosure so the
 * glanceable surface stays tight on a phone.
 */
export function FocusCard({ area }: { area: SwingFocusArea }) {
  const [drillsOpen, setDrillsOpen] = useState(false);

  return (
    <article className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {humanizeIssueKey(area.issueKey)}
      </p>
      <p className="mt-1.5 text-xl leading-snug font-bold text-foreground">
        &ldquo;{area.cue}&rdquo;
      </p>
      <p className="mt-2 text-sm leading-snug">
        <span className="font-medium text-muted-foreground">Watch for:</span>{" "}
        {area.tell}
      </p>

      {area.drills.length > 0 && (
        <div className="mt-3 border-t border-border/70 pt-2">
          <button
            type="button"
            onClick={() => setDrillsOpen((open) => !open)}
            aria-expanded={drillsOpen}
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Drills
            <ChevronDown
              className={cn("size-4 transition-transform", drillsOpen && "rotate-180")}
            />
          </button>
          {drillsOpen && (
            <div className="mt-2 space-y-3">
              {area.drills.map((drill) => (
                <div key={drill.name} className="text-sm">
                  <p className="font-medium text-foreground">
                    {drill.name}
                    {drill.equipment && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {drill.equipment}
                      </span>
                    )}
                  </p>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
                    {drill.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
