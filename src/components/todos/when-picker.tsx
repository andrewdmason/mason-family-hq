"use client";

import { useState } from "react";
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
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
import { formatWake, snoozePresets } from "@/lib/todos/snooze";
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
 * Things' "When" control, one chip + one picker. The chip always names the
 * task's current state (Today, Anytime, Someday, Inbox, or its wake time when
 * snoozed); the picker offers Today, This evening, a mini calendar (a day
 * click snoozes until that day at the time below it), then Anytime and
 * Someday. Inbox is deliberately NOT a destination here — it's the absence of
 * triage, a location: a task leaves it by getting a When (or a project), and
 * returns only via the project picker's "Inbox".
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

  // Recomputed each open so "This evening" drops off after 5pm.
  const evening = open
    ? snoozePresets().find((preset) => preset.key === "evening")
    : undefined;

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

  const bucketRow = (key: Exclude<TodoBucket, "inbox">) => {
    const meta = BUCKET_META[key];
    const Icon = meta.icon;
    const active = bucket === key && !snoozed;
    return (
      <button
        key={key}
        type="button"
        onClick={() => pickBucket(key)}
        className={itemClass}
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
        {/* Things' order: Today, This Evening, the calendar, then the parks. */}
        {bucketRow("today")}
        {evening && (
          <button
            type="button"
            onClick={() => pickSnooze(evening.when)}
            className={itemClass}
          >
            <Moon className="size-4 text-indigo-500" />
            <span className="flex-1 text-left">{evening.label}</span>
            <span className="text-xs text-muted-foreground">{evening.hint}</span>
          </button>
        )}

        {open && <MiniCalendar onPick={pickSnooze} />}

        <div className="-mx-1 my-1 h-px bg-border" />

        {bucketRow("anytime")}
        {bucketRow("someday")}
      </PopoverContent>
    </Popover>
  );
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MORNING = "09:00";

/**
 * Things' inline month grid: today is the star, past days fade out, a day
 * click snoozes until that day at the time in the footer row.
 */
function MiniCalendar({ onPick }: { onPick: (when: Date) => void }) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [monthStart, setMonthStart] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [time, setTime] = useState(MORNING);

  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = new Date(year, month, 1).getDay();
  const onCurrentMonth =
    year === today.getFullYear() && month === today.getMonth();

  const pickDay = (day: number) => {
    const [hh, mm] = time.split(":").map(Number);
    onPick(new Date(year, month, day, hh || 9, mm || 0));
  };

  const monthLabel = monthStart.toLocaleDateString("en-US", {
    month: "long",
    ...(year !== today.getFullYear() ? { year: "numeric" } : {}),
  });

  return (
    <div className="px-1.5 py-1">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {monthLabel}
        </span>
        <span className="flex items-center">
          <button
            type="button"
            aria-label="Previous month"
            disabled={onCurrentMonth}
            onClick={() => setMonthStart(new Date(year, month - 1, 1))}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:opacity-30"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonthStart(new Date(year, month + 1, 1))}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </span>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {WEEKDAYS.map((day) => (
          <span key={day} className="text-[10px] font-medium text-muted-foreground/70">
            {day}
          </span>
        ))}
        {Array.from({ length: leadingBlanks }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const date = new Date(year, month, day);
          const isPast = date < today;
          const isToday = onCurrentMonth && day === today.getDate();
          return (
            <button
              key={day}
              type="button"
              disabled={isPast}
              onClick={() => pickDay(day)}
              aria-label={isToday ? "Today" : undefined}
              className={cn(
                "mx-auto flex size-7 items-center justify-center rounded-full text-xs tabular-nums",
                isPast
                  ? "text-muted-foreground/30"
                  : "text-foreground hover:bg-accent"
              )}
            >
              {isToday ? (
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
              ) : (
                day
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-1 flex items-center justify-end gap-1.5 pr-1">
        <span className="text-[10px] text-muted-foreground">at</span>
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value || MORNING)}
          className="rounded border border-border bg-background px-1 py-0.5 text-[10px] text-muted-foreground"
          aria-label="Wake time"
        />
      </div>
    </div>
  );
}
