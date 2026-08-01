"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Things-style "New": tells the page's TaskList to create an untitled draft
 * at the top of the list, opened for editing in place. Same window-event
 * pattern as quick-add, so the header button doesn't need to share state
 * with the list. (`c` is the keyboard route to the same draft — below the
 * selection — wherever a list creates in place; the global modal is the
 * capture path everywhere else.)
 */

const INLINE_NEW_EVENT = "todo-inline-new";
const INLINE_NEW_SECTION_EVENT = "todo-inline-new-section";

export function emitInlineNew(): void {
  window.dispatchEvent(new CustomEvent(INLINE_NEW_EVENT));
}

export function onInlineNew(handler: () => void): () => void {
  window.addEventListener(INLINE_NEW_EVENT, handler);
  return () => window.removeEventListener(INLINE_NEW_EVENT, handler);
}

export function emitInlineNewSection(): void {
  window.dispatchEvent(new CustomEvent(INLINE_NEW_SECTION_EVENT));
}

export function onInlineNewSection(handler: () => void): () => void {
  window.addEventListener(INLINE_NEW_SECTION_EVENT, handler);
  return () => window.removeEventListener(INLINE_NEW_SECTION_EVENT, handler);
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
