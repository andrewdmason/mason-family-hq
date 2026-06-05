import { GreetingHeader } from "@/components/home/greeting-header";
import { JournalStatusWidget } from "@/components/home/journal-status-widget";
import { ReaderWidget } from "@/components/home/reader-widget";
import { PracticeTrendWidget } from "@/components/home/practice-trend-widget";
import { OthersDayWidget } from "@/components/home/others-day-widget";
import { BirthdaysWidget } from "@/components/home/birthdays-widget";
import { getReadingHome } from "@/app/(reading)/reader/actions";
import { getActiveQuizzesByBook } from "@/app/(reading)/reader/quizzes/actions";
import { getStreakData, getTrailingPracticeData } from "@/app/practice/reports/actions";
import { getIsOwner } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { getCurrentMember, firstName } from "@/lib/home/members";
import { getJournalStatus } from "@/lib/home/journal";
import { getOthersDay } from "@/lib/home/calendar";
import { getUpcomingBirthdays } from "@/lib/home/birthdays";
import type { ReadingBookWithProgress } from "@/lib/types";

export const dynamic = "force-dynamic";

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
    personalJournal,
    familyJournal,
    reading,
    othersDay,
    birthdays,
  ] = await Promise.all([
    getCurrentMember(),
    getIsOwner(),
    getJournalStatus("private", today),
    getJournalStatus("family", today),
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
  const activeQuiz = activeBook
    ? (await getActiveQuizzesByBook([activeBook.id]))[activeBook.id] ?? null
    : null;

  // Practice is owner-only (mirrors the /practice gate); skip the queries for
  // everyone else.
  const [trailing, streak] = isOwner
    ? await Promise.all([
        getTrailingPracticeData().catch(() => null),
        getStreakData().catch(() => null),
      ])
    : [null, null];

  // "others' day" excludes the viewer's own events.
  const others = othersDay.filter((d) => d.email !== member.email);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-24 pt-12">
      <GreetingHeader name={firstName(member.name)} dateLabel={dateLabel} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <JournalStatusWidget
              audience="private"
              status={personalJournal}
              today={today}
            />
            <JournalStatusWidget
              audience="family"
              status={familyJournal}
              today={today}
            />
          </div>
          {activeBook && (
            <ReaderWidget
              book={activeBook}
              weeklyPageGoal={reading?.weeklyPageGoal ?? 0}
              activeQuiz={activeQuiz}
            />
          )}
          {isOwner && trailing && streak && (
            <PracticeTrendWidget
              trailing={trailing}
              currentStreak={streak.currentStreak}
            />
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
