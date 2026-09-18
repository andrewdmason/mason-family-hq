"use client";

import { useCallback, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MiniCalendar } from "@/components/ui/mini-calendar";
import { AggregateTimerPill } from "@/components/practice-table/aggregate-timer-pill";
import { usePracticeDay } from "@/components/practice-table/practice-day-context";
import { getPracticedDates } from "@/app/practice/feed/actions";
import { addDays, localDate } from "@/lib/date-utils";
import { cn } from "@/lib/utils";

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function distancePhrase(days: number): string {
  const n = Math.abs(days);
  let span: string;
  if (n < 14) span = `${n} days`;
  else if (n < 60) span = `${Math.round(n / 7)} weeks`;
  else if (n < 730) span = `${Math.round(n / 30.4)} months`;
  else span = `${Math.round(n / 365)} years`;
  return days < 0 ? `${span} ago` : `in ${span}`;
}

/**
 * The day's name as a heading, plus a quieter line that places it: the full
 * date under "Today"/"Yesterday"/"Tomorrow", or how far away it is otherwise.
 */
export function describeDay(date: string, today: string) {
  const d = new Date(`${date}T12:00:00`);
  const offset = daysBetween(today, date);
  const fullDate = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  if (offset === 0) return { title: "Today", detail: fullDate };
  if (offset === -1) return { title: "Yesterday", detail: fullDate };
  if (offset === 1) return { title: "Tomorrow", detail: fullDate };
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return {
    title: d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    }),
    detail: distancePhrase(offset),
  };
}

/**
 * The practice log's page title: which day is on screen, arrows to step
 * through the calendar, the day's total, and a way home when you've wandered.
 * Clicking the name opens a month with the days that have practice marked.
 */
export function DayTitle({ hideNavigation }: { hideNavigation: boolean }) {
  const { today, viewDate, isToday, goToDate, dayStats } = usePracticeDay();
  const { title, detail } = describeDay(viewDate, today);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [markedDates, setMarkedDates] = useState<Set<string>>(new Set());

  const loadMarks = useCallback((month: Date) => {
    // The grid spills into the neighbouring months, so over-fetch a week each way.
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const start = addDays(localDate(first), -7);
    const end = addDays(localDate(last), 7);
    void getPracticedDates(start, end)
      .then((dates) => setMarkedDates((prev) => new Set([...prev, ...dates])))
      .catch(() => {});
  }, []);

  const showStats = dayStats.elapsedSeconds > 0 || dayStats.goalSeconds > 0;

  return (
    <div className="flex min-w-0 items-center gap-x-3 gap-y-1 flex-wrap">
      <div className="-ml-1.5 flex items-center">
        {!hideNavigation && (
          <button
            type="button"
            onClick={() => goToDate(addDays(viewDate, -1))}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Previous day ([)"
            aria-label="Previous day"
          >
            <ChevronLeftIcon className="size-5" />
          </button>
        )}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            disabled={hideNavigation}
            className={cn(
              "rounded-md px-1.5 font-serif text-2xl tracking-tight text-foreground",
              !hideNavigation && "hover:bg-accent",
            )}
            title={hideNavigation ? undefined : "Go to a date"}
          >
            {title}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64">
            <MiniCalendar
              selected={new Date(`${viewDate}T12:00:00`)}
              markedDates={markedDates}
              onMonthChange={loadMarks}
              onSelect={(d) => {
                goToDate(localDate(d));
                setPickerOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        {!hideNavigation && (
          <button
            type="button"
            onClick={() => goToDate(addDays(viewDate, 1))}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Next day (])"
            aria-label="Next day"
          >
            <ChevronRightIcon className="size-5" />
          </button>
        )}
      </div>
      <span className="hidden text-sm text-muted-foreground sm:inline">
        {detail}
      </span>
      {showStats && (
        <AggregateTimerPill
          elapsedSeconds={dayStats.elapsedSeconds}
          goalSeconds={dayStats.goalSeconds}
          size="md"
        />
      )}
      {!isToday && (
        <button
          type="button"
          onClick={() => goToDate(today)}
          className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Back to today (T)"
        >
          Today
        </button>
      )}
    </div>
  );
}
