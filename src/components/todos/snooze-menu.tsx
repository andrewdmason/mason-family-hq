"use client";

import { useState } from "react";
import { Moon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  defaultCustomSnooze,
  snoozePresets,
} from "@/lib/todos/snooze";
import { cn } from "@/lib/utils";

/**
 * The snooze picker: quick presets (This evening 5pm, Tomorrow, This weekend,
 * Next week) plus a custom date+time. Snoozing hides the task everywhere until
 * the moment passes, when it pops into Today.
 */
export function SnoozeMenu({
  onSnooze,
  triggerClassName,
  open: openProp,
  onOpenChange,
}: {
  onSnooze: (when: Date) => void;
  triggerClassName?: string;
  /** Controlled open (the keyboard `s` summons it); omit for internal state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [custom, setCustom] = useState("");

  // Recomputed each open so "this evening" drops off after 5pm.
  const presets = open ? snoozePresets() : [];

  const pick = (when: Date) => {
    setOpen(false);
    onSnooze(when);
  };

  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next)}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              triggerClassName
            )}
          />
        }
      >
        <Moon className="size-4 text-indigo-500" />
        Snooze
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-1 p-1.5">
        {presets.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => pick(preset.when)}
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent/60"
          >
            <span>{preset.label}</span>
            <span className="text-xs text-muted-foreground">{preset.hint}</span>
          </button>
        ))}
        <div className="mt-1 border-t border-border/60 pt-2 pb-1">
          <label className="px-2 text-xs font-medium text-muted-foreground">
            Pick a date &amp; time
          </label>
          <div className="mt-1 flex items-center gap-1.5 px-2">
            <input
              type="datetime-local"
              value={custom || defaultCustomSnooze()}
              onChange={(e) => setCustom(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                const when = new Date(custom || defaultCustomSnooze());
                if (!Number.isNaN(when.getTime())) pick(when);
              }}
              className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Set
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
