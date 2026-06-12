"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Pencil, Plus, Volleyball } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayerDialog } from "@/components/swing/roster/player-dialog";
import { ageFromBirthYear, type SwingPlayer } from "@/lib/swing/types";

type FocusSummary = { focusCount: number; topCue: string | null };

/**
 * Roster home shell: the active players with their current coaching state,
 * plus add/edit/archive via PlayerDialog. Mutations are server actions; the
 * shell reconciles by router.refresh() against the force-dynamic page.
 */
export function RosterShell({
  players,
  summaries,
}: {
  players: SwingPlayer[];
  summaries: Record<string, FocusSummary>;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SwingPlayer | null>(null);

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(player: SwingPlayer) {
    setEditing(player);
    setDialogOpen(true);
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl tracking-tight">Players</h1>
        {players.length > 0 && (
          <Button size="sm" onClick={openAdd}>
            <Plus data-icon="inline-start" />
            Add player
          </Button>
        )}
      </div>

      {players.length === 0 ? (
        <EmptyRoster onAdd={openAdd} />
      ) : (
        <ul className="divide-y divide-border/70 rounded-xl border">
          {players.map((player) => (
            <PlayerRow
              key={player.id}
              player={player}
              summary={summaries[player.id]}
              onEdit={() => openEdit(player)}
            />
          ))}
        </ul>
      )}

      <PlayerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        player={editing}
        onSaved={() => router.refresh()}
      />
    </main>
  );
}

function PlayerRow({
  player,
  summary,
  onEdit,
}: {
  player: SwingPlayer;
  summary: FocusSummary | undefined;
  onEdit: () => void;
}) {
  const focusLine = summary
    ? `${summary.focusCount} focus ${summary.focusCount === 1 ? "area" : "areas"}${
        summary.topCue ? ` · “${summary.topCue}”` : ""
      }`
    : "No assessment yet";

  return (
    <li className="relative flex items-center gap-2 px-3 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/40 sm:px-4">
      {/* The whole row navigates; the edit button stacks above the overlay. */}
      <Link
        href={`/swing/players/${player.id}`}
        className="absolute inset-0"
        aria-label={`${player.name} — open player`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">
            {player.name}
          </span>
          <Badge variant="outline" className="shrink-0">
            Bats {player.bats}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          Age {ageFromBirthYear(player.birthYear)} · {focusLine}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onEdit}
        aria-label={`Edit ${player.name}`}
        className="relative z-10 shrink-0 text-muted-foreground hover:text-foreground"
      >
        <Pencil />
      </Button>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
    </li>
  );
}

function EmptyRoster({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Volleyball className="size-6" />
      </span>
      <div>
        <p className="font-medium text-foreground">No players yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add the hitters you coach — each player gets their own swing
          sessions, assessments, and focus areas.
        </p>
      </div>
      <Button onClick={onAdd}>
        <Plus data-icon="inline-start" />
        Add your first player
      </Button>
    </div>
  );
}
