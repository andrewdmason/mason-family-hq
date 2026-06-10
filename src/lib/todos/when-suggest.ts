/**
 * Natural-language "when" suggestions for the type-ahead in the When picker.
 * Deliberately not a full date grammar — just the phrases you'd actually type
 * with hands on the keyboard: "tom", "fri", "next week", "in 3 days", "jun 24",
 * "6/24", a bare day-of-month. Pure function of (input, now) so it's testable;
 * day-level results are midnight timestamps (matching the snooze presets) and
 * bucket names ("today", "anytime", "someday") resolve to buckets, not dates.
 */

import type { TodoBucket } from "@/lib/todos/types";

export type WhenSuggestion =
  | { kind: "bucket"; bucket: Exclude<TodoBucket, "inbox">; label: string }
  | { kind: "snooze"; when: Date; label: string; hint: string };

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Midnight, `days` days after `now`. */
function dayAfter(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

function hintFor(when: Date): string {
  return when.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "Tomorrow", "Friday", "Jun 24" — how a midnight wake reads as a row label. */
function dayLabel(when: Date, now: Date): string {
  const diff = Math.round(
    (when.getTime() - dayAfter(now, 0).getTime()) / 86_400_000
  );
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff < 7)
    return when.toLocaleDateString("en-US", { weekday: "long" });
  return when.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const MAX_SUGGESTIONS = 6;

export function suggestWhen(
  raw: string,
  now: Date = new Date()
): WhenSuggestion[] {
  const q = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return [];

  const out: WhenSuggestion[] = [];
  const seen = new Set<string>();
  const day = (when: Date, label?: string) => {
    const key = `${when.getTime()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      kind: "snooze",
      when,
      label: label ?? dayLabel(when, now),
      hint: hintFor(when),
    });
  };
  const bucket = (b: Exclude<TodoBucket, "inbox">, label: string) => {
    if (label.toLowerCase().startsWith(q)) out.push({ kind: "bucket", bucket: b, label });
  };

  // Buckets by name — "today" is the Today list, not a date.
  bucket("today", "Today");

  // Tomorrow, with the common abbreviations.
  if ("tomorrow".startsWith(q) || ["tm", "tmr", "tmrw", "tom"].includes(q)) {
    day(dayAfter(now, 1), "Tomorrow");
  }

  // Tonight / this evening — the one suggestion with a real time of day.
  if (
    "tonight".startsWith(q) ||
    "this evening".startsWith(q) ||
    "evening".startsWith(q)
  ) {
    const evening = new Date(now);
    evening.setHours(17, 0, 0, 0);
    if (evening > now) {
      out.push({
        kind: "snooze",
        when: evening,
        label: "This evening",
        hint: "5:00 PM",
      });
    }
  }

  // Weekday names, optionally "next "-prefixed. Two letters minimum so a lone
  // "s"/"t" doesn't spray every day of the week into the list.
  const nextPrefixed = q.startsWith("next ");
  const wd = nextPrefixed ? q.slice(5) : q;
  if (wd.length >= 2) {
    WEEKDAYS.forEach((name, idx) => {
      if (!name.startsWith(wd)) return;
      let days = (idx - now.getDay() + 7) % 7 || 7;
      if (nextPrefixed && days < 7) days += 7; // "next fri" said on a Thu → next week's
      day(dayAfter(now, days));
    });
  }

  if ("this weekend".startsWith(q) || "weekend".startsWith(q)) {
    const days = (6 - now.getDay() + 7) % 7 || 7;
    day(dayAfter(now, days), "This weekend");
  }
  if ("next week".startsWith(q)) {
    const days = (1 - now.getDay() + 7) % 7 || 7;
    day(dayAfter(now, days), "Next week");
  }
  if ("next month".startsWith(q)) {
    day(new Date(now.getFullYear(), now.getMonth() + 1, 1), "Next month");
  }

  // Relative: "3d", "in 3 days", "3 days from now", "2 weeks", "1 month".
  const rel = q.match(
    /^(?:in )?(\d+) ?(d|day|days|w|wk|week|weeks|mo|month|months)( from now)?$/
  );
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    const when = unit.startsWith("d")
      ? dayAfter(now, n)
      : unit.startsWith("w")
        ? dayAfter(now, n * 7)
        : new Date(now.getFullYear(), now.getMonth() + n, now.getDate());
    if (n > 0) day(when, `In ${n} ${unit[0] === "d" ? "day" : unit[0] === "w" ? "week" : "month"}${n === 1 ? "" : "s"}`);
  }

  // Bare day-of-month: "24" → the next 24th.
  const dom = q.match(/^(\d{1,2})$/);
  if (dom) {
    const d = Number(dom[1]);
    if (d >= 1 && d <= 31) {
      for (let m = 0; m < 3; m++) {
        const when = new Date(now.getFullYear(), now.getMonth() + m, d);
        const valid = when.getDate() === d; // skip months without that day
        if (valid && when > now) {
          day(when);
          break;
        }
      }
    }
  }

  // Month-name + day ("jun 24", "june 24") and numeric M/D ("6/24").
  const named = q.match(/^([a-z]{3,}) (\d{1,2})$/);
  const numeric = q.match(/^(\d{1,2})[/.](\d{1,2})$/);
  let month = -1;
  let dayNum = 0;
  if (named) {
    month = MONTHS.findIndex((name) => name.startsWith(named[1]));
    dayNum = Number(named[2]);
  } else if (numeric) {
    month = Number(numeric[1]) - 1;
    dayNum = Number(numeric[2]);
  }
  if (month >= 0 && month < 12 && dayNum >= 1 && dayNum <= 31) {
    let when = new Date(now.getFullYear(), month, dayNum);
    if (when <= now) when = new Date(now.getFullYear() + 1, month, dayNum);
    if (when.getDate() === dayNum) day(when);
  }

  bucket("anytime", "Anytime");
  bucket("someday", "Someday");

  return out.slice(0, MAX_SUGGESTIONS);
}
