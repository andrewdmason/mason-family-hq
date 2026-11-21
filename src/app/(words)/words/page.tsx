import Link from "next/link";
import { Check, ChevronRight, Flame } from "lucide-react";
import { clock, DayDots, WordsBar } from "@/components/words/progress-bits";
import { buttonVariants } from "@/components/ui/button-variants";
import { getIsAdult, requireUserId } from "@/lib/members/auth";
import { cn } from "@/lib/utils";
import { wordsToday } from "@/lib/words/day";
import { daysBetween, TEST_DATE } from "@/lib/words/schedule";
import { getProfile, loadOverview, loadStudents, type Overview } from "@/lib/words/session";

export const dynamic = "force-dynamic";

const LEVEL_NAME = { lower: "Lower Level", middle: "Middle Level" } as const;

export default async function WordsHome({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const userId = await requireUserId();
  const [profile, adult, { view }] = await Promise.all([getProfile(userId), getIsAdult(), searchParams]);

  // The kids see their own page and nothing else.
  if (!adult) {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-5 py-8">
        {profile ? (
          <Mine overview={await loadOverview(profile)} startHref="/words/session" listHref="/words/list" />
        ) : (
          <p className="text-sm text-muted-foreground">This isn&rsquo;t set up for you yet. Ask a parent.</p>
        )}
      </main>
    );
  }

  // A parent picks: both kids side by side, or the page exactly as one of them sees it.
  const students = (await loadStudents()).filter((s) => s.userId !== userId);
  const shown = students.find((s) => s.userId === view) ?? null;
  const tabs = [{ key: null as string | null, label: "Parent view" }, ...students.map((s) => ({ key: s.userId as string | null, label: s.name }))];

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-5 py-8">
      <nav className="mb-6 flex gap-1 rounded-lg bg-muted p-1 text-sm" aria-label="Whose view">
        {tabs.map((t) => (
          <Link
            key={t.key ?? "parent"}
            href={t.key ? `/words?view=${t.key}` : "/words"}
            aria-current={(shown?.userId ?? null) === t.key ? "page" : undefined}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-center",
              (shown?.userId ?? null) === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {shown ? (
        <>
          <Mine
            overview={await loadOverview(shown.profile)}
            startHref={`/words/session?level=${shown.profile.level}`}
            listHref={`/words/list?kid=${shown.userId}`}
          />
          <p className="mt-8 text-xs text-muted-foreground">
            This is {shown.name}&rsquo;s page as {shown.name} sees it. A session you play from here uses the same words and
            questions, but your answers are saved as yours and never change {shown.name}&rsquo;s progress.
          </p>
        </>
      ) : (
        <section>
          <h1 className="font-serif text-2xl tracking-tight text-foreground">ISEE Verbal Reasoning</h1>
          {students.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No kids are set up yet.</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">{countdown(wordsToday())}</p>
              <div className="mt-5 grid gap-4">
                {await Promise.all(
                  students.map(async (kid) => (
                    <KidCard key={kid.userId} name={kid.name} userId={kid.userId} overview={await loadOverview(kid.profile)} />
                  ))
                )}
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}

function countdown(today: string): string {
  const left = daysBetween(today, TEST_DATE);
  if (left > 1) return `${left} days until the ISEE.`;
  if (left === 1) return "The ISEE is tomorrow.";
  if (left === 0) return "The ISEE is today.";
  return "ISEE vocabulary practice.";
}

/** "6:40 of 10 minutes" */
function dayLine(day: Overview["day"]): string {
  return `${clock(Math.min(day.ms, day.goalMs))} of ${Math.round(day.goalMs / 60000)} minutes`;
}

function Mine({ overview, startHref, listHref }: { overview: Overview; startHref: string; listHref: string }) {
  const { day } = overview;
  const sessions = overview.sessionsToday;
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">ISEE Verbal Reasoning</h1>
        <span className="flex items-center gap-1 text-sm text-foreground" title="Days in a row">
          <Flame className={cn("size-4", overview.streak > 0 ? "text-orange-500" : "text-muted-foreground")} />
          <span className="tabular-nums">{overview.streak}</span>
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {LEVEL_NAME[overview.level]}. {countdown(overview.today)}
      </p>

      <div className="mt-5 rounded-2xl border border-border bg-card p-5">
        {day.done ? (
          <>
            <div className="flex items-center gap-2 text-emerald-700">
              <Check className="size-5" />
              <span className="font-medium">Done today</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {clock(day.ms)} of practice in {sessions} {sessions === 1 ? "session" : "sessions"}.
            </p>
            <Link href={startHref} className={cn(buttonVariants({ variant: "outline" }), "mt-4 w-full")}>
              {overview.inProgress ? "Keep going" : "Do another"}
            </Link>
          </>
        ) : (
          <>
            <div className="font-medium text-foreground">Today: {dayLine(day)}</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, (day.ms / day.goalMs) * 100)}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {overview.inProgress
                ? `Session ${sessions + 1}: ${overview.inProgress.answered} of ${overview.inProgress.total} answered so far.`
                : `${overview.questions} questions a session. Keep going until the ten minutes are done.`}
            </p>
            <Link href={startHref} className={cn(buttonVariants({ size: "lg" }), "mt-4 h-12 w-full text-base")}>
              {overview.inProgress ? "Keep going" : sessions > 0 ? `Start session ${sessions + 1}` : "Start"}
            </Link>
          </>
        )}
        <div className="mt-4 flex items-center justify-between">
          <DayDots overview={overview} />
          <span className="text-xs text-muted-foreground">last 14 days</span>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-foreground">
            {overview.counts.mastered} of {overview.totalWords} words mastered
          </h2>
          <Link href={listHref} className="flex items-center text-sm text-muted-foreground hover:text-foreground">
            All words <ChevronRight className="size-4" />
          </Link>
        </div>
        <WordsBar overview={overview} />
        <p className="mt-3 text-xs text-muted-foreground">
          Word parts: {overview.parts.met} of {overview.parts.total} met, {overview.parts.mastered} mastered.
          {overview.counts.removed > 0 && ` ${overview.counts.removed} ${overview.counts.removed === 1 ? "word" : "words"} skipped as known already.`}
        </p>
      </div>

      <Trouble overview={overview} />

    </section>
  );
}

function Trouble({ overview }: { overview: Overview }) {
  if (overview.trouble.length === 0) return null;
  return (
    <div className="mt-6">
      <h2 className="text-sm font-medium text-foreground">Trouble words</h2>
      <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-card">
        {overview.trouble.slice(0, 6).map((t) => (
          <li key={t.id} className="flex items-baseline gap-3 px-4 py-2.5">
            <span className="font-medium text-foreground">{t.title}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{t.meaning}</span>
            <span className="text-xs tabular-nums text-muted-foreground">missed {t.misses}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function KidCard({ name, userId, overview }: { name: string; userId: string; overview: Overview }) {
  const { day } = overview;
  const sessions = overview.sessionsToday;
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between">
        <div>
          <span className="font-serif text-xl text-foreground">{name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{LEVEL_NAME[overview.level]}</span>
        </div>
        <span className="flex items-center gap-1 text-sm text-foreground" title="Days in a row">
          <Flame className={cn("size-4", overview.streak > 0 ? "text-orange-500" : "text-muted-foreground")} />
          <span className="tabular-nums">{overview.streak}</span>
        </span>
      </div>
      <p className={cn("mt-1 text-sm", day.done ? "text-emerald-700" : "text-muted-foreground")}>
        {day.done
          ? `Done today: ${clock(day.ms)} in ${sessions} ${sessions === 1 ? "session" : "sessions"}.`
          : day.ms > 0
            ? `${dayLine(day)} so far today.`
            : "Not started yet today."}
      </p>
      <div className="mt-3">
        <DayDots overview={overview} />
      </div>
      <div className="mt-4">
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <span className="text-foreground">
            {overview.counts.mastered} of {overview.totalWords} mastered
          </span>
          {overview.accuracy != null && (
            <span className="text-xs text-muted-foreground">{Math.round(overview.accuracy * 100)}% right this week</span>
          )}
        </div>
        <WordsBar overview={overview} />
      </div>
      {overview.counts.removed > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {overview.counts.removed} {overview.counts.removed === 1 ? "word" : "words"} skipped as known already.
        </p>
      )}
      {overview.trouble.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="text-foreground">Trouble words:</span> {overview.trouble.slice(0, 8).map((t) => t.title).join(", ")}
        </p>
      )}
      <Link href={`/words/list?kid=${userId}`} className="mt-3 flex items-center text-sm text-muted-foreground hover:text-foreground">
        {name}&rsquo;s words <ChevronRight className="size-4" />
      </Link>
    </div>
  );
}
