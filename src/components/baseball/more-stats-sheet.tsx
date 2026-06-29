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
import type { StatBlob } from "@/lib/baseball/types";

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (Number.isFinite(n)) return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return String(v);
}

function StatGrid({ title, blob }: { title: string; blob: StatBlob | null }) {
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

// Exposes the complete archived GameChanger stat set (R14 / AE5) — everything
// the curated default lines leave out.
export function MoreStatsSheet({
  title,
  batting,
  pitching,
}: {
  title: string;
  batting: StatBlob | null;
  pitching: StatBlob | null;
}) {
  return (
    <Sheet>
      <SheetTrigger className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
        <BarChart3 className="h-3.5 w-3.5" />
        More stats
      </SheetTrigger>
      <SheetContent className="overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>Every stat GameChanger tracks for this season.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-8">
          <StatGrid title="Batting" blob={batting} />
          <StatGrid title="Pitching & Fielding" blob={pitching} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
