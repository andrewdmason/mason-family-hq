/**
 * Snooze presets, computed in the *browser's* timezone (this module runs
 * client-side from the snooze menu). Snooze replaces Things' start date: the
 * task hides everywhere until the moment passes, then pops into Today via the
 * lazy sweep — so a preset is just "the next sensible wake-up timestamp".
 * Day-level presets wake at midnight (in Today first thing that morning);
 * only "This evening" carries a real time of day.
 */

export type SnoozePreset = {
  key: string;
  label: string;
  /** Short hint shown right-aligned in the menu, e.g. "Sat" or "5:00 PM". */
  hint: string;
  when: Date;
};

const EVENING_HOUR = 17; // "This evening" = 5pm today
// Day-level presets wake at midnight: the task is in Today first thing that
// morning, not whenever some arbitrary mid-morning hour rolls around.
const DAY_START_HOUR = 0;

function at(date: Date, hour: number): Date {
  const d = new Date(date);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const weekday = (d: Date) =>
  d.toLocaleDateString("en-US", { weekday: "short" });

/** The quick-snooze options for "now". Presets already in the past drop out. */
export function snoozePresets(now: Date = new Date()): SnoozePreset[] {
  const presets: SnoozePreset[] = [];

  const evening = at(now, EVENING_HOUR);
  if (evening > now) {
    presets.push({
      key: "evening",
      label: "This evening",
      hint: "5:00 PM",
      when: evening,
    });
  }

  const tomorrow = at(addDays(now, 1), DAY_START_HOUR);
  presets.push({
    key: "tomorrow",
    label: "Tomorrow",
    hint: weekday(tomorrow),
    when: tomorrow,
  });

  // Next Saturday (skipped if that's also "tomorrow" — no duplicate rows).
  const daysToSaturday = (6 - now.getDay() + 7) % 7 || 7;
  const weekend = at(addDays(now, daysToSaturday), DAY_START_HOUR);
  if (daysToSaturday > 1) {
    presets.push({
      key: "weekend",
      label: "This weekend",
      hint: weekday(weekend),
      when: weekend,
    });
  }

  // Next Monday.
  const daysToMonday = (1 - now.getDay() + 7) % 7 || 7;
  const nextWeek = at(addDays(now, daysToMonday), DAY_START_HOUR);
  if (daysToMonday > 1) {
    presets.push({
      key: "next-week",
      label: "Next week",
      hint: weekday(nextWeek),
      when: nextWeek,
    });
  }

  return presets;
}

/**
 * "Tomorrow", "Sat", "Jun 24" — for snoozed chips. Day-level snoozes wake at
 * midnight, so the time is noise and gets dropped; an explicit time (like
 * "This evening") keeps it: "Tomorrow 5:00 PM".
 */
export function formatWake(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  const atMidnight = when.getHours() === 0 && when.getMinutes() === 0;
  const time = when.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  const startOfDay = (d: Date) => new Date(d).setHours(0, 0, 0, 0);
  const dayDiff = Math.round(
    (startOfDay(when) - startOfDay(now)) / 86_400_000
  );

  if (dayDiff <= 0) return atMidnight ? "Today" : time;
  if (dayDiff === 1) return atMidnight ? "Tomorrow" : `Tomorrow ${time}`;
  if (dayDiff < 7)
    return atMidnight ? weekday(when) : `${weekday(when)} ${time}`;
  const date = when.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return atMidnight ? date : `${date}, ${time}`;
}
