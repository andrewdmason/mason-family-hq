import type { TodoView } from "@/lib/todos/types";

/**
 * The contract between the task list and its drop targets — the sidebar's nav
 * items, and (on a project page) the section headings. Each carries a
 * `data-todo-drop` key; while a task drag is live the list hit-tests the
 * pointer against those elements (dnd-kit's droppables can't cross the
 * separate DndContext trees) and broadcasts the hovered key so the target can
 * highlight itself — the same window-event pattern as quick-add and
 * inline-new. Section headings ride this same path so a collapsed section is
 * still a working drop target.
 */

export const DROP_TARGET_ATTR = "data-todo-drop";

const DROP_TARGET_EVENT = "todos:sidebar-drop-target";

export type SidebarDropTarget =
  | { kind: "view"; view: TodoView }
  | { kind: "project"; projectId: string }
  | { kind: "section"; sectionId: string };

export function viewDropKey(view: TodoView): string {
  return `view:${view}`;
}

export function projectDropKey(projectId: string): string {
  return `project:${projectId}`;
}

export function sectionDropKey(sectionId: string): string {
  return `section:${sectionId}`;
}

export function parseDropKey(key: string): SidebarDropTarget {
  if (key.startsWith("project:")) {
    return { kind: "project", projectId: key.slice("project:".length) };
  }
  if (key.startsWith("section:")) {
    return { kind: "section", sectionId: key.slice("section:".length) };
  }
  return { kind: "view", view: key.slice("view:".length) as TodoView };
}

/** The drop target under the pointer, if any (visible elements only). */
export function dropTargetAtPoint(
  x: number,
  y: number
): { key: string; el: HTMLElement } | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[${DROP_TARGET_ATTR}]`);
  for (const el of nodes) {
    const rect = el.getBoundingClientRect();
    if (
      rect.width > 0 &&
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    ) {
      return { key: el.getAttribute(DROP_TARGET_ATTR)!, el };
    }
  }
  return null;
}

/** Broadcast the hovered (valid) drop key — null when the drag leaves it. */
export function emitDropTarget(key: string | null): void {
  window.dispatchEvent(new CustomEvent(DROP_TARGET_EVENT, { detail: key }));
}

export function onDropTarget(handler: (key: string | null) => void): () => void {
  const listener = (e: Event) =>
    handler((e as CustomEvent<string | null>).detail);
  window.addEventListener(DROP_TARGET_EVENT, listener);
  return () => window.removeEventListener(DROP_TARGET_EVENT, listener);
}
