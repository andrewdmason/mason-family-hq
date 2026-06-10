"use client";

import { useState, type ReactNode } from "react";
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
import { suggestWhen, type WhenSuggestion } from "@/lib/todos/when-suggest";
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

const itemClass =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/60";

/**
 * Things' "When" control, one chip + one picker. The chip always names the
 * task's current state (Today, Anytime, Someday, Inbox, or its wake time when
 * snoozed); the picker opens to a focused type-ahead ("tom", "fri", "in 3
 * days"…) above Today, This evening, a mini calendar (a day click snoozes
 * until that day at the time below it), then Anytime and Someday. Inbox is
 * deliberately NOT a destination here — it's the absence of triage, a
 * location: a task leaves it by getting a When (or a project), and returns
 * only via the project picker's "Inbox".
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
  const pickSuggestion = (s: WhenSuggestion) => {
    if (s.kind === "bucket") pickBucket(s.bucket);
    else pickSnooze(s.when);
  };

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
        {/* Mounted only while open so the query resets on every summon. */}
        {open && (
          <WhenTypeahead onPick={pickSuggestion}>
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

            <MiniCalendar onPick={pickSnooze} />

            <div className="-mx-1 my-1 h-px bg-border" />

            {bucketRow("anytime")}
            {bucketRow("someday")}
          </WhenTypeahead>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The hands-on-keyboard path: a focused input above the preset list. Empty
 * query shows `children` (the usual presets + calendar); typing swaps in
 * parsed suggestions ("tom", "fri", "in 3 days", "jun 24"…) navigable with
 * arrows + Enter. Lives in its own component, mounted per-open, so the query
 * and highlight reset on every summon without effect gymnastics.
 */
function WhenTypeahead({
  onPick,
  children,
}: {
  onPick: (s: WhenSuggestion) => void;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const suggestions = query.trim() ? suggestWhen(query) : [];

  return (
    <>
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && suggestions.length > 0) {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp" && suggestions.length > 0) {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && suggestions.length > 0) {
            e.preventDefault();
            onPick(suggestions[Math.min(activeIdx, suggestions.length - 1)]);
          }
        }}
        placeholder="Try “tomorrow” or “in 3 days”"
        aria-label="When"
        className="mb-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-ring"
      />

      {!query.trim() ? (
        children
      ) : suggestions.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          No match — try “tomorrow”, “fri”, or “jun 24”
        </p>
      ) : (
        suggestions.map((s, i) => {
          const Icon = s.kind === "bucket" ? BUCKET_META[s.bucket].icon : Moon;
          const iconClass =
            s.kind === "bucket"
              ? BUCKET_META[s.bucket].iconClass
              : "text-indigo-500";
          return (
            <button
              key={s.kind === "snooze" ? s.when.getTime() : s.bucket}
              type="button"
              onClick={() => onPick(s)}
              onMouseEnter={() => setActiveIdx(i)}
              className={cn(itemClass, i === activeIdx && "bg-accent/60")}
            >
              <Icon className={cn("size-4", iconClass)} />
              <span className="flex-1 text-left">{s.label}</span>
              {s.kind === "snooze" && (
                <span className="text-xs text-muted-foreground">{s.hint}</span>
              )}
            </button>
          );
        })
      )}
    </>
  );
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
// Day picks wake at midnight (in Today first thing); the footer input is only
// for when a specific time of day actually matters.
const DAY_START = "00:00";

/**
 * Things' inline month grid: today is the star, past days fade out, a day
 * click snoozes until that day at the time in the footer row.
 */
export function MiniCalendar({ onPick }: { onPick: (when: Date) => void }) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [monthStart, setMonthStart] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [time, setTime] = useState(DAY_START);

  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = new Date(year, month, 1).getDay();
  const onCurrentMonth =
    year === today.getFullYear() && month === today.getMonth();

  const pickDay = (day: number) => {
    const [hh, mm] = time.split(":").map(Number);
    onPick(new Date(year, month, day, hh || 0, mm || 0));
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
          onChange={(e) => setTime(e.target.value || DAY_START)}
          className="rounded border border-border bg-background px-1 py-0.5 text-[10px] text-muted-foreground"
          aria-label="Wake time"
        />
      </div>
    </div>
  );
}
