"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Archive,
  Check,
  Coins,
  ExternalLink,
  Pencil,
  Plus,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  approveClaim,
  archiveEarningTask,
  archivePrize,
  fulfillRedemption,
  rejectClaim,
} from "@/app/(bucks)/bucks/actions";
import { SHARED, audienceLabel } from "@/components/bucks/audience";
import {
  AwardDialog,
  ClaimForDialog,
  PrizeFormDialog,
  RedeemAsDialog,
  TaskFormDialog,
} from "@/components/bucks/manage-dialogs";
import type {
  BucksAdminClaim,
  BucksAdminData,
  BucksAdminPrize,
  BucksAdminRedemption,
  BucksAdminTask,
  BucksKidSummary,
} from "@/lib/bucks/types";

type Filter = "all" | string;

const TILE = "flex flex-col rounded-xl border border-border bg-card/50 p-3";
const ADD_TILE =
  "flex min-h-32 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border p-3 text-sm font-medium text-muted-foreground transition-colors hover:border-amber-500/60 hover:text-foreground";

// ---- Small generic confirm ------------------------------------------------

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HoverActions({
  onEdit,
  onArchive,
}: {
  onEdit: () => void;
  onArchive: () => void;
}) {
  return (
    <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <Button
        size="icon-sm"
        variant="outline"
        className="bg-background"
        onClick={onEdit}
        aria-label="Edit"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon-sm"
        variant="outline"
        className="bg-background"
        onClick={onArchive}
        aria-label="Archive"
      >
        <Archive className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ---- Needs you (approvals + redemptions) ---------------------------------

function NeedsYou({
  claims,
  redemptions,
}: {
  claims: BucksAdminClaim[];
  redemptions: BucksAdminRedemption[];
}) {
  const { pending, error, run } = useBucksAction();
  if (claims.length === 0 && redemptions.length === 0) return null;

  return (
    <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
      <h2 className="text-sm font-medium text-foreground">Needs you</h2>
      <div className="mt-2 space-y-2">
        {claims.map((c) => (
          <div
            key={c.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                {c.taskTitle
                  ? `${c.kidName} claimed “${c.taskTitle}”`
                  : `${c.kidName} asked for ${c.amount} Bucks`}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.taskTitle
                  ? `${c.quantity} × ${c.unitValue} = ${c.amount} Bucks`
                  : c.note}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" onClick={() => run(() => approveClaim(c.id))} disabled={pending}>
                <Check className="h-3.5 w-3.5" /> Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => run(() => rejectClaim(c.id))}
                disabled={pending}
              >
                <X className="h-3.5 w-3.5" /> Reject
              </Button>
            </div>
          </div>
        ))}
        {redemptions.map((r) => (
          <div
            key={r.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                {r.kidName} redeemed “{r.prizeTitle}”
              </p>
              <p className="text-xs text-muted-foreground">{r.price} Bucks — hand it over</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(() => fulfillRedemption(r.id))}
              disabled={pending}
            >
              <Check className="h-3.5 w-3.5" /> Mark given
            </Button>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

// ---- Earn -----------------------------------------------------------------

function TaskCard({
  task,
  kids,
  filterUserId,
}: {
  task: BucksAdminTask;
  kids: BucksKidSummary[];
  filterUserId?: string;
}) {
  const { pending, error, run } = useBucksAction();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);

  return (
    <div className={cn(TILE, "group relative")}>
      <HoverActions onEdit={() => setEditOpen(true)} onArchive={() => setArchiveOpen(true)} />
      <Sparkles className="h-5 w-5 text-amber-500" />
      <p className="mt-2 line-clamp-2 pr-12 text-sm font-medium text-foreground">{task.title}</p>
      <p className="pt-1 text-xs text-muted-foreground">
        {task.unitValue} / {task.unitLabel} · {audienceLabel(task.audienceUserId, kids)}
        {task.isOneTime && " · one-time"}
      </p>
      <Button size="sm" variant="outline" className="mt-auto" onClick={() => setClaimOpen(true)}>
        Claim…
      </Button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}

      <TaskFormDialog open={editOpen} onOpenChange={setEditOpen} kids={kids} task={task} />
      <ClaimForDialog
        open={claimOpen}
        onOpenChange={setClaimOpen}
        task={task}
        kids={kids}
        defaultUserId={filterUserId}
      />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive “${task.title}”?`}
        description="Kids won't see it anymore. Bucks already earned stay put."
        confirmLabel="Archive"
        pending={pending}
        error={error}
        onConfirm={() =>
          run(async () => {
            await archiveEarningTask(task.id);
            setArchiveOpen(false);
          })
        }
      />
    </div>
  );
}

// ---- Prizes ---------------------------------------------------------------

function PrizeCard({
  prize,
  kids,
  filterUserId,
}: {
  prize: BucksAdminPrize;
  kids: BucksKidSummary[];
  filterUserId?: string;
}) {
  const { pending, error, run } = useBucksAction();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);

  return (
    <div className={cn(TILE, "group relative")}>
      <HoverActions onEdit={() => setEditOpen(true)} onArchive={() => setArchiveOpen(true)} />
      <div className="flex h-24 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {prize.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={prize.imageUrl} alt={prize.title} className="h-full w-full object-contain" />
        ) : (
          <Trophy className="h-8 w-8 text-muted-foreground" />
        )}
      </div>
      <p className="mt-2 truncate text-sm font-medium text-foreground">{prize.title}</p>
      <p className="text-xs text-muted-foreground">
        {prize.price.toLocaleString()} Bucks · {audienceLabel(prize.audienceUserId, kids)}
      </p>
      {prize.purchaseUrl && (
        <a
          href={prize.purchaseUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 inline-flex items-center gap-1 text-xs text-amber-700 hover:underline dark:text-amber-400"
        >
          <ExternalLink className="h-3 w-3" /> Where to buy
        </a>
      )}
      <Button size="sm" variant="outline" className="mt-2" onClick={() => setRedeemOpen(true)}>
        Redeem…
      </Button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}

      <PrizeFormDialog open={editOpen} onOpenChange={setEditOpen} kids={kids} prize={prize} />
      <RedeemAsDialog
        open={redeemOpen}
        onOpenChange={setRedeemOpen}
        prize={prize}
        kids={kids}
        defaultUserId={filterUserId}
      />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive “${prize.title}”?`}
        description="Kids won't see it anymore. Past redemptions stay."
        confirmLabel="Archive"
        pending={pending}
        error={error}
        onConfirm={() =>
          run(async () => {
            await archivePrize(prize.id);
            setArchiveOpen(false);
          })
        }
      />
    </div>
  );
}

// ---- Shell ----------------------------------------------------------------

export function BucksParentView({ data }: { data: BucksAdminData }) {
  const { kids, tasks, prizes, claims, redemptions } = data;
  const [filter, setFilter] = useState<Filter>("all");
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [addPrizeOpen, setAddPrizeOpen] = useState(false);
  const [awardOpen, setAwardOpen] = useState(false);

  const matchesKid = (audienceUserId: string | null) =>
    filter === "all" || audienceUserId === null || audienceUserId === filter;

  const shownTasks = tasks.filter((t) => matchesKid(t.audienceUserId));
  const shownPrizes = prizes.filter((p) => matchesKid(p.audienceUserId));
  const shownClaims = claims.filter((c) => filter === "all" || c.kidUserId === filter);
  const shownRedemptions = redemptions.filter(
    (r) => filter === "all" || r.kidUserId === filter
  );

  const filterKid = filter === "all" ? undefined : kids.find((k) => k.userId === filter);
  const defaultAudience = filterKid?.email ?? SHARED;
  const historyHref = filterKid ? `/bucks/history?kid=${filterKid.userId}` : "/bucks/history";

  return (
    <div className="space-y-6">
      <NeedsYou claims={shownClaims} redemptions={shownRedemptions} />

      {/* Kid filter + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </FilterPill>
          {kids.map((k) => (
            <FilterPill
              key={k.userId}
              active={filter === k.userId}
              onClick={() => setFilter(k.userId)}
            >
              <Coins className="h-3.5 w-3.5 text-amber-500" />
              {k.name}
              <span className="tabular-nums opacity-70">{k.balance.toLocaleString()}</span>
            </FilterPill>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={historyHref}
            className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            History
          </Link>
          {kids.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setAwardOpen(true)}>
              <Plus className="h-4 w-4" /> Award Bucks
            </Button>
          )}
        </div>
      </div>

      {/* Earn */}
      <section>
        <h2 className="font-serif text-lg text-foreground">Earn</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shownTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              kids={kids}
              filterUserId={filterKid?.userId}
            />
          ))}
          <button type="button" className={ADD_TILE} onClick={() => setAddTaskOpen(true)}>
            <Plus className="h-5 w-5" />
            Add task
          </button>
        </div>
      </section>

      {/* Prizes */}
      <section>
        <h2 className="font-serif text-lg text-foreground">Prizes</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shownPrizes.map((prize) => (
            <PrizeCard
              key={prize.id}
              prize={prize}
              kids={kids}
              filterUserId={filterKid?.userId}
            />
          ))}
          <button type="button" className={ADD_TILE} onClick={() => setAddPrizeOpen(true)}>
            <Plus className="h-5 w-5" />
            Add prize
          </button>
        </div>
      </section>

      <TaskFormDialog
        open={addTaskOpen}
        onOpenChange={setAddTaskOpen}
        kids={kids}
        defaultAudience={defaultAudience}
      />
      <PrizeFormDialog
        open={addPrizeOpen}
        onOpenChange={setAddPrizeOpen}
        kids={kids}
        defaultAudience={defaultAudience}
      />
      <AwardDialog
        open={awardOpen}
        onOpenChange={setAwardOpen}
        kids={kids}
        defaultUserId={filterKid?.userId}
      />
    </div>
  );
}

function FilterPill({
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
