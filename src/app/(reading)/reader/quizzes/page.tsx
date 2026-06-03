import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { getIsOwner } from "@/lib/journal/auth";
import { quizEditHref, quizResultsHref, readingHomeHref } from "@/lib/reading/links";
import { quizRangeLabel } from "@/lib/reading/quiz-format";
import type { OwnerQuizListItem } from "@/lib/types";
import { listAllQuizzes } from "./actions";

export const dynamic = "force-dynamic";

function firstName(name: string | null, email: string): string {
  return name?.trim().split(/\s+/)[0] || email;
}

export default async function QuizzesListPage() {
  if (!(await getIsOwner())) redirect("/reader");

  const quizzes = await listAllQuizzes();

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
                  <QuizRow key={q.id} quiz={q} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function QuizRow({ quiz }: { quiz: OwnerQuizListItem }) {
  const href =
    quiz.status === "draft"
      ? quizEditHref(quiz.id, quiz.memberEmail)
      : quiz.latest
        ? quizResultsHref(quiz.id, quiz.memberEmail)
        : null;

  const inner = (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-4 py-3">
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
            {quiz.passed && (
              <Badge className="bg-emerald-600 text-white">Passed</Badge>
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
        ) : (
          <Badge variant="outline">Awaiting submission</Badge>
        )}
      </div>
    </div>
  );

  if (!href) return inner;
  return (
    <Link href={href} className="block transition-colors hover:opacity-90">
      {inner}
    </Link>
  );
}
