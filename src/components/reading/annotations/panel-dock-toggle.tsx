"use client";

import { PanelRightClose, PictureInPicture2 } from "lucide-react";
import { useReaderSettings } from "../use-reader-settings";

/**
 * Float or dock the chat panel.
 *
 * Docking gives the panel its own width, which the book then has to find from
 * somewhere — usually a column. That's a trade worth offering and not worth
 * making silently, so it's a button in the panel's own header rather than a line
 * in the Layout dialog: the cost lands the moment you press it, in front of you.
 *
 * Reads the setting itself rather than taking it as a prop. It's per-device
 * state in the same store the rest of the layout comes from, and there is only
 * ever one panel on screen.
 */
export function PanelDockToggle() {
  const { settings, update } = useReaderSettings();
  const docked = settings.chatDocked;
  const Icon = docked ? PictureInPicture2 : PanelRightClose;
  const label = docked ? "Float the panel over the book" : "Dock the panel beside the book";
  return (
    <button
      type="button"
      onClick={() => update("chatDocked", !docked)}
      aria-label={label}
      aria-pressed={docked}
      title={label}
      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
