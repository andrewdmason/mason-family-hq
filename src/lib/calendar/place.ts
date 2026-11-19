// Where an event is, as opposed to how it's joined. Client-safe.
//
// A calendar's location field holds more than places: a call's link ("Click
// to join meeting: https://…"), the word "Zoom", "TBD". The link to join by is
// found once, in the database (calendar_events.join_url, migration 00221),
// wherever it was written. What's here is the other half: what is left of the
// location once the link is out of it, and whether that is somewhere you can
// go. The iPhone app has the same rules in CalendarRules.swift.

/** A link in a location, with or without its scheme ("zoom.us/j/123"). */
const LINK = /(?:https?:\/\/|www\.)\S+|\S+\.[a-z]{2,}\/\S*/gi;
const EDGES = /^[\s,;:|/()[\]–—-]+|[\s,;:|/()[\]–—-]+$/g;
/** Words that make the text beside a link its label, not a place. */
const LINK_LABEL =
  /\b(?:join|click|meeting|zoom|teams|webex|online|virtual|video|call|link|here)\b/i;

/** Not decided yet: nowhere to look up, but still somewhere to be driven. */
const UNDECIDED = new Set(["tbd", "tba", "tbc", "n/a", "none", "unknown"]);
/** Not in person. */
const REMOTE = new Set([
  "online",
  "virtual",
  "remote",
  "zoom",
  "zoom call",
  "zoom meeting",
  "google meet",
  "meet",
  "teams",
  "microsoft teams",
  "facetime",
  "webex",
  "video call",
  "phone",
  "phone call",
]);

/** The location without its link: "Room 4" of "Room 4 — https://zoom.us/j/1",
 * nothing of "Click to join meeting: https://…". A location with no link in
 * it comes back as written. */
export function placeText(location: string | null | undefined): string | null {
  if (!location) return null;
  const without = location.replace(LINK, " ");
  if (without === location) return location.trim() || null;
  const text = without.replace(/\s+/g, " ").replace(EDGES, "");
  if (!text || LINK_LABEL.test(text)) return null;
  return text;
}

/** Whether the location names somewhere: a thing to map, geocode and drive
 * to. Not a link, "Zoom" or "TBD". */
export function isPlace(location: string | null | undefined): boolean {
  const text = placeText(location)?.toLowerCase();
  return !!text && !UNDECIDED.has(text) && !REMOTE.has(text);
}

/** Whether the event happens on a call and nowhere else, so there's no
 * drop-off or pick-up: it says so ("Zoom"), or it has a link to join and no
 * place. A call with a place as well (a class with a remote option) isn't. */
export function isRemote(event: {
  location: string | null;
  join_url?: string | null;
}): boolean {
  const text = placeText(event.location)?.toLowerCase();
  if (text && REMOTE.has(text)) return true;
  return !!event.join_url && !isPlace(event.location);
}

const SERVICES: [RegExp, string][] = [
  [/(^|\.)zoom(gov)?\.(us|com)$/, "Zoom"],
  [/^meet\.google\.com$/, "Google Meet"],
  [/(^|\.)teams\.(microsoft|live)\.com$/, "Microsoft Teams"],
  [/(^|\.)webex\.com$/, "Webex"],
  [/^facetime\.apple\.com$/, "FaceTime"],
  [/(^|\.)whereby\.com$/, "Whereby"],
  [/(^|\.)(gotomeet\.me|gotomeeting\.com|goto\.com)$/, "GoTo Meeting"],
  [/^join\.skype\.com$/, "Skype"],
  [/(^|\.)bluejeans\.com$/, "BlueJeans"],
  [/(^|\.)chime\.aws$/, "Amazon Chime"],
  [/^meet\.jit\.si$/, "Jitsi"],
  [/(^|\.)doxy\.me$/, "Doxy.me"],
];

/** What a join link is called: "Zoom", "Google Meet"; for a link to anything
 * else, its site ("book.example.com"). */
export function joinName(joinUrl: string): string {
  let host: string;
  try {
    host = new URL(joinUrl).hostname.toLowerCase();
  } catch {
    return "Link";
  }
  return SERVICES.find(([re]) => re.test(host))?.[1] ?? host.replace(/^www\./, "");
}

/** The one line a compact view has for where an event is: the place, else the
 * call it's on, else whatever the location says ("TBD"). */
export function whereLine(event: {
  location: string | null;
  join_url?: string | null;
}): { text: string; call: boolean } | null {
  const text = placeText(event.location);
  if (isPlace(event.location)) return { text: text as string, call: false };
  if (event.join_url) return { text: joinName(event.join_url), call: true };
  return text ? { text, call: REMOTE.has(text.toLowerCase()) } : null;
}
