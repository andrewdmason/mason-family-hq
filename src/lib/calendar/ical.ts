// RFC 5545 iCal feed generation. Used by the outbound per-kid feed route so kid
// events show up in a phone's native calendar app. Ported verbatim from
// KidCalendar apart from the PRODID.

export interface ICalEvent {
  uid: string;
  summary: string;
  description: string | null;
  location: string | null;
  dtstart: Date;
  dtend: Date | null;
  allDay: boolean;
  canceled: boolean;
}

interface ICalFeedOptions {
  feedName: string;
  timezone: string;
  events: ICalEvent[];
}

// Escape special characters per RFC 5545 §3.3.11
function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

// Fold lines longer than 75 octets per RFC 5545 §3.1
function foldLine(line: string): string {
  const MAX_OCTETS = 75;
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= MAX_OCTETS) return line;

  const parts: string[] = [];
  let start = 0;
  let isFirst = true;

  while (start < bytes.length) {
    const limit = isFirst ? MAX_OCTETS : MAX_OCTETS - 1;
    let end = Math.min(start + limit, bytes.length);

    // Don't split in the middle of a multi-byte UTF-8 character
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }

    const chunk = new TextDecoder().decode(bytes.slice(start, end));
    parts.push(isFirst ? chunk : " " + chunk);
    start = end;
    isFirst = false;
  }

  return parts.join("\r\n");
}

function formatDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}T${h}${min}${s}Z`;
}

function formatDateOnly(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function formatTimestamp(): string {
  return formatDateUTC(new Date());
}

function renderEvent(event: ICalEvent): string {
  const lines: string[] = ["BEGIN:VEVENT"];

  lines.push(`UID:${event.uid}`);
  lines.push(`DTSTAMP:${formatTimestamp()}`);

  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(event.dtstart)}`);
    if (event.dtend) {
      lines.push(`DTEND;VALUE=DATE:${formatDateOnly(event.dtend)}`);
    }
  } else {
    lines.push(`DTSTART:${formatDateUTC(event.dtstart)}`);
    if (event.dtend) {
      lines.push(`DTEND:${formatDateUTC(event.dtend)}`);
    } else {
      const defaultEnd = new Date(event.dtstart.getTime() + 60 * 60 * 1000);
      lines.push(`DTEND:${formatDateUTC(defaultEnd)}`);
    }
  }

  lines.push(`SUMMARY:${escapeText(event.summary)}`);

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  }

  if (event.location) {
    lines.push(`LOCATION:${escapeText(event.location)}`);
  }

  lines.push(`STATUS:${event.canceled ? "CANCELLED" : "CONFIRMED"}`);
  lines.push("END:VEVENT");

  return lines.map(foldLine).join("\r\n");
}

export function generateICalFeed(options: ICalFeedOptions): string {
  const { feedName, timezone, events } = options;

  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Family Mason HQ//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(feedName)}`,
    `X-WR-TIMEZONE:${timezone}`,
  ];

  const vevents = events.map(renderEvent);
  const footer = ["END:VCALENDAR"];

  const parts = [
    header.map(foldLine).join("\r\n"),
    ...vevents,
    footer.join("\r\n"),
  ];

  return parts.join("\r\n") + "\r\n";
}
