// Shared types for the Home dashboard. Kept free of server imports so client
// widgets can import them alongside the server code that produces them.

import type { CalendarEvent } from "@/lib/calendar/types";
import type { MemberRole } from "@/lib/types";

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

export type HomeReadingQuizState = "ready" | "due" | "retake";

export type HomeReadingBookStatus = {
  id: string;
  title: string;
  author: string | null;
  currentPage: number;
  targetPage: number | null;
  totalPages: number | null;
  pagesReadThisWeek: number;
  dueLabel: string;
  quiz: {
    id: string;
    state: HomeReadingQuizState;
  } | null;
};

export type HomePersonReadingStatus = {
  weeklyPageGoal: number;
  pagesReadThisWeek: number;
  books: HomeReadingBookStatus[];
};

/** One fixed sidebar card on the parent Home page. */
export type HomePersonStatus = {
  email: string;
  name: string;
  role: MemberRole;
  color: string;
  reading: HomePersonReadingStatus | null;
  events: CalendarEvent[];
};
