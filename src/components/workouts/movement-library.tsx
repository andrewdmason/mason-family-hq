"use client";

import { useMemo, useState, useTransition } from "react";
import {
  MoreHorizontal,
  Pencil,
  GitMerge,
  Loader2,
  X,
  Repeat,
  Sparkles,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MOVEMENT_FAMILIES, type MovementFamily } from "@/lib/workouts/types";
import {
  FAMILY_LABELS,
  type LibraryFamily,
  type LibraryMovement,
} from "@/lib/workouts/library";
import {
  renameMovement,
  setMovementFamily,
  setMovementLoaded,
  mergeMovements,
  setSubstitute,
  clearSubstitute,
  generateSubstitute,
} from "@/app/(workouts)/workouts/movements/actions";
import { relativeDays } from "@/lib/workouts/format";

type FlatMovement = {
  id: string;
  name: string;
  family: MovementFamily;
  aliases: string[];
};

const TH =
  "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2 align-top";

export function MovementLibrary({
  families,
  allMovements,
  today,
}: {
  families: LibraryFamily[];
  allMovements: FlatMovement[];
  today: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30">
          <tr>
            <th className={TH}>Movement</th>
            <th className={cn(TH, "hidden sm:table-cell")}>Substitute</th>
            <th className={cn(TH, "hidden sm:table-cell")}>Last</th>
            <th className={cn(TH, "text-right")}>Used</th>
            <th className={cn(TH, "w-10")} />
          </tr>
        </thead>
        {families.map((fam) => (
          <tbody key={fam.family}>
            <tr className="border-t border-border bg-muted/20">
              <td colSpan={5} className="px-3 py-1.5">
                <span className="font-serif text-foreground">{fam.label}</span>{" "}
                <span className="text-xs text-muted-foreground">
                  {fam.movements.length}
                </span>
              </td>
            </tr>
            {fam.movements.map((m) => (
              <MovementRow
                key={m.id}
                movement={m}
                allMovements={allMovements}
                today={today}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function MovementRow({
  movement,
  allMovements,
  today,
}: {
  movement: LibraryMovement;
  allMovements: FlatMovement[];
  today: string;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(movement.name);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  function commitRename() {
    setEditing(false);
    const next = name.trim();
    if (next && next !== movement.name) {
      run(() => renameMovement(movement.id, next));
    } else {
      setName(movement.name);
    }
  }

  return (
    <>
      <tr className="border-t border-border/60">
        <td className={TD}>
          {editing ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setName(movement.name);
                  setEditing(false);
                }
              }}
              className="h-8 w-full min-w-[8rem] rounded-md border border-input bg-background px-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{movement.name}</span>
              {movement.isLoaded && (
                <span
                  title="Tracked for estimated 1RM"
                  className="rounded bg-primary/10 px-1 py-0.5 text-[10px] uppercase tracking-wide text-primary"
                >
                  e1RM
                </span>
              )}
            </div>
          )}
        </td>

        <td className={cn(TD, "hidden whitespace-nowrap sm:table-cell")}>
          {movement.substitute ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Repeat className="size-3.5 shrink-0" />
              <span className="text-foreground">{movement.substitute.name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </td>

        <td className={cn(TD, "hidden whitespace-nowrap text-muted-foreground sm:table-cell")}>
          {movement.lastDate ? (
            relativeDays(movement.lastDate, today)
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </td>

        <td className={cn(TD, "text-right tabular-nums text-muted-foreground")}>
          {movement.usageCount}
        </td>

        <td className={cn(TD, "text-right")}>
          <div className="flex items-center justify-end gap-1">
            {pending && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Actions for ${movement.name}`}
                    className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  />
                }
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <Pencil />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuCheckboxItem
                  checked={movement.isLoaded}
                  onCheckedChange={(checked) =>
                    run(() => setMovementLoaded(movement.id, checked === true))
                  }
                >
                  Track for e1RM
                </DropdownMenuCheckboxItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Change family</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={movement.family}
                      onValueChange={(v) =>
                        run(() =>
                          setMovementFamily(movement.id, v as MovementFamily)
                        )
                      }
                    >
                      {MOVEMENT_FAMILIES.map((f) => (
                        <DropdownMenuRadioItem key={f} value={f}>
                          {FAMILY_LABELS[f]}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSubOpen(true)}>
                  <Repeat />
                  {movement.substitute ? "Change substitute…" : "Set substitute…"}
                </DropdownMenuItem>
                {movement.substitute && (
                  <DropdownMenuItem
                    onClick={() => run(() => clearSubstitute(movement.id))}
                  >
                    <X />
                    Remove substitute
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setMergeOpen(true)}
                >
                  <GitMerge />
                  Merge into…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <MergeDialog
            open={mergeOpen}
            onOpenChange={setMergeOpen}
            movement={movement}
            allMovements={allMovements}
            onConfirm={(targetId) => {
              setMergeOpen(false);
              run(() => mergeMovements(targetId, movement.id));
            }}
          />
          <SubstituteDialog
            open={subOpen}
            onOpenChange={setSubOpen}
            movement={movement}
            allMovements={allMovements}
          />
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={5} className="px-3 pb-2 text-xs text-destructive">
            {error}
          </td>
        </tr>
      )}
    </>
  );
}

function MergeDialog({
  open,
  onOpenChange,
  movement,
  allMovements,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  movement: LibraryMovement;
  allMovements: FlatMovement[];
  onConfirm: (targetId: string) => void;
}) {
  const [target, setTarget] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="text-left">
        <DialogHeader>
          <DialogTitle>Merge “{movement.name}”</DialogTitle>
          <DialogDescription>
            Fold this into another movement: its {movement.usageCount} logged{" "}
            {movement.usageCount === 1 ? "entry" : "entries"} and aliases move to
            the one you pick, then “{movement.name}” is removed. Past history
            merges automatically.
          </DialogDescription>
        </DialogHeader>

        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">Choose a movement…</option>
          {allMovements
            .filter((m) => m.id !== movement.id)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.family !== movement.family
                  ? ` (${FAMILY_LABELS[m.family]})`
                  : ""}
              </option>
            ))}
        </select>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-input px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!target}
            onClick={() => target && onConfirm(target)}
            className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Merge &amp; remove
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubstituteDialog({
  open,
  onOpenChange,
  movement,
  allMovements,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  movement: LibraryMovement;
  allMovements: FlatMovement[];
}) {
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allMovements
      .filter((m) => m.id !== movement.id)
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.aliases.some((a) => a.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [query, allMovements, movement.id]);

  function pick(targetId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await setSubstitute(movement.id, targetId);
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  function removeSub() {
    setError(null);
    startTransition(async () => {
      try {
        await clearSubstitute(movement.id);
        onOpenChange(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });
  }

  function generate() {
    setError(null);
    setAiResult(null);
    startTransition(async () => {
      const res = await generateSubstitute(movement.id, reason.trim() || undefined);
      if (res.ok) setAiResult(`${res.name} — ${res.rationale}`);
      else setError(res.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="text-left">
        <DialogHeader>
          <DialogTitle>Substitute for “{movement.name}”</DialogTitle>
          <DialogDescription>
            Pick a movement you can do instead — it&apos;s suggested as a swap when
            this shows up in a workout.
          </DialogDescription>
        </DialogHeader>

        {movement.substitute && (
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-sm">
            <span className="text-muted-foreground">
              Current:{" "}
              <span className="text-foreground">{movement.substitute.name}</span>
            </span>
            <button
              type="button"
              onClick={removeSub}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              Remove
            </button>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <Search className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search movements…"
              className="h-9 w-full rounded-md border border-input bg-background pr-2 pl-8 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {results.length > 0 && (
            <div className="max-h-48 divide-y divide-border/60 overflow-y-auto rounded-md border border-border">
              {results.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={pending}
                  onClick={() => pick(m.id)}
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-60"
                >
                  <span className="truncate text-foreground">{m.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {FAMILY_LABELS[m.family]}
                  </span>
                </button>
              ))}
            </div>
          )}
          {query.trim() && results.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No matches — try the AI suggestion below.
            </p>
          )}
        </div>

        <div className="rounded-md border border-border p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Sparkles className="size-3.5 text-primary" />
            Or let AI pick one
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional: why (e.g. bad knee, no rig)"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            type="button"
            disabled={pending}
            onClick={generate}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Generate substitute
          </button>
          {aiResult && (
            <p className="mt-2 text-xs text-foreground">Set: {aiResult}</p>
          )}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-input px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Done
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
