import Link from "next/link";
import { Check, ChevronRight, Flame } from "lucide-react";
import { chooseLevel } from "@/app/(words)/words/actions";
import { DayDots, WordsBar, paceLine } from "@/components/words/progress-bits";
import { buttonVariants } from "@/components/ui/button-variants";
import { getIsAdult, requireUserId } from "@/lib/members/auth";
import { cn } from "@/lib/utils";
import { daysBetween, TEST_DATE } from "@/lib/words/schedule";
import { getProfile, loadOverview, loadStudents, type Overview } from "@/lib/words/session";

export const dynamic = "force-dynamic";

const LEVEL_NAME = { lower: "Lower Level", middle: "Middle Level" } as const;

export default async function WordsHome() {
  const userId = await requireUserId();
  const [profile, adult] = await Promise.all([getProfile(userId), getIsAdult()]);
  const overview = profile ? await loadOverview(profile) : null;
  const students = adult ? await loadStudents() : [];
  const kids = await Promise.all(
    students.filter((s) => s.userId !== userId).map(async (s) => ({ ...s, overview: await loadOverview(s.profile) }))
  );

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-5 py-8">
      {adult && kids.length > 0 && (
        <section className="mb-10">
          <h1 className="font-serif text-2xl tracking-tight text-foreground">ISEE Verbal Reasoning</h1>
          <p className="mt-1 text-sm text-muted-foreground">{countdown(kids[0].overview.today)}</p>
          <div className="mt-5 grid gap-4">
            {kids.map((kid) => (
              <KidCard key={kid.userId} name={kid.name} userId={kid.userId} overview={kid.overview} />
            ))}
          </div>
        </section>
      )}

      {overview ? (
        <Mine overview={overview} heading={adult ? "Your own practice" : "ISEE Verbal Reasoning"} canSwitch={adult} />
      ) : adult ? (
        <section>
          <h2 className="text-sm font-medium text-foreground">Try it yourself</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your answers are kept apart from the kids&rsquo;.
          </p>
          <div className="mt-3 flex gap-2">
            {(["lower", "middle"] as const).map((level) => (
              <form key={level} action={chooseLevel.bind(null, level)}>
                <button className={buttonVariants({ variant: "outline" })}>{LEVEL_NAME[level]}</button>
              </form>
            ))}
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">This isn&rsquo;t set up for you yet. Ask a parent.</p>
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

function Mine({ overview, heading, canSwitch }: { overview: Overview; heading: string; canSwitch: boolean }) {
  const done = overview.doneToday;
  const other = overview.level === "lower" ? "middle" : "lower";
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">{heading}</h1>
        <span className="flex items-center gap-1 text-sm text-foreground" title="Days in a row">
          <Flame className={cn("size-4", overview.streak > 0 ? "text-orange-500" : "text-muted-foreground")} />
          <span className="tabular-nums">{overview.streak}</span>
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {LEVEL_NAME[overview.level]}. {countdown(overview.today)}
      </p>

      <div className="mt-5 rounded-2xl border border-border bg-card p-5">
        {done ? (
          <>
            <div className="flex items-center gap-2 text-emerald-700">
              <Check className="size-5" />
              <span className="font-medium">Done today</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {done.correct} of {done.total} right, with {paceLine(done)}.
            </p>
            <Link href="/words/session" className={cn(buttonVariants({ variant: "outline" }), "mt-4 w-full")}>
              {overview.inProgress ? "Keep going" : "Do another"}
            </Link>
          </>
        ) : (
          <>
            <div className="font-medium text-foreground">Today&rsquo;s session</div>
            <p className="mt-1 text-sm text-muted-foreground">
              {overview.inProgress
                ? `${overview.inProgress.answered} of ${overview.inProgress.total} answered so far.`
                : `${overview.questions} questions in 10 minutes.`}
            </p>
            <Link href="/words/session" className={cn(buttonVariants({ size: "lg" }), "mt-4 h-12 w-full text-base")}>
              {overview.inProgress ? "Keep going" : "Start"}
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
          <Link href="/words/list" className="flex items-center text-sm text-muted-foreground hover:text-foreground">
            All words <ChevronRight className="size-4" />
          </Link>
        </div>
        <WordsBar overview={overview} />
        <p className="mt-3 text-xs text-muted-foreground">
          Word parts: {overview.parts.met} of {overview.parts.total} met, {overview.parts.mastered} mastered.
        </p>
      </div>

      <Trouble overview={overview} />

      {canSwitch && (
        <form action={chooseLevel.bind(null, other)} className="mt-8">
          <button className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            Switch to {LEVEL_NAME[other]}
          </button>
        </form>
      )}
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
  const done = overview.doneToday;
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
      <p className={cn("mt-1 text-sm", done ? "text-emerald-700" : "text-muted-foreground")}>
        {done
          ? `Done today: ${done.correct} of ${done.total} right, ${paceLine(done)}.`
          : overview.inProgress
            ? `Started today: ${overview.inProgress.answered} of ${overview.inProgress.total} answered.`
            : "Not done yet today."}
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
