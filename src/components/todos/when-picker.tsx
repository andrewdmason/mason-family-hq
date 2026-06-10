"use client";

import { useState } from "react";
import {
  Archive,
  Check,
  Inbox,
  Layers,
  Moon,
  Star,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  defaultCustomSnooze,
  formatWake,
  snoozePresets,
} from "@/lib/todos/snooze";
import type { TodoBucket } from "@/lib/todos/types";
import { cn } from "@/lib/utils";

const BUCKET_META: Record<
  TodoBucket,
  { label: string; icon: typeof Star; iconClass: string }
> = {
  inbox: { label: "Inbox", icon: Inbox, iconClass: "text-sky-700" },
  today: { label: "Today", icon: Star, iconClass: "text-amber-500" },
  anytime: { label: "Anytime", icon: Layers, iconClass: "text-teal-700" },
  someday: { label: "Someday", icon: Archive, iconClass: "text-stone-500" },
};

/**
 * Things' "When" control, one chip + one picker: the chip always names the
 * task's current state (Today, Anytime, Someday, Inbox, or its wake time when
 * snoozed) — including Anytime explicitly, where Things confusingly drops the
 * chip. The picker mixes the snooze presets (Today's sibling moments) with the
 * buckets, because they're all the same question: when does this surface?
 */
export function WhenPicker({
  bucket,
  snoozedUntil,
  onSetBucket,
  onSnooze,
  open: openProp,
  onOpenChange,
  triggerClassName,
}: {
  bucket: TodoBucket;
  snoozedUntil: string | null;
  onSetBucket: (bucket: TodoBucket) => void;
  onSnooze: (when: Date) => void;
  /** Controlled open (the keyboard `s` summons it); omit for internal state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerClassName?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [custom, setCustom] = useState("");

  // Recomputed each open so "This evening" drops off after 5pm.
  const presets = open ? snoozePresets() : [];

  const snoozed = !!snoozedUntil;
  const current = snoozed
    ? { label: formatWake(snoozedUntil!), icon: Moon, iconClass: "text-indigo-500" }
    : BUCKET_META[bucket];
  const CurrentIcon = current.icon;

  const pickBucket = (next: TodoBucket) => {
    setOpen(false);
    if (next !== bucket || snoozed) onSetBucket(next);
  };
  const pickSnooze = (when: Date) => {
    setOpen(false);
    onSnooze(when);
  };

  const itemClass =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60";

  const bucketRow = (key: TodoBucket, muted = false) => {
    const meta = BUCKET_META[key];
    const Icon = meta.icon;
    const active = bucket === key && !snoozed;
    return (
      <button
        key={key}
        type="button"
        onClick={() => pickBucket(key)}
        className={cn(itemClass, muted && "text-muted-foreground")}
      >
        <Icon className={cn("size-4", meta.iconClass)} />
        <span className="flex-1 text-left">{meta.label}</span>
        {active && <Check className="size-4 text-primary" />}
      </button>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="When"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-sm text-foreground hover:bg-accent",
              triggerClassName
            )}
          />
        }
      >
        <CurrentIcon className={cn("size-4", current.iconClass)} />
        {current.label}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-0.5 p-1.5">
        {/* Today first, then its sibling moments (Things' order). */}
        {bucketRow("today")}
        {presets.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => pickSnooze(preset.when)}
            className={itemClass}
          >
            <Moon className="size-4 text-indigo-500" />
            <span className="flex-1 text-left">{preset.label}</span>
            <span className="text-xs text-muted-foreground">{preset.hint}</span>
          </button>
        ))}

        <div className="-mx-1 my-1 h-px bg-border" />

        {bucketRow("anytime")}
        {bucketRow("someday")}
        {bucketRow("inbox", true)}

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
                if (!Number.isNaN(when.getTime())) pickSnooze(when);
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
