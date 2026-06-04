"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DatePrecision, TimelineEntryWithPeople } from "@/lib/types";
import { formatTimelineDate } from "@/lib/timeline/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * The widget's value. `precision` (year/month/day) and `isRange` (moment vs
 * period) are the two orthogonal axes the user controls. `start`/`end` are kept
 * at full canonical `YYYY-MM-DD` internally so switching precision never loses
 * the month/day you already picked; they're truncated to the chosen precision
 * only on the way out (see `dateStateToInput`).
 */
export type TimelineDateState = {
  precision: DatePrecision;
  isRange: boolean;
  /** Canonical YYYY-MM-DD, or "" when nothing has been chosen yet. */
  start: string;
  end: string;
};

// ---- value helpers (shared with the modal) --------------------------------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function canon(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}
function partsOf(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number);
  return { y: y || 0, m: m || 1, d: d || 1 };
}
/** "1999-06-01" + month precision -> "1999-06" (what the server action parses). */
function truncate(date: string, precision: DatePrecision): string {
  if (precision === "year") return date.slice(0, 4);
  if (precision === "month") return date.slice(0, 7);
  return date;
}

export function emptyDateState(): TimelineDateState {
  return { precision: "year", isRange: false, start: "", end: "" };
}

/** Rebuild widget state from a stored entry (start/end may carry precision). */
export function dateStateFromEntry(entry: TimelineEntryWithPeople): TimelineDateState {
  return {
    precision: entry.start_precision,
    isRange: Boolean(entry.end_date),
    start: entry.start_date,
    end: entry.end_date ?? "",
  };
}

/** Truncate to the chosen precision for the server action (`start`, `end`). */
export function dateStateToInput(s: TimelineDateState): { start: string; end: string | null } {
  return {
    start: s.start ? truncate(s.start, s.precision) : "",
    end: s.isRange && s.end ? truncate(s.end, s.precision) : null,
  };
}

// ---- calendar math (local, no timezone surprises) -------------------------

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}
/** Cells for a Mon-first month grid; leading blanks are null. */
function monthCells(y: number, m: number): (number | null)[] {
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // 0 = Monday
  const cells: (number | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(d);
  return cells;
}

// ---- small building blocks ------------------------------------------------

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function Cell({
  active,
  muted,
  onClick,
  children,
}: {
  active: boolean;
  muted?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md py-1 text-sm transition-colors",
        active
          ? "bg-foreground font-medium text-background"
          : muted
            ? "text-muted-foreground/50"
            : "text-foreground hover:bg-muted"
      )}
    >
      {children}
    </button>
  );
}

// ---- the picker -----------------------------------------------------------

const YEAR_MIN = 1900;

export function TimelineDatePicker({
  value,
  onChange,
}: {
  value: TimelineDateState;
  onChange: (next: TimelineDateState) => void;
}) {
  const [open, setOpen] = useState(false);
  // Which end of a range the body is currently editing.
  const [editing, setEditing] = useState<"start" | "end">("start");

  const today = new Date();
  const active = editing === "end" && value.isRange ? value.end : value.start;
  const anchor = active ? partsOf(active) : { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() };
  // The currently-selected date for the end we're editing (null when unset).
  const selected = active ? partsOf(active) : null;
  // What the year list scrolls to: the selection, or the current year when the
  // event has no date yet (so a fresh form opens at "now", not 1900).
  const focusYear = selected?.y ?? today.getFullYear();

  // View anchors for navigation (decade for years, year for months, month for days).
  const [viewYear, setViewYear] = useState(anchor.y);
  const [viewMonth, setViewMonth] = useState(anchor.m);

  // Re-center the view whenever we switch which end we're editing, or reopen.
  const editingRef = useRef(editing);
  useEffect(() => {
    if (editingRef.current !== editing || open) {
      editingRef.current = editing;
      setViewYear(anchor.y);
      setViewMonth(anchor.m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, open]);

  // Park the focus year's row at the BOTTOM of the year list when the view
  // opens: recent years are what you usually reach for, so a fresh form lands on
  // "now" with the long tail of old years scrolled away. Deferred to a rAF so
  // the popover's open-zoom animation has mounted, and computed from offset*
  // metrics (transform-independent, unlike getBoundingClientRect) so that
  // animation can't skew the measurement.
  const yearListRef = useRef<HTMLDivElement>(null);
  const selectedYearRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || value.precision !== "year") return;
    const id = requestAnimationFrame(() => {
      const list = yearListRef.current;
      const target = selectedYearRef.current;
      if (!list || !target) return;
      const top = target.offsetTop - list.offsetTop + target.offsetHeight - list.clientHeight;
      list.scrollTop = Math.max(0, top);
    });
    return () => cancelAnimationFrame(id);
  }, [open, value.precision, focusYear]);

  function commit(date: string) {
    if (editing === "end" && value.isRange) {
      onChange({ ...value, end: date < value.start ? value.start : date });
      return;
    }
    const next: TimelineDateState = { ...value, start: date };
    if (value.isRange && (!next.end || next.end < date)) next.end = date;
    onChange(next);
    if (value.isRange) setEditing("end"); // advance start -> end
  }

  function pickYear(y: number) {
    commit(canon(y, anchor.m, anchor.d));
  }
  function pickMonth(m: number) {
    commit(canon(viewYear, m, anchor.d));
  }
  function pickDay(d: number) {
    commit(canon(viewYear, viewMonth, d));
  }

  function setPrecision(precision: DatePrecision) {
    onChange({ ...value, precision });
  }
  function setRange(isRange: boolean) {
    if (isRange) {
      onChange({ ...value, isRange: true, end: value.end || value.start });
      setEditing(value.start ? "end" : "start");
    } else {
      onChange({ ...value, isRange: false });
      setEditing("start");
    }
  }

  const triggerLabel = (() => {
    if (!value.start) return "Pick a date";
    const start = formatTimelineDate(value.start, value.precision);
    if (!value.isRange) return start;
    if (!value.end) return `${start} – …`;
    return `${start} – ${formatTimelineDate(value.end, value.precision)}`;
  })();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex w-full items-center justify-between rounded-md border border-border bg-background px-2.5 py-1.5 text-left text-sm focus:outline-none focus:ring-2 focus:ring-ring",
          !value.start && "text-muted-foreground"
        )}
      >
        {triggerLabel}
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 gap-3">
        {/* Axis 1: moment vs period */}
        <div className="flex gap-1.5">
          <Pill active={!value.isRange} onClick={() => setRange(false)}>
            Date
          </Pill>
          <Pill active={value.isRange} onClick={() => setRange(true)}>
            Range
          </Pill>
        </div>

        {/* Axis 2: precision */}
        <div className="flex gap-1.5">
          {(["day", "month", "year"] as DatePrecision[]).map((p) => (
            <Pill key={p} active={value.precision === p} onClick={() => setPrecision(p)}>
              {p[0].toUpperCase() + p.slice(1)}
            </Pill>
          ))}
        </div>

        {value.isRange && (
          <div className="flex gap-1.5 border-t border-border pt-2.5">
            <Pill active={editing === "start"} onClick={() => setEditing("start")}>
              {value.start ? `Start · ${formatTimelineDate(value.start, value.precision)}` : "Start"}
            </Pill>
            <Pill active={editing === "end"} onClick={() => setEditing("end")}>
              {value.end ? `End · ${formatTimelineDate(value.end, value.precision)}` : "End"}
            </Pill>
          </div>
        )}

        {/* Body: precision-specific picker */}
        {value.precision === "year" && (
          <div ref={yearListRef} className="grid max-h-56 grid-cols-3 gap-1 overflow-y-auto pr-0.5">
            {Array.from({ length: today.getFullYear() + 10 - YEAR_MIN + 1 }, (_, i) => YEAR_MIN + i).map((y) => {
              const isSel = selected?.y === y;
              return (
                <button
                  key={y}
                  type="button"
                  ref={y === focusYear ? selectedYearRef : undefined}
                  onClick={() => pickYear(y)}
                  className={cn(
                    "rounded-md py-1 text-sm transition-colors",
                    isSel ? "bg-foreground font-medium text-background" : "text-foreground hover:bg-muted"
                  )}
                >
                  {y}
                </button>
              );
            })}
          </div>
        )}

        {value.precision === "month" && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setViewYear((y) => y - 1)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label="Previous year"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium">{viewYear}</span>
              <button
                type="button"
                onClick={() => setViewYear((y) => y + 1)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label="Next year"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {MONTHS.map((label, i) => (
                <Cell
                  key={label}
                  active={selected?.y === viewYear && selected?.m === i + 1}
                  onClick={() => pickMonth(i + 1)}
                >
                  {label}
                </Cell>
              ))}
            </div>
          </div>
        )}

        {value.precision === "day" && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  if (viewMonth === 1) {
                    setViewMonth(12);
                    setViewYear((y) => y - 1);
                  } else setViewMonth((m) => m - 1);
                }}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium">
                {MONTHS[viewMonth - 1]} {viewYear}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (viewMonth === 12) {
                    setViewMonth(1);
                    setViewYear((y) => y + 1);
                  } else setViewMonth((m) => m + 1);
                }}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w) => (
                <span key={w} className="py-1 text-center text-xs text-muted-foreground">
                  {w}
                </span>
              ))}
              {monthCells(viewYear, viewMonth).map((d, i) =>
                d === null ? (
                  <span key={`blank-${i}`} />
                ) : (
                  <Cell
                    key={d}
                    active={selected?.y === viewYear && selected?.m === viewMonth && selected?.d === d}
                    onClick={() => pickDay(d)}
                  >
                    {d}
                  </Cell>
                )
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end border-t border-border pt-2.5">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-1 text-sm font-medium text-foreground hover:bg-muted"
          >
            Done
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
