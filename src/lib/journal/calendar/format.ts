import type { CalendarWindow, FeedResult, NormalizedEvent } from "./types";

function localDateKey(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function formatTime(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")!.value;
  const minute = parts.find((p) => p.type === "minute")!.value;
  const dayPeriod = parts
    .find((p) => p.type === "dayPeriod")!
    .value.toLowerCase()
    .replace(/[^a-z]/g, "");
  return `${hour}:${minute}${dayPeriod}`;
}

function formatDateLabel(isoDate: string, diff: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  // Use UTC noon so DST doesn't shift the weekday.
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).formatToParts(dt);
  const wk = parts.find((p) => p.type === "weekday")!.value;
  const mo = parts.find((p) => p.type === "month")!.value;
  const da = parts.find((p) => p.type === "day")!.value;
  const datePart = `${wk}, ${mo} ${da}`;
  if (diff === -1) return `Yesterday (${datePart})`;
  if (diff === 0) return `Today (${datePart})`;
  if (diff === 1) return `Tomorrow (${datePart})`;
  return datePart;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const slice = text.slice(0, maxLen);
  const space = slice.lastIndexOf(" ");
  if (space >= Math.floor(maxLen * 0.6)) return slice.slice(0, space) + "…";
  return slice + "…";
}

function formatEventLine(ev: NormalizedEvent, tz: string): string {
  const timePart = ev.allDay ? "(all day)" : formatTime(ev.start, tz);
  const locationPart = ev.location ? ` @ ${truncate(ev.location, 40)}` : "";
  const tentativePart = ev.tentative ? "(tentative) " : "";
  return `- ${timePart} ${ev.title}${locationPart} ${tentativePart}[${ev.sourceName}]`;
}

export function formatCalendarBlock(
  results: FeedResult[],
  today: string,
  tz: string,
  now: Date = new Date(),
  // The window decides which days appear (see CalendarWindow):
  // - "recent": looks back `lookbackDays`; today's not-yet-happened timed events
  //   stripped, and nothing forward.
  // - "ahead":  looks back `lookbackDays` plus forward `lookaheadDays` — the only
  //   forward-looking window.
  // Today's all-day events are kept under both windows (ongoing, not
  // scheduled-for-later). The spans scale with a recurring post's cadence (a
  // weekly recap looks back ~7 days, a monthly one ~30) and default to the old
  // fixed 3-back / 7-ahead for every built-in caller.
  window: CalendarWindow = "recent",
  lookbackDays = 3,
  lookaheadDays = window === "ahead" ? 7 : 0,
): string {
  if (results.length === 0) return "";

  const buckets = new Map<string, NormalizedEvent[]>();
  for (let d = -lookbackDays; d <= lookaheadDays; d++) {
    buckets.set(addDaysISO(today, d), []);
  }

  for (const r of results) {
    if (!r.ok) continue;
    for (const ev of r.events) {
      if (ev.allDay && ev.end) {
        // iCal all-day DTEND is exclusive — list on every covered day in window.
        const startKey = localDateKey(ev.start, tz);
        const endKey = localDateKey(ev.end, tz);
        let cursor = startKey;
        let safety = 0;
        while (cursor < endKey && safety < 366) {
          const bucket = buckets.get(cursor);
          if (bucket) bucket.push(ev);
          cursor = addDaysISO(cursor, 1);
          safety++;
        }
        if (safety === 0) {
          // Zero-duration edge case (rare): bucket once at start.
          const bucket = buckets.get(startKey);
          if (bucket) bucket.push(ev);
        }
      } else {
        const key = localDateKey(ev.start, tz);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(ev);
      }
    }
  }

  const failed = results.filter(
    (r): r is Extract<FeedResult, { ok: false }> => !r.ok,
  );

  // All feeds failed → no block.
  if (failed.length === results.length) return "";

  const lines: string[] = [];
  for (let d = -lookbackDays; d <= lookaheadDays; d++) {
    const key = addDaysISO(today, d);
    let dayEvents = buckets.get(key) ?? [];
    // "recent" includes today but only its already-happened/ongoing timed events
    // (all-day events today stay — they're ongoing, not scheduled-for-later).
    if (window === "recent" && d === 0) {
      dayEvents = dayEvents.filter(
        (ev) => ev.allDay || ev.start.getTime() <= now.getTime(),
      );
    }
    if (dayEvents.length === 0) continue;
    dayEvents.sort((a, b) => {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      return a.start.getTime() - b.start.getTime();
    });
    lines.push(formatDateLabel(key, d));
    for (const ev of dayEvents) {
      // Only "today" is ambiguous about past vs. future — other days are
      // settled by their label. Mark today's timed events relative to now so
      // recent vs. upcoming questions don't treat a later-today event as past.
      // An event that's started but not yet ended is "happening now", not
      // "already happened" — otherwise the model can miscast a live 7pm event
      // as something that's over (even "last night").
      let note = "";
      if (d === 0 && !ev.allDay) {
        const nowMs = now.getTime();
        if (ev.start.getTime() > nowMs) {
          note = " — hasn't happened yet";
        } else if (ev.end && ev.end.getTime() > nowMs) {
          note = " — happening now";
        } else {
          note = " — already happened";
        }
      }
      lines.push(formatEventLine(ev, tz) + note);
    }
  }

  // No events anywhere AND no failures → nothing to show.
  if (lines.length === 0 && failed.length === 0) return "";

  for (const f of failed) {
    lines.push(`(Note: "${f.sourceName}" calendar is currently unavailable)`);
  }

  if (lines.length === 0) return "";

  const backPart = `last ${lookbackDays} day${lookbackDays === 1 ? "" : "s"}`;
  const header =
    lookaheadDays > 0
      ? `=== Calendar — ${backPart} + next ${lookaheadDays} ===`
      : `=== Calendar — ${backPart} ===`;
  return [header, ...lines].join("\n");
}
