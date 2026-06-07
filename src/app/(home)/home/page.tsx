import { GreetingHeader } from "@/components/home/greeting-header";
import { JournalStatusWidget } from "@/components/home/journal-status-widget";
import { ReaderWidget } from "@/components/home/reader-widget";
import { PracticeTrendWidget } from "@/components/home/practice-trend-widget";
import { PersonStatusWidget } from "@/components/home/person-status-widget";
import { WorkoutWidget } from "@/components/home/workout-widget";
import { getHomeWorkout } from "@/lib/home/workouts";
import { getReadingHome } from "@/app/(reading)/reader/actions";
import { getActiveQuizzesByBook } from "@/app/(reading)/reader/quizzes/actions";
import { getStreakData, getTrailingPracticeData } from "@/app/practice/reports/actions";
import { getIsOwner } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { getCurrentMember, firstName } from "@/lib/home/members";
import { getJournalStatus } from "@/lib/home/journal";
import { getHomePersonStatuses } from "@/lib/home/person-status";
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

  const member = await getCurrentMember();

  const [
    isOwner,
    personalJournal,
    familyJournal,
    reading,
    personStatuses,
    workout,
  ] = await Promise.all([
    getIsOwner(),
    getJournalStatus("private", today),
    getJournalStatus("family", today),
    getReadingHome().catch(() => null),
    getHomePersonStatuses(tz, member.email).catch(() => []),
    getHomeWorkout().catch(() => null),
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

  const sidebarPeople = personStatuses.filter((p) => p.email !== member.email);

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
          <WorkoutWidget workout={workout} today={today} />
          {isOwner && trailing && streak && (
            <PracticeTrendWidget
              trailing={trailing}
              currentStreak={streak.currentStreak}
            />
          )}
        </div>

        {/* Sidebar column */}
        <div className="space-y-4">
          {sidebarPeople.map((person) => (
            <PersonStatusWidget key={person.email} person={person} />
          ))}
        </div>
      </div>
    </div>
  );
}
