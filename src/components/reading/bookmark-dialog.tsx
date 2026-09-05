"use client";

import { useState } from "react";
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
import type { BookmarkDraft } from "./use-bookmarks";

/**
 * Naming a place.
 *
 * The field opens EMPTY, with the line you bookmarked shown above it. Prefilling
 * it with the line's first words would look helpful and would be the opposite:
 * text you have to clear before you can type your own, in exchange for a "name"
 * that is really a quotation. Unnamed is the fast path — open, Enter, done — and
 * the list labels those rows with the excerpt anyway.
 *
 * Remounted per opening (see the reader's `key`), so the field is genuinely
 * fresh each time rather than holding what you typed and cancelled last night.
 */
export function BookmarkDialog({
  draft,
  onSave,
  onCancel,
}: {
  draft: BookmarkDraft;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const renaming = draft.mode === "rename";
  const [name, setName] = useState(renaming ? (draft.bookmark.name ?? "") : "");
  const excerpt = renaming ? draft.bookmark.excerpt : draft.excerpt;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(name);
          }}
        >
          <DialogHeader>
            <DialogTitle>{renaming ? "Rename bookmark" : "Add a bookmark"}</DialogTitle>
            <DialogDescription className="sr-only">
              Give this place a name, or save it without one.
            </DialogDescription>
          </DialogHeader>

          {excerpt && (
            <p className="mt-3 border-l-2 border-border pl-3 font-serif text-sm text-muted-foreground">
              {excerpt}
            </p>
          )}

          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this place (optional)"
            maxLength={80}
            className="mt-3"
          />

          <DialogFooter className="mt-4">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
