"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type {
  BucksAdminLedgerEntry,
  BucksKidSummary,
  BucksLedgerEntry,
} from "@/lib/bucks/types";

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Amount({ amount }: { amount: number }) {
  const positive = amount >= 0;
  return (
    <span
      className={cn(
        "shrink-0 text-sm font-medium tabular-nums",
        positive ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
      )}
    >
      {positive ? "+" : ""}
      {amount.toLocaleString()}
    </span>
  );
}

// ---- Kid's own history ----------------------------------------------------

export function KidHistoryList({ entries }: { entries: BucksLedgerEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }
  return (
    <div className="divide-y divide-border">
      {entries.map((e) => (
        <div key={e.id} className="flex items-center justify-between gap-3 py-1.5">
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{e.label}</p>
            <p className="text-xs text-muted-foreground">{dayLabel(e.createdAt)}</p>
          </div>
          <Amount amount={e.amount} />
        </div>
      ))}
    </div>
  );
}

// ---- Combined history for adults, filterable by kid -----------------------

export function BucksHistoryAdmin({
  kids,
  history,
  initialKid,
}: {
  kids: BucksKidSummary[];
  history: BucksAdminLedgerEntry[];
  initialKid: string | null;
}) {
  const [filter, setFilter] = useState<string>(
    initialKid && kids.some((k) => k.userId === initialKid) ? initialKid : "all"
  );
  const shown = history.filter((h) => filter === "all" || h.kidUserId === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <Pill active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </Pill>
        {kids.map((k) => (
          <Pill key={k.userId} active={filter === k.userId} onClick={() => setFilter(k.userId)}>
            {k.name}
          </Pill>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <div className="divide-y divide-border">
          {shown.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{e.label}</p>
                <p className="text-xs text-muted-foreground">
                  {e.kidName} · {dayLabel(e.createdAt)}
                </p>
              </div>
              <Amount amount={e.amount} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
