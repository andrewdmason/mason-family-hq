// Shared types for the Home dashboard. Kept free of server imports so client
// widgets can import them alongside the server code that produces them.

import type { CalendarEvent } from "@/lib/calendar/types";

/** Which journal a Home journal widget tracks. */
export type HomeJournalAudience = "private" | "family";

/** One family member's events for today, for the "others' day" widget. */
export type MemberDay = {
  email: string;
  name: string;
  color: string;
  events: CalendarEvent[];
};

/** An upcoming family birthday, with a friendly countdown. */
export type UpcomingBirthday = {
  name: string;
  /** The birthday's month/day this year-or-next, YYYY-MM-DD. */
  date: string;
  /** Whole days until the birthday (0 = today). */
  daysUntil: number;
  /** Age they'll turn, when we know their birth year. */
  turningAge: number | null;
};
