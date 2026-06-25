"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Coins, NotebookPen, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { claimTask, redeemPrize } from "@/app/(bucks)/bucks/actions";
import type {
  BucksEarnTask,
  BucksLedgerEntry,
  BucksPrize,
  BucksWallet,
} from "@/lib/bucks/types";

function useAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  };
  return { pending, error, run };
}

function EarnTaskRow({
  task,
  memberEmail,
}: {
  task: BucksEarnTask;
  memberEmail: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const { pending, error, run } = useAction();

  function submit() {
    run(async () => {
      await claimTask(task.id, qty, memberEmail);
      setOpen(false);
      setQty(1);
    });
  }

  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{task.title}</p>
          <p className="text-xs text-muted-foreground">
            {task.unitValue} Bucks / {task.unitLabel}
            {task.pendingClaims > 0 && (
              <span className="ml-2 text-amber-700 dark:text-amber-400">
                {task.pendingClaims} awaiting approval
              </span>
            )}
          </p>
        </div>
        {!open && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            I did this
          </Button>
        )}
      </div>
      {open && (
        <div className="mt-2.5 flex items-center gap-2">
          <label className="text-xs text-muted-foreground">
            How many {task.unitLabel}s?
          </label>
          <Input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
            className="h-7 w-20"
          />
          <span className="text-xs tabular-nums text-muted-foreground">
            = {task.unitValue * qty} Bucks
          </span>
          <Button size="sm" onClick={submit} disabled={pending}>
            {pending ? "Submitting…" : "Submit claim"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function PrizeCard({
  prize,
  memberEmail,
}: {
  prize: BucksPrize;
  memberEmail: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const { pending, error, run } = useAction();

  function redeem() {
    run(async () => {
      await redeemPrize(prize.id, memberEmail);
      setConfirming(false);
    });
  }

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card/50 p-3">
      <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {prize.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={prize.imageUrl}
            alt={prize.title}
            className="h-full w-full object-contain"
          />
        ) : (
          <Trophy className="h-8 w-8 text-muted-foreground" />
        )}
      </div>
      <p className="mt-2 truncate text-sm font-medium text-foreground">
        {prize.title}
      </p>
      <p className="text-xs tabular-nums text-muted-foreground">
        {prize.price.toLocaleString()} Bucks
      </p>
      {confirming ? (
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={redeem} disabled={pending}>
            {pending ? "Redeeming…" : "Confirm"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirming(false)}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={!prize.affordable}
          onClick={() => setConfirming(true)}
        >
          {prize.affordable ? "Redeem" : "Not enough Bucks"}
        </Button>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function HistoryRow({ entry }: { entry: BucksLedgerEntry }) {
  const positive = entry.amount >= 0;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-sm text-foreground">{entry.label}</p>
        <p className="text-xs text-muted-foreground">
          {new Date(entry.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 text-sm font-medium tabular-nums",
          positive ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
        )}
      >
        {positive ? "+" : ""}
        {entry.amount.toLocaleString()}
      </span>
    </div>
  );
}

export function WalletView({
  wallet,
  memberEmail,
}: {
  wallet: BucksWallet;
  memberEmail: string | null;
}) {
  const { balance, history, earnTasks, prizes } = wallet;

  return (
    <div className="mt-6 space-y-8">
      {/* Balance */}
      <div className="rounded-xl border border-border bg-card/50 px-5 py-4">
        <div className="flex items-center gap-2">
          <Coins className="h-6 w-6 text-amber-500" />
          <span className="text-3xl font-semibold tabular-nums text-foreground">
            {balance.toLocaleString()}
          </span>
          <span className="text-sm text-muted-foreground">Mason Bucks</span>
        </div>
      </div>

      {/* Ways to earn */}
      <section>
        <h2 className="font-serif text-lg text-foreground">Ways to earn</h2>
        <div className="mt-3 space-y-2.5">
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
            <BookOpen className="h-4 w-4 shrink-0 text-amber-500" />
            <span>Read past your weekly goal — every bonus page is 1 Buck.</span>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
            <NotebookPen className="h-4 w-4 shrink-0 text-amber-500" />
            <span>Write a real journal entry (150+ words, 5+ minutes) — 5 Bucks.</span>
          </div>
          {earnTasks.map((task) => (
            <EarnTaskRow key={task.id} task={task} memberEmail={memberEmail} />
          ))}
        </div>
      </section>

      {/* Prizes */}
      <section>
        <h2 className="font-serif text-lg text-foreground">Prizes</h2>
        {prizes.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No prizes available right now.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {prizes.map((prize) => (
              <PrizeCard key={prize.id} prize={prize} memberEmail={memberEmail} />
            ))}
          </div>
        )}
      </section>

      {/* History */}
      <section>
        <h2 className="font-serif text-lg text-foreground">History</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <div className="mt-2 divide-y divide-border">
            {history.map((entry) => (
              <HistoryRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
