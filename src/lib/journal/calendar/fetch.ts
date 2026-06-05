import IcalExpander from "ical-expander";
import type { CalendarSource, FeedResult, NormalizedEvent } from "./types";

// Minimal view of ical.js Event / occurrence shapes — `ical-expander`'s
// declarations reference `ical.js` which ships no types of its own, so we
// project just what we touch here.
type IcalTime = {
  toJSDate(): Date;
  isDate: boolean;
  // Wall-clock components (month is 1-12). Present on every ical.js Time.
  year: number;
  month: number;
  day: number;
};

// All-day (date-only) values are floating wall-clock dates with no timezone.
// ical.js's toJSDate() anchors them at midnight in the *runtime's* local zone,
// so the resulting instant — and the calendar day it lands on — depends on
// where the server runs (UTC in prod, but Pacific locally). Pin the wall-clock
// date to midnight UTC instead so the event's day is stable everywhere; callers
// must then read all-day days in UTC, never the viewer's timezone.
function toEventDate(t: IcalTime): Date {
  if (t.isDate) {
    return new Date(Date.UTC(t.year, t.month - 1, t.day));
  }
  return t.toJSDate();
}

type IcalEvent = {
  uid: string;
  summary: string | null;
  location: string | null;
  startDate: IcalTime;
  endDate: IcalTime;
  component: {
    getFirstPropertyValue(name: string): string | null;
  };
};

type IcalOccurrence = {
  item: IcalEvent;
  startDate: IcalTime;
  endDate: IcalTime;
};

function classify(ev: IcalEvent): { skip: boolean; tentative: boolean } {
  const klass = ev.component.getFirstPropertyValue("class");
  const status = ev.component.getFirstPropertyValue("status");
  const transp = ev.component.getFirstPropertyValue("transp");
  if (typeof klass === "string" && klass.toUpperCase() === "PRIVATE") {
    return { skip: true, tentative: false };
  }
  if (typeof status === "string" && status.toUpperCase() === "CANCELLED") {
    return { skip: true, tentative: false };
  }
  const summary = (ev.summary ?? "").trim();
  if (
    typeof transp === "string" &&
    transp.toUpperCase() === "TRANSPARENT" &&
    summary.length === 0
  ) {
    return { skip: true, tentative: false };
  }
  const tentative =
    typeof status === "string" && status.toUpperCase() === "TENTATIVE";
  return { skip: false, tentative };
}

function normalize(
  source: CalendarSource,
  ev: IcalEvent,
  start: IcalTime,
  end: IcalTime | null,
  tentative: boolean,
): NormalizedEvent | null {
  const title = (ev.summary ?? "").trim();
  if (title.length === 0) return null;
  return {
    sourceId: source.id,
    sourceName: source.displayName,
    title,
    start: toEventDate(start),
    end: end ? toEventDate(end) : null,
    allDay: start.isDate,
    location: ev.location ? ev.location.trim() : null,
    tentative,
  };
}

export async function fetchAndParseFeed(
  source: CalendarSource,
  rangeStart: Date,
  rangeEnd: Date,
  timeoutMs = 5000,
): Promise<FeedResult> {
  try {
    const res = await fetch(source.feedUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        ok: false,
        sourceId: source.id,
        sourceName: source.displayName,
        error: `HTTP ${res.status}`,
      };
    }
    const ics = await res.text();
    const expander = new IcalExpander({ ics, maxIterations: 1000 });
    const expanded = expander.between(rangeStart, rangeEnd) as {
      events: IcalEvent[];
      occurrences: IcalOccurrence[];
    };

    const out: NormalizedEvent[] = [];

    for (const ev of expanded.events) {
      const { skip, tentative } = classify(ev);
      if (skip) continue;
      const n = normalize(source, ev, ev.startDate, ev.endDate, tentative);
      if (n) out.push(n);
    }

    for (const occ of expanded.occurrences) {
      const { skip, tentative } = classify(occ.item);
      if (skip) continue;
      const n = normalize(
        source,
        occ.item,
        occ.startDate,
        occ.endDate ?? null,
        tentative,
      );
      if (n) out.push(n);
    }

    return {
      ok: true,
      sourceId: source.id,
      sourceName: source.displayName,
      events: out,
    };
  } catch (err) {
    return {
      ok: false,
      sourceId: source.id,
      sourceName: source.displayName,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
