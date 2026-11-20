"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { ListRow } from "@/lib/words/session";
import { STATUS_LABEL, type Status } from "@/lib/words/types";

const DOT: Record<Status, string> = {
  mastered: "bg-emerald-500",
  almost: "bg-sky-400",
  learning: "bg-amber-400",
  new: "border border-border bg-transparent",
};

type Filter = "all" | "trouble" | Status;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "trouble", label: "Trouble" },
  { key: "learning", label: "Learning" },
  { key: "almost", label: "Almost" },
  { key: "mastered", label: "Mastered" },
  { key: "new", label: "New" },
];

/** Every word and word part with where they stand; tap one to see it laid out. */
export function WordList({ words, parts }: { words: ListRow[]; parts: ListRow[] }) {
  const [tab, setTab] = useState<"words" | "parts">("words");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const rows = tab === "words" ? words : parts;
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, trouble: 0, new: 0, learning: 0, almost: 0, mastered: 0 };
    for (const r of rows) {
      c[r.status]++;
      if (r.trouble) c.trouble++;
    }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (filter === "all" || (filter === "trouble" ? r.trouble : r.status === filter)) &&
        (!q || r.title.toLowerCase().includes(q) || r.meaning.toLowerCase().includes(q))
    );
    // Trouble first when looking at everything, the most missed on top; then the order they're met in.
    return list.sort((a, b) =>
      filter === "trouble" || filter === "all" ? Number(b.trouble) - Number(a.trouble) || (a.trouble ? b.misses - a.misses : 0) || a.rank - b.rank : a.rank - b.rank
    );
  }, [rows, filter, query]);

  return (
    <div className="mt-4">
      <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
        {(["words", "parts"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setOpen(null);
            }}
            className={cn("flex-1 rounded-md px-3 py-1.5", tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
          >
            {t === "words" ? `Words (${words.length})` : `Word parts (${parts.length})`}
          </button>
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
      />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs",
              filter === f.key ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label} <span className="tabular-nums opacity-70">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
          {shown.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setOpen(open === r.id ? null : r.id)}
                className="flex w-full items-baseline gap-3 px-4 py-2.5 text-left"
                aria-expanded={open === r.id}
              >
                <span className={cn("size-2 shrink-0 translate-y-[-1px] rounded-full", DOT[r.status])} title={STATUS_LABEL[r.status]} />
                <span className="font-medium text-foreground">{r.title}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{r.meaning}</span>
                {r.trouble && <span className="shrink-0 text-xs text-amber-700">missed {r.misses}</span>}
              </button>
              {open === r.id && (
                <div className="px-4 pb-3 pl-9 text-sm">
                  <p className="text-foreground">
                    <span className="italic text-muted-foreground">{r.pos}</span> {r.meaning}
                  </p>
                  {r.example && <p className="mt-1 italic text-muted-foreground">{r.example}</p>}
                  <p className="mt-2 text-muted-foreground">{r.hook}</p>
                  {r.parts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.parts.map((p) => (
                        <span key={p.part} className="rounded-full bg-accent px-2.5 py-1 text-xs text-foreground">
                          <span className="font-medium">{p.part}</span> means {p.meaning}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {r.seen === 0
                      ? "Not met yet."
                      : `${STATUS_LABEL[r.status]}. Asked ${r.seen} ${r.seen === 1 ? "time" : "times"}, right ${r.right}.${r.dueOn ? ` Next up ${r.dueOn}.` : ""}`}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
