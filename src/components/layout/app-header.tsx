"use client";

import { type ReactNode, useEffect, useSyncExternalStore } from "react";

// Lets the current app publish pieces of itself into the global chrome. A tiny
// external store instead of a portal: a portal needs a stable target element,
// but the header's frame is swapped wholesale when its Suspense data resolves
// (GlobalHeaderShell → GlobalHeaderClient), which would strand a portal in the
// detached shell. Both frames render the slots, and whichever one is mounted
// simply re-reads the store.
//
// Two channels:
// - "toolbar": the stretch of the header between the app switcher and the
//   notification bell (the calendar's date nav / view switcher / filter).
// - "nav": the current app's section of the mobile hamburger sheet (the
//   calendar's view picker). See MobileNav in app-switcher.
type SlotKey = "toolbar" | "nav";

const contents = new Map<SlotKey, ReactNode>();
const listeners = new Set<() => void>();

function publish(key: SlotKey, node: ReactNode) {
  contents.set(key, node);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useSlot(key: SlotKey): ReactNode {
  return useSyncExternalStore(
    subscribe,
    () => contents.get(key) ?? null,
    // Nothing on the server — slot content appears once the app hydrates.
    () => null,
  );
}

/**
 * Publish children into a slot for as long as the caller stays mounted.
 * Children are re-published on every render, so they can close over live
 * state (the calendar's view/anchor/filter).
 */
function usePublish(key: SlotKey, children: ReactNode) {
  useEffect(() => {
    publish(key, children);
  });
  useEffect(() => () => publish(key, null), [key]);
}

/** The stretch of the global header the current app's controls land in. */
export function AppHeaderSlot() {
  const node = useSlot("toolbar");
  return <div className="flex h-14 min-w-0 flex-1 items-center">{node}</div>;
}

export function AppHeaderContent({ children }: { children: ReactNode }) {
  usePublish("toolbar", children);
  return null;
}

/** The current app's section of the mobile nav sheet, if it published one. */
export function useAppNav(): ReactNode {
  return useSlot("nav");
}

export function AppNavContent({ children }: { children: ReactNode }) {
  usePublish("nav", children);
  return null;
}
