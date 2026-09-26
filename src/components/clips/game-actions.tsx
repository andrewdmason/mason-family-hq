"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Share, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExportDialog } from "@/components/clips/export-dialog";
import type { ClipGame, ClipKid } from "@/lib/clips/types";
import { deleteGame, exportGame, updateGame } from "@/app/(clips)/clips/actions";

export function GameActions({
  game,
  kids,
  canExport,
}: {
  game: ClipGame;
  kids: ClipKid[];
  canExport: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"export" | "edit" | "delete" | null>(null);
  const [name, setName] = useState(game.name);
  const [date, setDate] = useState(game.playedOn);
  const [kidId, setKidId] = useState(game.kidId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fieldClass =
    "h-10 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-sm";

  const slug = game.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="Game options" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem disabled={!canExport} onClick={() => setDialog("export")}>
            <Share /> Export game reel
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog("edit")}>
            <Pencil /> Edit game
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>
            <Trash2 /> Delete game
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ExportDialog
        open={dialog === "export"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Game reel"
        fileName={`${game.playedOn}-${slug || "game"}.mp4`}
        start={() => exportGame(game.id)}
      />

      <Dialog open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit game</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} />
            <input type="date" className={fieldClass} value={date} onChange={(e) => setDate(e.target.value)} />
            <select className={fieldClass} value={kidId} onChange={(e) => setKidId(e.target.value)}>
              {kids.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.displayName}
                </option>
              ))}
            </select>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  try {
                    await updateGame(game.id, { name, playedOn: date, kidId });
                    setDialog(null);
                    router.refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Could not save");
                  }
                })
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this game?</DialogTitle>
            <DialogDescription>
              Deletes every at-bat video in it, along with the pitch markers. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await deleteGame(game.id);
                  router.push("/clips");
                })
              }
            >
              Delete game
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
