"use client";

// Lets a container that owns an overlay (the event panel's anchored popover)
// know when a nested picker (date grid, time list, select) is open, so an
// outside-press on the nested popup isn't mistaken for a click away from the
// panel. Pickers report open/close through this context; the default is a
// no-op so they work standalone.

import * as React from "react";

export const NestedOverlayContext = React.createContext<(open: boolean) => void>(
  () => {},
);

export function useNestedOverlayReporter(): (open: boolean) => void {
  return React.useContext(NestedOverlayContext);
}
