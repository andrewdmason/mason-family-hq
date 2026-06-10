"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Things-style "New": tells the page's TaskList to create an untitled draft
 * at the top of the list, opened for editing in place. Same window-event
 * pattern as quick-add, so the header button doesn't need to share state
 * with the list. (The global `c` modal remains the capture path from
 * anywhere; this is the in-view path.)
 */

const INLINE_NEW_EVENT = "todo-inline-new";

export function emitInlineNew(): void {
  window.dispatchEvent(new CustomEvent(INLINE_NEW_EVENT));
}

export function onInlineNew(handler: () => void): () => void {
  window.addEventListener(INLINE_NEW_EVENT, handler);
  return () => window.removeEventListener(INLINE_NEW_EVENT, handler);
}

export function InlineNewButton({
  label = "New",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={emitInlineNew}
      title="New to-do"
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-primary hover:bg-primary/10",
        className
      )}
    >
      <Plus className="size-4" />
      {label}
    </button>
  );
}
