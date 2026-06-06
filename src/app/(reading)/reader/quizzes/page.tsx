import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { CloseQuizButton } from "@/components/reading/close-quiz-button";
import { getIsOwner } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { quizEditHref, quizResultsHref, readingHomeHref } from "@/lib/reading/links";
import { quizRangeLabel } from "@/lib/reading/quiz-format";
import { isQuizDueWindow } from "@/lib/reading/quiz-due";
import type { OwnerQuizListItem } from "@/lib/types";
import { listAllQuizzes } from "./actions";

export const dynamic = "force-dynamic";

function firstName(name: string | null, email: string): string {
  return name?.trim().split(/\s+/)[0] || email;
}

export default async function QuizzesListPage() {
  if (!(await getIsOwner())) redirect("/reader");

  const [quizzes, tz] = await Promise.all([listAllQuizzes(), getUserTimezone()]);
  // The weekly quiz is due every Friday — an unattempted published quiz reads as
  // "Due now" from Friday through the weekend.
  const dayOfWeek = new Date(`${localDate(new Date(), tz)}T12:00:00`).getDay();
  const dueNow = isQuizDueWindow(dayOfWeek);

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
                  <QuizRow key={q.id} quiz={q} dueNow={dueNow} />
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
  const href =
    quiz.status === "draft"
      ? quizEditHref(quiz.id, quiz.memberEmail)
      : quiz.latest
        ? quizResultsHref(quiz.id, quiz.memberEmail)
        : null;
  // A published quiz that hasn't been passed (or closed) can be closed by a parent.
  const canClose = quiz.status === "published" && !quiz.passed;

  const details = (
    <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
      <div>
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
      </div>
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3">
      {href ? (
        <Link
          href={href}
          className="flex flex-1 transition-colors hover:opacity-90"
        >
          {details}
        </Link>
      ) : (
        details
      )}
      {canClose && (
        <CloseQuizButton
          quizId={quiz.id}
          memberEmail={quiz.memberEmail}
          size="xs"
        />
      )}
    </div>
  );
}
