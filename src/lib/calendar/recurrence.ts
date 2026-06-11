// RRULE helpers for the event editor. We only generate the small set of rules
// the repeat picker offers; Google owns expansion, exceptions, and everything
// else RFC5545 — so no recurrence library, just (de)serialization between the
// picker's shape and an RRULE body (the string after "RRULE:").
//
// Shared client/server: pure functions only.

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type RepeatFreq =
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "yearly";

// What the repeat picker can express. `until` is a wall-clock end date
// ("YYYY-MM-DD", inclusive). "custom" = weekly on a chosen set of days.
export type RepeatRule =
  | { freq: RepeatFreq; until?: string }
  | { freq: "custom"; byDay: Weekday[]; until?: string };

const WEEKDAY_LABELS: Record<Weekday, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

// "2026-06-30" -> "20260630T235959Z". Google requires UNTIL in UTC for events
// whose start is a dateTime; end-of-day keeps the last day inclusive in every
// timezone west of UTC (and costs at most one phantom instance east of it).
function untilToRRule(until: string): string {
  return `${until.replaceAll("-", "")}T235959Z`;
}

// "20260630T235959Z" / "20260630" -> "2026-06-30"
function untilFromRRule(value: string): string | undefined {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

export function toRRule(rule: RepeatRule): string {
  const parts: string[] = [];
  if (rule.freq === "custom") {
    parts.push("FREQ=WEEKLY");
    if (rule.byDay.length > 0) {
      const ordered = WEEKDAYS.filter((d) => rule.byDay.includes(d));
      parts.push(`BYDAY=${ordered.join(",")}`);
    }
  } else if (rule.freq === "biweekly") {
    parts.push("FREQ=WEEKLY", "INTERVAL=2");
  } else {
    parts.push(`FREQ=${rule.freq.toUpperCase()}`);
  }
  if (rule.until) parts.push(`UNTIL=${untilToRRule(rule.until)}`);
  return parts.join(";");
}

// Parse an RRULE body back into the picker's shape, or null when the rule says
// something the picker can't (COUNT, ordinal BYDAY like "2TU", BYMONTHDAY,
// intervals beyond 2, ...). Null means "display only" — the panel shows the
// describeRRule() text and the picker is locked to "custom rule".
export function parseRRule(rrule: string): RepeatRule | null {
  const parts = new Map<string, string>();
  for (const piece of rrule.split(";")) {
    const eq = piece.indexOf("=");
    if (eq > 0) parts.set(piece.slice(0, eq).toUpperCase(), piece.slice(eq + 1));
  }

  const freq = parts.get("FREQ");
  if (!freq) return null;
  if (parts.has("COUNT")) return null;
  const interval = Number(parts.get("INTERVAL") ?? "1");
  const until = parts.has("UNTIL")
    ? untilFromRRule(parts.get("UNTIL")!)
    : undefined;
  if (parts.has("UNTIL") && !until) return null;

  // Any selector beyond plain BYDAY-of-week makes the rule picker-inexpressible.
  for (const key of parts.keys()) {
    if (!["FREQ", "INTERVAL", "UNTIL", "BYDAY", "WKST"].includes(key)) {
      return null;
    }
  }

  const byDayRaw = parts.get("BYDAY");
  const byDay = byDayRaw ? byDayRaw.split(",") : [];
  const isPlainWeekday = (d: string): d is Weekday =>
    (WEEKDAYS as readonly string[]).includes(d);
  if (!byDay.every(isPlainWeekday)) return null; // ordinals like "2TU"

  if (freq === "DAILY" && interval === 1 && byDay.length === 0) {
    return { freq: "daily", until };
  }
  if (freq === "WEEKLY" && interval === 1) {
    // A single BYDAY is how Google writes "Weekly on Monday" — same as weekly
    // anchored to the start date. Multiple days is the custom shape.
    if (byDay.length <= 1) return { freq: "weekly", until };
    return { freq: "custom", byDay: byDay as Weekday[], until };
  }
  if (freq === "WEEKLY" && interval === 2 && byDay.length <= 1) {
    return { freq: "biweekly", until };
  }
  if (freq === "MONTHLY" && interval === 1 && byDay.length === 0) {
    return { freq: "monthly", until };
  }
  if (freq === "YEARLY" && interval === 1 && byDay.length === 0) {
    return { freq: "yearly", until };
  }
  return null;
}

function formatUntil(until: string): string {
  const [y, m, d] = until.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Human description: "Weekly", "Every 2 weeks", "Weekly on Mon, Wed",
// "Monthly until Jun 30, 2026". Falls back to a best-effort reading of rules
// the picker can't express so synced events still read sensibly.
export function describeRRule(rrule: string): string {
  const rule = parseRRule(rrule);
  if (rule) {
    let base: string;
    switch (rule.freq) {
      case "daily":
        base = "Daily";
        break;
      case "weekly":
        base = "Weekly";
        break;
      case "biweekly":
        base = "Every 2 weeks";
        break;
      case "monthly":
        base = "Monthly";
        break;
      case "yearly":
        base = "Yearly";
        break;
      case "custom":
        base = `Weekly on ${rule.byDay.map((d) => WEEKDAY_LABELS[d]).join(", ")}`;
        break;
    }
    return rule.until ? `${base} until ${formatUntil(rule.until)}` : base;
  }

  // Best effort for everything else.
  const parts = new Map<string, string>();
  for (const piece of rrule.split(";")) {
    const eq = piece.indexOf("=");
    if (eq > 0) parts.set(piece.slice(0, eq).toUpperCase(), piece.slice(eq + 1));
  }
  const freq = parts.get("FREQ")?.toLowerCase();
  if (!freq) return "Repeats";
  const interval = Number(parts.get("INTERVAL") ?? "1");
  const noun = { daily: "day", weekly: "week", monthly: "month", yearly: "year" }[
    freq
  ];
  let base = noun
    ? interval > 1
      ? `Every ${interval} ${noun}s`
      : `Every ${noun}`
    : "Repeats";
  const count = parts.get("COUNT");
  if (count) base += `, ${count} times`;
  const until = parts.has("UNTIL") ? untilFromRRule(parts.get("UNTIL")!) : null;
  if (until) base += ` until ${formatUntil(until)}`;
  return base;
}
