/**
 * Natural-language "when" suggestions for the type-ahead in the When picker.
 * Deliberately not a full date grammar — just the phrases you'd actually type
 * with hands on the keyboard: "tom", "fri", "next week", "in 3 days", "jun 24",
 * "6/24", a bare day-of-month, each optionally carrying a time of day
 * ("today 10am", "fri 9:30", "tomorrow evening"). Pure function of (input, now)
 * so it's testable; day-level results are midnight timestamps (matching the
 * snooze presets) and bucket names ("today", "anytime", "someday") resolve to
 * buckets, not dates — unless a time is attached, which makes them real wakes.
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

/** Times of day you'd type as a word rather than a clock reading. */
const NAMED_TIMES: {
  name: string;
  hour: number;
  minute: number;
  /** "Tonight" means tonight — it never rolls forward to tomorrow. */
  todayOnly?: boolean;
}[] = [
  { name: "morning", hour: 9, minute: 0 },
  { name: "noon", hour: 12, minute: 0 },
  { name: "midday", hour: 12, minute: 0 },
  { name: "afternoon", hour: 14, minute: 0 },
  { name: "evening", hour: 17, minute: 0 },
  { name: "tonight", hour: 17, minute: 0, todayOnly: true },
  { name: "night", hour: 20, minute: 0 },
  { name: "midnight", hour: 0, minute: 0 },
];

type TimeOfDay = { hour: number; minute: number; todayOnly?: boolean };

/** Midnight, `days` days after `now`. */
function dayAfter(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

function withTime(day: Date, time: TimeOfDay): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    time.hour,
    time.minute
  );
}

function hintFor(when: Date): string {
  return when.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function timeHint(when: Date): string {
  return when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "Today", "Tomorrow", "Friday", "Jun 24" — how a wake reads as a row label. */
function dayLabel(when: Date, now: Date): string {
  const diff = Math.round(
    (new Date(when.getFullYear(), when.getMonth(), when.getDate()).getTime() -
      dayAfter(now, 0).getTime()) /
      86_400_000
  );
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff < 7)
    return when.toLocaleDateString("en-US", { weekday: "long" });
  return when.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Peel a trailing time of day off the query: "tomorrow 10am" → "tomorrow" plus
 * 10:00. Only unambiguous forms count — a meridiem, a colon, or a named time —
 * so "jun 24", "6/24" and a bare day-of-month still read as dates.
 */
function splitTime(q: string): { base: string; time: TimeOfDay | null } {
  // Drop the connector ("tomorrow at noon") and the "this" of "this evening".
  // The connector only counts as its own word — "sat" doesn't end in an "at".
  const rest = (base: string) =>
    base.replace(/(?:^|\s)(?:@|at)$/, "").replace(/^this$/, "").trim();

  const clock = q.match(
    /^(?:(.*?)\s+)?(?:(?:@|at)\s*)?(\d{1,2})(?::(\d{2}))?\s*(am?|pm?)?$/
  );
  if (clock && (clock[3] !== undefined || clock[4])) {
    let hour = Number(clock[2]);
    const minute = clock[3] ? Number(clock[3]) : 0;
    const meridiem = clock[4]?.[0];
    const valid =
      minute < 60 && (meridiem ? hour >= 1 && hour <= 12 : hour < 24);
    if (valid) {
      if (meridiem === "a" && hour === 12) hour = 0;
      if (meridiem === "p" && hour < 12) hour += 12;
      return { base: rest(clock[1] ?? ""), time: { hour, minute } };
    }
  }

  // Named times, three letters in ("eve", "noon", "tonight"). Shorter than that
  // and a lone prefix would swallow queries that mean a day.
  const words = q.split(" ");
  const last = words[words.length - 1];
  const named =
    last.length >= 3 ? NAMED_TIMES.find((t) => t.name.startsWith(last)) : undefined;
  if (named) {
    return {
      base: rest(words.slice(0, -1).join(" ")),
      time: { hour: named.hour, minute: named.minute, todayOnly: named.todayOnly },
    };
  }

  return { base: q, time: null };
}

/**
 * Every day the query names, at midnight, in the order they should be offered.
 * `includeToday` is for the timed path only: on its own "today" is the Today
 * list, but "today 10am" is a real moment.
 */
function matchDays(
  q: string,
  now: Date,
  includeToday: boolean
): { when: Date; label?: string }[] {
  const out: { when: Date; label?: string }[] = [];
  const seen = new Set<number>();
  const day = (when: Date, label?: string) => {
    if (seen.has(when.getTime())) return;
    seen.add(when.getTime());
    out.push({ when, label });
  };

  // Dates spelled out ("aug 4", "the 4th") are only "already gone" once the day
  // itself is — a time is still coming up later today. Without one, midnight
  // has passed, so today's date means next month's / next year's.
  const cutoff = includeToday ? dayAfter(now, 0) : now;

  if (includeToday && "today".startsWith(q)) day(dayAfter(now, 0), "Today");

  // Tomorrow, with the common abbreviations.
  if ("tomorrow".startsWith(q) || ["tm", "tmr", "tmrw", "tom"].includes(q)) {
    day(dayAfter(now, 1), "Tomorrow");
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
        if (valid && when >= cutoff) {
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
    if (when < cutoff) when = new Date(now.getFullYear() + 1, month, dayNum);
    if (when.getDate() === dayNum) day(when);
  }

  return out;
}

const MAX_SUGGESTIONS = 6;

export function suggestWhen(
  raw: string,
  now: Date = new Date()
): WhenSuggestion[] {
  const q = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return [];

  const { base, time } = splitTime(q);

  // A time of day turns the whole query into real moments — no bucket rows, and
  // the day is always spelled out in the label so "9:30" can't be mistaken for
  // the wrong Friday. A bare time means the next time it comes round.
  if (time) {
    const out: WhenSuggestion[] = [];
    const seen = new Set<number>();
    const days = base ? matchDays(base, now, true) : [{ when: dayAfter(now, 0) }];
    for (const day of days) {
      let when = withTime(day.when, time);
      if (when <= now && !base && !time.todayOnly) {
        when = withTime(dayAfter(now, 1), time);
      }
      if (when <= now || seen.has(when.getTime())) continue;
      seen.add(when.getTime());
      out.push({
        kind: "snooze",
        when,
        label: dayLabel(when, now),
        hint: timeHint(when),
      });
    }
    return out.slice(0, MAX_SUGGESTIONS);
  }

  const out: WhenSuggestion[] = [];
  const bucket = (b: Exclude<TodoBucket, "inbox">, label: string) => {
    if (label.toLowerCase().startsWith(q)) out.push({ kind: "bucket", bucket: b, label });
  };

  // Buckets by name — "today" is the Today list, not a date.
  bucket("today", "Today");

  for (const day of matchDays(q, now, false)) {
    out.push({
      kind: "snooze",
      when: day.when,
      label: day.label ?? dayLabel(day.when, now),
      hint: hintFor(day.when),
    });
  }

  bucket("anytime", "Anytime");
  bucket("someday", "Someday");

  return out.slice(0, MAX_SUGGESTIONS);
}
