/**
 * Returns a date as YYYY-MM-DD in the given timezone (or the runtime's local timezone).
 *
 * On the server (Vercel), the runtime timezone is UTC — pass the user's IANA
 * timezone (e.g. "America/Los_Angeles") to get the correct local date.
 * On the client the default is already the user's timezone so no argument is needed.
 */
export function localDate(date: Date = new Date(), timeZone?: string): string {
  if (timeZone) {
    // Intl gives us locale-independent numeric parts in the target timezone
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const get = (type: string) => parts.find((p) => p.type === type)!.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Add (or subtract) whole days to a YYYY-MM-DD date string, returning YYYY-MM-DD.
 * Anchored at noon so DST shifts never bump the result across a day boundary.
 */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

/**
 * The Monday on or before `date` (YYYY-MM-DD in, YYYY-MM-DD out). Weeks run
 * Mon–Sun across the apps (journal streaks, reading goals, practice reports).
 */
export function getWeekStart(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  const day = d.getDay(); // 0 = Sunday … 6 = Saturday
  const diff = (day - 1 + 7) % 7; // days since Monday
  return addDays(date, -diff);
}

/**
 * A human "right now" stamp in the given timezone, e.g.
 * "Thursday, May 29, 2026 at 8:25 AM PDT". Gives the interviewer a real
 * time-of-day anchor so it can tell a 5pm event apart from a past one.
 */
export function formatNow(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(date);
}

/**
 * True if `tz` is a usable IANA timezone name. Lets server code trust a
 * client-supplied timezone before computing dates with it.
 */
export function isValidTimeZone(tz: string | undefined | null): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the user's IANA timezone from the `tz` cookie (set by TimezoneProvider).
 * Only call from server code — uses `next/headers`.
 *
 * The cookie is set client-side after mount, so it can be missing on a brand-new
 * session (and child effects fire before the provider's). Prefer a timezone the
 * client sends explicitly with the request (see resolveTimezone) over this.
 */
export async function getUserTimezone(): Promise<string> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  return jar.get("tz")?.value ?? "UTC";
}

/**
 * Resolve the timezone to compute dates in: a valid client-supplied tz wins;
 * otherwise fall back to the cookie (then UTC). Use this in any request that
 * does date-sensitive work the moment the page loads, before the tz cookie may
 * have been written.
 */
export async function resolveTimezone(clientTz?: string | null): Promise<string> {
  if (isValidTimeZone(clientTz)) return clientTz;
  return getUserTimezone();
}
