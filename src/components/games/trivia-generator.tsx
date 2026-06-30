"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { generateBatch, deleteBatch } from "@/app/(games)/games/trivia/generate/actions";
import type { BatchSummary } from "@/app/(games)/games/trivia/generate/actions";
import type { TriviaLevel, TriviaType } from "@/lib/games/types";

const LEVEL_OPTIONS: { value: TriviaLevel; label: string }[] = [
  { value: "younger_kid", label: "Younger kid" },
  { value: "older_kid", label: "Older kid" },
  { value: "adult", label: "Adult" },
  { value: "all", label: "Everyone" },
];

const TYPE_OPTIONS: { value: TriviaType; label: string }[] = [
  { value: "mc", label: "Multiple choice" },
  { value: "list", label: "List it" },
  { value: "closest", label: "Closest wins" },
];

const LEVEL_LABEL: Record<string, string> = Object.fromEntries(
  LEVEL_OPTIONS.map((o) => [o.value, o.label])
);
const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  TYPE_OPTIONS.map((o) => [o.value, o.label])
);

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function TriviaGenerator({ batches }: { batches: BatchSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState<TriviaLevel>("all");
  const [type, setType] = useState<TriviaType>("mc");
  const [count, setCount] = useState(8);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function onGenerate() {
    setMessage(null);
    setError(null);
    const t = topic.trim();
    if (!t) {
      setError("Enter a topic first.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await generateBatch({ topic: t, level, type, count });
        if (!res.ok) {
          setError("The generator couldn't make usable questions. Try again.");
        } else {
          setMessage(
            `Added ${res.ready} question${res.ready === 1 ? "" : "s"}` +
              (res.quarantined > 0 ? ` (${res.quarantined} held back by the fact-checker)` : "") +
              "."
          );
          setTopic("");
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  function onDelete(batchId: string) {
    startTransition(async () => {
      try {
        await deleteBatch(batchId);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't delete that batch.");
      }
    });
  }

  return (
    <div className="mt-6 space-y-8">
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-serif text-lg text-foreground">Generate questions</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick a topic and the AI writes a batch. Every question is fact-checked before
          it can show up in a game.
        </p>

        <div className="mt-4 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="topic">Topic</Label>
            <Input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. San Francisco Giants, the 13 colonies, fractions"
              disabled={pending}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="level">Level</Label>
              <select
                id="level"
                className={selectClass}
                value={level}
                onChange={(e) => setLevel(e.target.value as TriviaLevel)}
                disabled={pending}
              >
                {LEVEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="type">Type</Label>
              <select
                id="type"
                className={selectClass}
                value={type}
                onChange={(e) => setType(e.target.value as TriviaType)}
                disabled={pending}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="count">How many</Label>
              <Input
                id="count"
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                disabled={pending}
              />
            </div>
          </div>

          <Button onClick={onGenerate} disabled={pending} className="gap-2">
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Generate
          </Button>

          {message && <p className="text-sm text-emerald-700">{message}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </section>

      <section>
        <h2 className="font-serif text-lg text-foreground">Recent batches</h2>
        {batches.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
            No question batches yet. Generate one above to start the bank.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
            {batches.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{b.topic}</p>
                  <p className="text-xs text-muted-foreground">
                    {[b.level ? LEVEL_LABEL[b.level] : null, b.type ? TYPE_LABEL[b.type] : null]
                      .filter(Boolean)
                      .join(" · ")}
                    {b.status === "ready" ? (
                      <>
                        {" · "}
                        <span className="text-emerald-700">{b.ready} ready</span>
                        {b.quarantined > 0 && (
                          <span className="text-muted-foreground">
                            {" · "}
                            {b.quarantined} held back
                          </span>
                        )}
                      </>
                    ) : (
                      <span className={cn("ml-1", b.status === "failed" && "text-destructive")}>
                        · {b.status === "generating" ? "working…" : b.status}
                      </span>
                    )}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onDelete(b.id)}
                  disabled={pending}
                  aria-label={`Delete ${b.topic} batch`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
