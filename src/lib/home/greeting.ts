import "server-only";

import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import { getCalendarEvents } from "@/lib/calendar/queries";
import { formatTimeRange } from "@/lib/calendar/calendar-utils";
import { getReadingHome } from "@/app/(reading)/reader/actions";
import { getStreakData } from "@/app/practice/reports/actions";
import { localDate } from "@/lib/date-utils";
import type { CalendarEvent } from "@/lib/calendar/types";
import { firstName, getCurrentMember } from "./members";

const DAY_MS = 86_400_000;

const GREETING_TOOL = {
  name: "write_greeting",
  description:
    "Write a single warm line of welcome for the top of someone's family-app " +
    "home dashboard, commenting on what their day looks like.",
  input_schema: {
    type: "object" as const,
    properties: {
      greeting: {
        type: "string",
        description:
          "ONE warm, natural sentence (max ~20 words) welcoming the person and " +
          "commenting on their day — call out a specific event or interest, or " +
          "just how busy or open the day looks. Address them by first name once. " +
          "No emoji, no lists, no markdown. Don't start with 'Good morning' unless " +
          "it fits; vary it. If there's nothing on, make it gently encouraging.",
      },
    },
    required: ["greeting"],
  },
};

function eventDateKey(event: CalendarEvent, tz: string): string {
  return localDate(new Date(event.start_time), event.all_day ? "UTC" : tz);
}

/**
 * Assemble a compact context block for the greeting: the person's own events for
 * today, plus one or two light signals (reading goal, practice streak) so the
 * line feels alive rather than purely calendar-driven. Owner-only practice
 * signal is skipped for everyone else.
 */
async function buildContext(
  tz: string,
  email: string | null,
  isOwner: boolean
): Promise<string> {
  const today = localDate(new Date(), tz);
  const now = Date.now();

  const [events, reading, streak] = await Promise.all([
    getCalendarEvents({
      rangeStart: new Date(now - DAY_MS),
      rangeEnd: new Date(now + 2 * DAY_MS),
    }),
    getReadingHome().catch(() => null),
    isOwner ? getStreakData().catch(() => null) : Promise.resolve(null),
  ]);

  const lines: string[] = [];

  const mine = events
    .filter((e) => eventDateKey(e, tz) === today)
    .filter((e) => !e.member_email || e.member_email === email)
    .sort((a, b) =>
      a.all_day === b.all_day
        ? a.start_time.localeCompare(b.start_time)
        : a.all_day
          ? -1
          : 1
    );
  if (mine.length > 0) {
    lines.push("Today's schedule:");
    for (const e of mine) {
      const when = formatTimeRange(e.start_time, e.end_time, e.all_day);
      lines.push(`- ${when} — ${e.title}${e.location ? ` (${e.location})` : ""}`);
    }
  } else {
    lines.push("Today's schedule: nothing on the calendar.");
  }

  const book = reading?.books.find((b) => b.status === "in_progress");
  if (book) {
    const goal = reading?.weeklyPageGoal ?? 0;
    lines.push(
      `Currently reading "${book.title}"${
        goal > 0
          ? ` — ${book.pagesReadThisWeek} of ${goal} pages toward this week's goal${
              reading?.checkedInThisWeek ? "" : " (no check-in yet this week)"
            }`
          : ""
      }.`
    );
  }

  if (streak && streak.currentStreak > 0) {
    lines.push(`On a ${streak.currentStreak}-day practice streak.`);
  }

  return lines.join("\n");
}

/**
 * Generate the day's one-line greeting for the signed-in member. Resilient by
 * design (mirrors recap-summary.ts): any failure returns null so the dashboard
 * still renders — the greeting is a nice-to-have, not a gate. The caller handles
 * caching; this always generates fresh.
 */
export async function generateGreeting(
  tz: string,
  isOwner: boolean
): Promise<string | null> {
  try {
    const member = await getCurrentMember();
    const name = firstName(member.name);
    const context = await buildContext(tz, member.email, isOwner);

    const client = anthropic();
    const message = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 128,
      system:
        "You write a single warm line of welcome for the top of a family app's " +
        "home dashboard. Be specific and natural, never generic or saccharine. " +
        "Call write_greeting exactly once.",
      tools: [GREETING_TOOL],
      tool_choice: { type: "tool", name: GREETING_TOOL.name },
      messages: [
        {
          role: "user",
          content: `The person's name is ${name}.\n\n${context}`,
        },
      ],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;
    const input = toolUse.input as { greeting?: unknown };
    const greeting =
      typeof input.greeting === "string" ? input.greeting.trim() : "";
    return greeting.length > 0 ? greeting : null;
  } catch (err) {
    console.error(
      "[home/greeting] generation failed:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
