"use client";

import { useEffect, useRef } from "react";
import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { DROP_TARGET_ATTR, sectionDropKey } from "@/lib/todos/drop-targets";
import { cn } from "@/lib/utils";

/** dnd-kit's activator, handed down from the SortableSection wrapper in
 * task-list.tsx: the heading is the handle, the whole block is what moves. */
export type SectionDragHandle = {
  ref: (element: HTMLElement | null) => void;
  /** dnd-kit's `attributes` (+ `listeners` when the drag is live), spread
   * straight onto the heading. */
  props: React.HTMLAttributes<HTMLElement>;
};

/**
 * A project section's heading — Things' headings, as a container rather than
 * an interleaved row (see migration 00169).
 *
 * It wears three hats at once, which is why it's its own component:
 *  • the fold toggle for its group (state lives in localStorage — see
 *    lib/todos/section-collapse.ts);
 *  • a drop target for dragged to-dos, via the same `data-todo-drop`
 *    hit-testing the sidebar uses — so a *collapsed* section still files
 *    what you drop on it;
 *  • the drag handle for reordering, which carries the whole block with it.
 *
 * Renaming happens in place. An empty name discards a brand-new section
 * rather than leaving an untitled heading behind.
 */
export function SectionHeader({
  id,
  name,
  count,
  collapsed,
  editing,
  dropActive,
  dragHandle,
  onToggleCollapse,
  onStartRename,
  onCommitName,
  onCancelEdit,
  onDelete,
}: {
  id: string;
  name: string;
  /** Open to-dos in the section — mostly so a folded section isn't a dead end. */
  count: number;
  collapsed: boolean;
  editing: boolean;
  /** A to-do drag is hovering this heading. */
  dropActive: boolean;
  dragHandle?: SectionDragHandle;
  onToggleCollapse: () => void;
  onStartRename: () => void;
  onCommitName: (name: string) => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Blur commits, but Escape must not — it cancels, and the re-render that
  // follows would otherwise fire the blur handler right behind it.
  const cancelled = useRef(false);
  // A blur in the first couple of frames isn't the user leaving the field —
  // it's the overflow menu handing focus back to its trigger as it closes.
  // Committing that would discard the heading before it could be typed.
  const settled = useRef(false);

  useEffect(() => {
    if (!editing) return;
    cancelled.current = false;
    settled.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        settled.current = true;
      });
    });
    return () => cancelAnimationFrame(outer);
  }, [editing]);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={dragHandle?.ref}
        // Only a *folded* heading is a drop target (the hit-test path from
        // lib/todos/drop-targets.ts, which files to the bottom). Expanded, the
        // rows underneath are the targets — otherwise aiming for the top of a
        // section would hit the heading and land the to-do at the bottom.
        {...(collapsed ? { [DROP_TARGET_ATTR]: sectionDropKey(id) } : {})}
        {...(dragHandle?.props ?? {})}
        className={cn(
          "mb-1 flex items-center gap-1.5 rounded-md px-1 py-1 transition-colors",
          // The whole heading is the handle — a section drags like a task row
          // does, from anywhere on it rather than from a dedicated grip.
          !editing && "cursor-grab active:cursor-grabbing",
          dropActive && "bg-primary/10 ring-1 ring-primary/40"
        )}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          // The button owns the pointer so a fold never starts a drag.
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
          aria-expanded={!collapsed}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")}
          />
        </button>

        {editing ? (
          <input
            ref={inputRef}
            defaultValue={name}
            placeholder="Section name"
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              if (cancelled.current) return;
              if (!settled.current) {
                inputRef.current?.focus();
                return;
              }
              onCommitName(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              // The list's global key handler ignores typing targets, but stop
              // these anyway so nothing upstream sees them.
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitName(e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelled.current = true;
                onCancelEdit();
              }
            }}
            className="min-w-0 flex-1 border-b border-primary/40 bg-transparent text-xs font-semibold uppercase tracking-wide text-foreground outline-none"
          />
        ) : (
          <>
            <button
              type="button"
              onDoubleClick={onStartRename}
              onClick={onToggleCollapse}
              // Deliberately does NOT stop the pointer from reaching the drag
              // listeners above: this button is ~90% of the heading's width, so
              // swallowing pointerdown here leaves nowhere to grab the section
              // by. The sensor's 5px threshold is what separates a fold from a
              // drag — a click that doesn't travel still just folds.
              className="min-w-0 flex-1 cursor-grab truncate text-left text-xs font-semibold uppercase tracking-wide text-foreground/70 hover:text-foreground active:cursor-grabbing"
            >
              {name}
            </button>
            {count > 0 && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
          </>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={onStartRename} className="gap-2">
          <Pencil className="size-4 text-muted-foreground" />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete} className="gap-2">
          <Trash2 className="size-4" />
          Delete section
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
