"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, RefreshCw, Trash2 } from "lucide-react";
import {
  deleteEntry,
  regenerateEntryWrap,
} from "@/app/(journal)/journal/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ReadOnlyEntryMenu } from "@/components/journal/read-only-entry-menu";

export function EntryTitle({
  entryId,
  title,
  readOnly = false,
  afterTitle = null,
  menuActions = null,
}: {
  entryId: string;
  title: string;
  /** A family member viewing someone else's shared entry: title only, no edit
   * or delete affordances. */
  readOnly?: boolean;
  afterTitle?: React.ReactNode;
  menuActions?: React.ReactNode;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isRegenerating, startRegenerate] = useTransition();
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  if (readOnly) {
    return (
      <>
        <div className="group/title mt-2 flex items-start gap-2">
          <h1 className="font-serif text-3xl leading-tight text-foreground">
            {title}
          </h1>
          <ReadOnlyEntryMenu actions={menuActions} />
        </div>
        {afterTitle}
      </>
    );
  }

  return (
    <div className="mt-2">
      <div className="group/title flex items-start gap-2">
        <h1 className="font-serif text-3xl leading-tight text-foreground">
          {title}
        </h1>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Post options"
            className="mt-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/title:opacity-100 data-[popup-open]:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-44">
            {menuActions}
            <DropdownMenuItem onClick={() => router.push(`/journal/${entryId}/edit`)}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isRegenerating}
              onClick={() => {
                setRegenerateError(null);
                startRegenerate(async () => {
                  try {
                    await regenerateEntryWrap(entryId);
                  } catch (err) {
                    setRegenerateError(
                      err instanceof Error ? err.message : String(err)
                    );
                  }
                });
              }}
            >
              <RefreshCw />
              Regenerate summary
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 />
              Delete post
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isRegenerating && (
        <p className="mt-2 text-sm italic text-muted-foreground animate-pulse">
          summing up…
        </p>
      )}
      {regenerateError && (
        <p className="mt-2 text-sm text-destructive">
          Couldn&apos;t regenerate: {regenerateError}
        </p>
      )}
      {afterTitle}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this post?</DialogTitle>
            <DialogDescription>
              This permanently deletes the entry and its conversation. This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  await deleteEntry(entryId);
                })
              }
            >
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
