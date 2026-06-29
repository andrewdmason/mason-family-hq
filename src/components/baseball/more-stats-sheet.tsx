"use client";

import { BarChart3 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { GcSeasonStats } from "@/lib/baseball/types";

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isFinite(n)) return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return String(v);
}

function StatGrid({ title, blob }: { title: string; blob: Record<string, unknown> | null | undefined }) {
  if (!blob || !Object.keys(blob).length) return null;
  const entries = Object.entries(blob).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="mt-5">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 border-b border-border/50 py-0.5">
            <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
            <dd className="text-xs tabular-nums text-foreground">{fmt(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Exposes the complete archived GameChanger stat set (R14 / AE5) — everything the
// curated default lines leave out. This is GameChanger's own season summary, which
// excludes scrimmages, so its counts can trail the (complete) computed season line.
export function MoreStatsSheet({ title, gcStats }: { title: string; gcStats: GcSeasonStats }) {
  return (
    <Sheet>
      <SheetTrigger className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
        <BarChart3 className="h-3.5 w-3.5" />
        More stats
      </SheetTrigger>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            GameChanger&apos;s full season stat set (their summary excludes scrimmages, so counts may be lower than the season line).
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-8">
          {!gcStats ? (
            <p className="mt-4 text-sm text-muted-foreground">No GameChanger summary stored for this season.</p>
          ) : (
            <>
              <StatGrid title="Batting" blob={gcStats.offense} />
              <StatGrid title="Pitching &amp; Fielding" blob={gcStats.defense} />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
