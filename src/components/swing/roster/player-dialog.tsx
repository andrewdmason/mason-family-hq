"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  archivePlayer,
  createPlayer,
  updatePlayer,
} from "@/app/(swing)/swing/actions";
import type { Bats, SwingPlayer } from "@/lib/swing/types";

const BATS_LABELS: Record<Bats, string> = { L: "Left", R: "Right" };

/**
 * Add/edit a roster player. Controlled by the shell (no built-in trigger);
 * `player` null means "add". On save/archive the shell's onSaved runs
 * router.refresh() — the server actions don't revalidate (see actions.ts).
 *
 * The form lives in an inner component that unmounts with the dialog popup
 * (and is keyed by player), so every open starts from the player's current
 * values — no reset effect needed.
 */
export function PlayerDialog({
  open,
  onOpenChange,
  player,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player: SwingPlayer | null;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{player ? "Edit player" : "Add player"}</DialogTitle>
        </DialogHeader>
        <PlayerForm
          key={player?.id ?? "new"}
          player={player}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

function PlayerForm({
  player,
  onClose,
  onSaved,
}: {
  player: SwingPlayer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(player?.name ?? "");
  const [birthYear, setBirthYear] = useState(
    player ? String(player.birthYear) : ""
  );
  const [bats, setBats] = useState<Bats>(player?.bats ?? "R");
  const [notes, setNotes] = useState(player?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input = {
      name,
      birthYear: Number(birthYear),
      bats,
      notes: notes.trim() || null,
    };
    startTransition(async () => {
      try {
        if (player) await updatePlayer(player.id, input);
        else await createPlayer(input);
        onSaved();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save player.");
      }
    });
  }

  function handleArchive() {
    if (!player) return;
    if (
      !window.confirm(
        `Archive ${player.name}? They leave the roster, but their sessions and assessments are kept.`
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await archivePlayer(player.id);
        onSaved();
        onClose();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't archive player."
        );
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="player-name">Name</Label>
        <Input
          id="player-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="First name"
          autoComplete="off"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="player-birth-year">Birth year</Label>
          <Input
            id="player-birth-year"
            type="number"
            inputMode="numeric"
            min={1990}
            max={2030}
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value)}
            placeholder={String(new Date().getFullYear() - 9)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="player-bats">Bats</Label>
          <Select value={bats} onValueChange={(v) => setBats(v as Bats)}>
            <SelectTrigger id="player-bats" className="w-full">
              <SelectValue>{BATS_LABELS[bats]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(BATS_LABELS) as Bats[]).map((side) => (
                <SelectItem key={side} value={side}>
                  {BATS_LABELS[side]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="player-notes">Notes</Label>
        <Textarea
          id="player-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything worth remembering — team, coachability, injuries…"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter className={player ? "sm:justify-between" : undefined}>
        {player && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleArchive}
            disabled={pending}
            className="text-destructive hover:text-destructive"
          >
            Archive
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : player ? "Save changes" : "Add player"}
        </Button>
      </DialogFooter>
    </form>
  );
}
