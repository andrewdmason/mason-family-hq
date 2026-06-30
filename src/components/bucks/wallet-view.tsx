"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpen, Coins, NotebookPen, Sparkles, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useBucksAction } from "@/lib/bucks/use-bucks-action";
import { claimTask, redeemPrize } from "@/app/(bucks)/bucks/actions";
import type { BucksEarnTask, BucksPrize, BucksWallet } from "@/lib/bucks/types";

const TILE = "flex flex-col rounded-xl border border-border bg-card/50 p-3";

// ---- Earn -----------------------------------------------------------------

function EarnTaskTile({ task }: { task: BucksEarnTask }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const { pending, error, run } = useBucksAction();

  function submit() {
    run(async () => {
      await claimTask(task.id, qty);
      setOpen(false);
      setQty(1);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(TILE, "text-left transition-colors hover:border-amber-500/60")}
      >
        <Sparkles className="h-5 w-5 text-amber-500" />
        <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">
          {task.title}
        </p>
        <p className="mt-auto pt-1 text-xs text-muted-foreground">
          {task.unitValue} Bucks / {task.unitLabel}
        </p>
        {task.pendingClaims > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {task.pendingClaims} awaiting approval
          </p>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{task.title}</DialogTitle>
            <DialogDescription>
              {task.unitValue} Bucks per {task.unitLabel}. An adult approves before
              the Bucks land.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <label className="text-sm text-muted-foreground">
              How many {task.unitLabel}s?
            </label>
            <Input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
              className="h-8 w-20"
            />
            <span className="text-sm tabular-nums text-muted-foreground">
              = {task.unitValue * qty} Bucks
            </span>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Submitting…" : "Submit claim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EarnSection({ earnTasks }: { earnTasks: BucksEarnTask[] }) {
  return (
    <section>
      <h2 className="font-serif text-lg text-foreground">Earn</h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className={cn(TILE, "text-sm text-muted-foreground")}>
          <BookOpen className="h-5 w-5 text-amber-500" />
          <p className="mt-2">Read past your weekly goal — every bonus page is 1 Buck.</p>
        </div>
        <div className={cn(TILE, "text-sm text-muted-foreground")}>
          <NotebookPen className="h-5 w-5 text-amber-500" />
          <p className="mt-2">
            Write a real journal entry (150+ words, 5+ minutes) — 5 Bucks.
          </p>
        </div>
        {earnTasks.map((task) => (
          <EarnTaskTile key={task.id} task={task} />
        ))}
      </div>
    </section>
  );
}

// ---- Prizes ---------------------------------------------------------------

function PrizeTile({ prize }: { prize: BucksPrize }) {
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useBucksAction();

  function redeem() {
    run(async () => {
      await redeemPrize(prize.id);
      setOpen(false);
    });
  }

  return (
    <div className={TILE}>
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
      <p className="mt-2 truncate text-sm font-medium text-foreground">{prize.title}</p>
      <p className="text-xs tabular-nums text-muted-foreground">
        {prize.price.toLocaleString()} Bucks
      </p>
      <Button
        size="sm"
        variant="outline"
        className="mt-2"
        disabled={!prize.affordable}
        onClick={() => setOpen(true)}
      >
        {prize.affordable ? "Redeem" : "Not enough Bucks"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Redeem {prize.title}?</DialogTitle>
            <DialogDescription>
              This spends {prize.price.toLocaleString()} Bucks. An adult will hand it
              over.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={redeem} disabled={pending}>
              {pending ? "Redeeming…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PrizesSection({ prizes }: { prizes: BucksPrize[] }) {
  return (
    <section>
      <h2 className="font-serif text-lg text-foreground">Prizes</h2>
      {prizes.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No prizes available right now.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {prizes.map((prize) => (
            <PrizeTile key={prize.id} prize={prize} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---- Shell ----------------------------------------------------------------

export function WalletView({ wallet }: { wallet: BucksWallet }) {
  const { balance, earnTasks, prizes } = wallet;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/50 px-5 py-4">
        <div className="flex items-center gap-2">
          <Coins className="h-6 w-6 text-amber-500" />
          <span className="text-3xl font-semibold tabular-nums text-foreground">
            {balance.toLocaleString()}
          </span>
          <span className="text-sm text-muted-foreground">Mason Bucks</span>
        </div>
        <Link
          href="/bucks/history"
          className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          History
        </Link>
      </div>

      <EarnSection earnTasks={earnTasks} />
      <PrizesSection prizes={prizes} />
    </div>
  );
}
