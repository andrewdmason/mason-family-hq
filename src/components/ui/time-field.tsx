"use client";

// Inline time picker for the event panel: free-typed text ("9", "930", "2:15p")
// parsed on Enter/blur, with a dropdown of 15-minute options. Values are
// minutes since local midnight. The dropdown is rendered in-tree (no portal) so
// clicks inside it are clicks inside the panel — no nested-overlay bookkeeping.
//
// `baseMinutes` turns the options into end-time choices: each shows its
// duration from the base ("10:00 AM (1h)"), starting at the base.

import * as React from "react";

import { cn } from "@/lib/utils";

export function formatMinutes(minutes: number): string {
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function parseTimeText(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/[.\s]/g, "");
  const m = t.match(/^(\d{1,2})(?::?(\d{2}))?(am?|pm?)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  const mer = m[3];
  if (mer?.startsWith("p") && h < 12) h += 12;
  if (mer?.startsWith("a") && h === 12) h = 0;
  if (h > 23) return null;
  return h * 60 + min;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = minutes / 60;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1).replace(/\.0$/, "")}h`;
}

export function TimeField({
  value,
  onChange,
  baseMinutes,
  action,
  disabled,
  className,
}: {
  value: number; // minutes since local midnight
  onChange: (minutes: number) => void;
  // When set, options run from baseMinutes forward and show "(duration)".
  baseMinutes?: number;
  action?: {
    label: string;
    onSelect: () => void;
  };
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState(() => formatMinutes(value));
  const listRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reflect external value changes (e.g. start moved, end follows).
  React.useEffect(() => {
    setText(formatMinutes(value));
  }, [value]);

  const options = React.useMemo(() => {
    if (baseMinutes != null) {
      // End-time options: every 15 min after the start, up to midnight.
      const out: number[] = [];
      for (let m = baseMinutes + 15; m <= 24 * 60; m += 15) out.push(m);
      return out;
    }
    return Array.from({ length: 96 }, (_, i) => i * 15);
  }, [baseMinutes]);

  // Scroll the option nearest the current value into view when opening.
  React.useEffect(() => {
    if (!open || !listRef.current) return;
    const idx = options.findIndex((m) => m >= value);
    const el = listRef.current.children[Math.max(0, idx)] as
      | HTMLElement
      | undefined;
    el?.scrollIntoView({ block: "center" });
  }, [open, options, value]);

  function commitText() {
    const parsed = parseTimeText(text);
    if (parsed != null && parsed !== value) {
      onChange(parsed);
    } else {
      setText(formatMinutes(value)); // revert unparseable input
    }
  }

  return (
    <div className={cn("relative", className)}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        disabled={disabled}
        value={text}
        size={Math.max(text.length, 4)}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => {
          setOpen(true);
          e.target.select();
        }}
        onBlur={() => {
          setOpen(false);
          commitText();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commitText();
            setOpen(false);
            inputRef.current?.blur();
          } else if (e.key === "Escape") {
            setText(formatMinutes(value));
            setOpen(false);
          }
        }}
        className={cn(
          "w-[5.5rem] rounded-md px-1.5 py-0.5 text-sm tabular-nums transition-colors hover:bg-accent focus:bg-accent focus:outline-none disabled:pointer-events-none",
        )}
      />
      {open && !disabled && (
        <div
          // mousedown (not click) so selection wins the race against blur.
          className="absolute top-full left-0 z-10 mt-1 w-max min-w-28 overflow-hidden rounded-lg bg-popover py-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
        >
          {action && (
            <>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  action.onSelect();
                  setOpen(false);
                  inputRef.current?.blur();
                }}
                className="flex w-full items-center px-2.5 py-1.5 text-left text-sm font-medium hover:bg-accent"
              >
                {action.label}
              </button>
              <div className="my-1 border-t border-border/60" />
            </>
          )}
          <div ref={listRef} className="max-h-52 overflow-y-auto">
            {options.map((m) => (
              <button
                key={m}
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(m % (24 * 60));
                  setOpen(false);
                  inputRef.current?.blur();
                }}
                className={cn(
                  "flex w-full items-baseline gap-2 px-2.5 py-1 text-left text-sm tabular-nums hover:bg-accent",
                  m === value && "bg-accent font-medium",
                )}
              >
                {formatMinutes(m % (24 * 60))}
                {baseMinutes != null && (
                  <span className="text-xs text-muted-foreground">
                    {formatDuration(m - baseMinutes)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
