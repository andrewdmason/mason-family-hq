"use client";

import { useState, useTransition } from "react";
import {
  CalendarClock,
  ClipboardList,
  ChevronDown,
  Copy,
  Check,
  RefreshCw,
  Loader2,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { reimportSession } from "@/app/(workouts)/workouts/actions";

/**
 * The session's date + source line, clickable to reveal the original imported
 * text (with a copy button) and a Reimport action that wipes the parsed
 * movements and re-imports from that text as if for the first time.
 */
export function CalendarSourcePopover({
  sessionId,
  source,
  dateLabel,
  rawDescription,
}: {
  sessionId: string;
  source: string;
  dateLabel: string;
  rawDescription: string;
}) {
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const isCalendar = source === "calendar";
  const Icon = isCalendar ? CalendarClock : ClipboardList;
  const label = isCalendar ? "From calendar" : "Logged";

  async function copy() {
    try {
      await navigator.clipboard.writeText(rawDescription);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; nothing to do but no-op.
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        }
      >
        <Icon className="size-3.5" />
        {dateLabel}
        <span className="text-muted-foreground/50">·</span>
        {label}
        <ChevronDown className="size-3 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">
            {isCalendar ? "Calendar entry" : "Imported text"}
          </span>
          <button
            type="button"
            onClick={copy}
            aria-label="Copy to clipboard"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {copied ? (
              <Check className="size-3.5 text-primary" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs leading-relaxed text-foreground">
          {rawDescription}
        </div>

        <div className="flex flex-col gap-1">
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => reimportSession(sessionId))}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {pending ? "Reimporting…" : "Reimport"}
          </button>
          <p className="text-[11px] text-muted-foreground">
            Deletes the current movements and re-imports from this text.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
