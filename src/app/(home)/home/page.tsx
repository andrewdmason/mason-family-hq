import { GreetingHeader } from "@/components/home/greeting-header";
import { JournalStatusWidget } from "@/components/home/journal-status-widget";
import { ReaderWidget } from "@/components/home/reader-widget";
import { PracticeTrendWidget } from "@/components/home/practice-trend-widget";
import { PersonStatusWidget } from "@/components/home/person-status-widget";
import { KidCalendarWidget } from "@/components/home/kid-calendar-widget";
import { TodosWidget } from "@/components/home/todos-widget";
import { WorkoutWidget } from "@/components/home/workout-widget";
import { getHomeTodos } from "@/lib/home/todos";
import { getHomeWorkout } from "@/lib/home/workouts";
import { getReadingHome } from "@/app/(reading)/reader/actions";
import { getActiveQuizzesByBook } from "@/app/(reading)/reader/quizzes/actions";
import { getStreakData, getTrailingPracticeData } from "@/app/practice/reports/actions";
import { getIsOwner } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { getCurrentMember, firstName } from "@/lib/home/members";
import { getJournalStatus } from "@/lib/home/journal";
import { getHomePersonStatuses, getKidAgenda } from "@/lib/home/person-status";
import type { KidAgenda } from "@/lib/home/types";
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
  const isKid = member.role === "kid";

  const [
    isOwner,
    personalJournal,
    familyJournal,
    reading,
    personStatuses,
    workout,
    todos,
    kidAgenda,
  ] = await Promise.all([
    getIsOwner(),
    getJournalStatus("private", today),
    getJournalStatus("family", today),
    getReadingHome().catch(() => null),
    // Kids don't get the family-member sidebar, so skip that fetch for them.
    isKid
      ? Promise.resolve([])
      : getHomePersonStatuses(tz, member.email).catch(() => []),
    getHomeWorkout().catch(() => null),
    getHomeTodos().catch(() => null),
    isKid
      ? getKidAgenda(tz, member.email).catch(
          (): KidAgenda => ({ today: [], tomorrow: [] })
        )
      : Promise.resolve<KidAgenda | null>(null),
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

  // Kids get a focused Home: no status widgets for other family members in the
  // sidebar. Only parents/owner see the family-at-a-glance column.
  const sidebarPeople = isKid
    ? []
    : personStatuses.filter((p) => p.email !== member.email);

  // Kids see the Reader widget pinned to the top in its goal-focused form; for
  // everyone else it keeps its default form and mid-column position.
  const readerWidget = activeBook ? (
    <ReaderWidget
      book={activeBook}
      weeklyPageGoal={reading?.weeklyPageGoal ?? 0}
      activeQuiz={activeQuiz}
      variant={isKid ? "goal" : "default"}
      today={today}
    />
  ) : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-24 pt-12">
      <GreetingHeader name={firstName(member.name)} dateLabel={dateLabel} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-4 lg:col-span-2">
          {isKid && readerWidget}
          {todos && <TodosWidget data={todos} />}
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
          {!isKid && readerWidget}
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
          {isKid && kidAgenda && <KidCalendarWidget agenda={kidAgenda} />}
          {sidebarPeople.map((person) => (
            <PersonStatusWidget key={person.email} person={person} />
          ))}
        </div>
      </div>
    </div>
  );
}
