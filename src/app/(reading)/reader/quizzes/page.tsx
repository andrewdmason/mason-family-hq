import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getIsOwner } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { quizEditHref, quizResultsHref, readingHomeHref } from "@/lib/reading/links";
import { quizRangeLabel } from "@/lib/reading/quiz-format";
import { isQuizDue } from "@/lib/reading/quiz-due";
import type { OwnerQuizListItem } from "@/lib/types";
import { listAllQuizzes } from "./actions";

export const dynamic = "force-dynamic";

function firstName(name: string | null, email: string): string {
  return name?.trim().split(/\s+/)[0] || email;
}

export const metadata = {
  title: "Reading Quizzes",
};

export default async function QuizzesListPage() {
  if (!(await getIsOwner())) redirect("/reader");

  const [quizzes, tz] = await Promise.all([listAllQuizzes(), getUserTimezone()]);
  // The weekly quiz is due every Friday — an unattempted published quiz reads as
  // "Due now" from Friday through the weekend, but only once its stretch began
  // before this window's Friday (a just-prepared quiz isn't due the same week).
  const today = localDate(new Date(), tz);
  const dayOfWeek = new Date(`${today}T12:00:00`).getDay();

  // Group by reader so each kid's quizzes sit together.
  const byMember = new Map<string, OwnerQuizListItem[]>();
  for (const q of quizzes) {
    const list = byMember.get(q.memberEmail) ?? [];
    list.push(q);
    byMember.set(q.memberEmail, list);
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">
          Quizzes
        </h1>
        <Link
          href={readingHomeHref(null)}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Back to reading
        </Link>
      </div>

      {quizzes.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          No quizzes yet. Open a kid&apos;s book with an uploaded file and choose
          &ldquo;Generate quiz&rdquo; from its menu.
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {[...byMember.entries()].map(([email, items]) => (
            <section key={email}>
              <h2 className="font-serif text-lg text-foreground">
                {firstName(items[0].memberName, email)}
              </h2>
              <div className="mt-3 space-y-2">
                {items.map((q) => (
                  <QuizRow
                    key={q.id}
                    quiz={q}
                    dueNow={isQuizDue(
                      dayOfWeek,
                      localDate(new Date(q.createdAt), tz),
                      today
                    )}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function QuizRow({
  quiz,
  dueNow,
}: {
  quiz: OwnerQuizListItem;
  dueNow: boolean;
}) {
  // Every quiz opens to a detail view: drafts to the editor, published quizzes to
  // their detail/results page (where the owner can view it and close it without
  // passing) — including ones the kid hasn't attempted yet.
  const href =
    quiz.status === "draft"
      ? quizEditHref(quiz.id, quiz.memberEmail)
      : quizResultsHref(quiz.id, quiz.memberEmail);
  const action = quiz.status === "draft" ? "Review draft" : "View quiz";

  return (
    <Link
      href={href}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-accent"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{quiz.bookTitle}</p>
        <p className="text-xs capitalize text-muted-foreground">
          {quizRangeLabel(quiz.fromPage, quiz.throughPage)}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {quiz.status === "draft" ? (
          <Badge variant="secondary">Draft</Badge>
        ) : quiz.latest ? (
          <div className="flex items-center gap-2">
            {quiz.passed ? (
              quiz.closedByParent ? (
                <Badge variant="secondary">Closed by parent</Badge>
              ) : (
                <Badge className="bg-emerald-600 text-white">Passed</Badge>
              )
            ) : (
              <Badge
                variant="outline"
                className="border-destructive/40 text-destructive"
              >
                Needs retake
              </Badge>
            )}
            <div className="text-right">
              <span className="text-sm tabular-nums text-foreground">
                {quiz.latest.scoreCorrect}/{quiz.latest.scoreTotal}
                {!quiz.latest.gradingComplete && (
                  <span className="ml-1 text-xs text-muted-foreground">*</span>
                )}
              </span>
              <p className="text-xs text-muted-foreground">
                {quiz.attemptCount === 1
                  ? "1 attempt"
                  : `latest of ${quiz.attemptCount} attempts`}
              </p>
            </div>
          </div>
        ) : dueNow ? (
          <Badge className="bg-amber-500 text-white">Due now</Badge>
        ) : (
          <Badge variant="outline">Awaiting submission</Badge>
        )}
        <span className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
          {action}
          <ChevronRight className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}
