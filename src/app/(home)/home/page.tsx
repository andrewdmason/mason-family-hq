import { GreetingHeader } from "@/components/home/greeting-header";
import { JournalSuggestionsWidget } from "@/components/home/journal-suggestions-widget";
import { ReaderWidget } from "@/components/home/reader-widget";
import { PracticeTrendWidget } from "@/components/home/practice-trend-widget";
import { OthersDayWidget } from "@/components/home/others-day-widget";
import { BirthdaysWidget } from "@/components/home/birthdays-widget";
import { getReadingHome } from "@/app/(reading)/reader/actions";
import { getActiveQuizzesByBook } from "@/app/(reading)/reader/quizzes/actions";
import { getStreakData, getWeeklyPracticeData } from "@/app/practice/reports/actions";
import { getIsOwner } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { readHomeCache } from "@/lib/home/cache";
import { getCurrentMember, firstName } from "@/lib/home/members";
import { lastPostedDate } from "@/lib/home/journal";
import { getOthersDay } from "@/lib/home/calendar";
import { getUpcomingBirthdays } from "@/lib/home/birthdays";
import { suggestionsWidgetKey } from "@/lib/home/suggestions";
import type { HomeJournalSuggestion } from "@/lib/home/types";
import type { ReadingBookWithProgress } from "@/lib/types";

export const dynamic = "force-dynamic";

function lastPostedLabel(date: string | null, today: string): string {
  if (!date) return "No entries yet.";
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) /
      86_400_000
  );
  if (days <= 0) return "Last posted today.";
  if (days === 1) return "Last posted yesterday.";
  if (days < 7) return `Last posted ${days} days ago.`;
  if (days < 14) return "Last posted last week.";
  if (days < 60) return `Last posted ${Math.round(days / 7)} weeks ago.`;
  return `Last posted ${Math.round(days / 30)} months ago.`;
}

export default async function HomePage() {
  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);
  const dateLabel = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const [
    member,
    isOwner,
    greeting,
    personalSuggestions,
    familySuggestions,
    lastPersonal,
    lastFamily,
    reading,
    othersDay,
    birthdays,
  ] = await Promise.all([
    getCurrentMember(),
    getIsOwner(),
    readHomeCache<string>("greeting", today),
    readHomeCache<HomeJournalSuggestion[]>(
      suggestionsWidgetKey("private"),
      today
    ),
    readHomeCache<HomeJournalSuggestion[]>(suggestionsWidgetKey("family"), today),
    lastPostedDate("private"),
    lastPostedDate("family"),
    getReadingHome().catch(() => null),
    getOthersDay(tz, null).catch(() => []),
    getUpcomingBirthdays(tz).catch(() => []),
  ]);

  // The most recently active in-progress book powers the Reader widget; a
  // published, unpassed quiz on it shows the "Quiz ready" flag.
  const activeBook: ReadingBookWithProgress | null =
    reading?.books
      .filter((b) => b.status === "in_progress")
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
  const quizWaiting = activeBook
    ? Boolean((await getActiveQuizzesByBook([activeBook.id]))[activeBook.id])
    : false;

  // Practice is owner-only (mirrors the /practice gate); skip the queries for
  // everyone else.
  const [weekly, streak] = isOwner
    ? await Promise.all([
        getWeeklyPracticeData().catch(() => []),
        getStreakData().catch(() => null),
      ])
    : [[], null];

  // "others' day" excludes the viewer's own events.
  const others = othersDay.filter((d) => d.email !== member.email);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-24 pt-12">
      <GreetingHeader
        initialGreeting={greeting}
        name={firstName(member.name)}
        dateLabel={dateLabel}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-4 lg:col-span-2">
          {activeBook && (
            <ReaderWidget
              book={activeBook}
              weeklyPageGoal={reading?.weeklyPageGoal ?? 0}
              quizWaiting={quizWaiting}
            />
          )}
          <JournalSuggestionsWidget
            audience="family"
            lastPostedLabel={lastPostedLabel(lastFamily, today)}
            initialSuggestions={familySuggestions}
          />
          <JournalSuggestionsWidget
            audience="private"
            lastPostedLabel={lastPostedLabel(lastPersonal, today)}
            initialSuggestions={personalSuggestions}
          />
          {isOwner && streak && (
            <PracticeTrendWidget weekly={weekly} streak={streak} />
          )}
        </div>

        {/* Sidebar column */}
        <div className="space-y-4">
          <OthersDayWidget days={others} />
          {birthdays.length > 0 && <BirthdaysWidget birthdays={birthdays} />}
        </div>
      </div>
    </div>
  );
}
