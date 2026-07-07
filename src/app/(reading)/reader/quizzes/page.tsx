import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { CloseQuizButton } from "@/components/reading/close-quiz-button";
import {
  DeleteQuizButton,
  GenerateDraftButton,
} from "@/components/reading/parent-admin-controls";
import { getIsOwner } from "@/lib/members/auth";
import { quizEditHref, quizResultsHref, readingHomeHref } from "@/lib/reading/links";
import { quizRangeLabel } from "@/lib/reading/quiz-format";
import { cn } from "@/lib/utils";
import type {
  ReadingAdminBook,
  ReadingAdminQuiz,
} from "@/lib/types";
import { getReadingAdmin } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Parent Admin",
};

function firstName(name: string | null, email: string): string {
  return name?.trim().split(/\s+/)[0] || email;
}

function formatDue(due: string | null): string | null {
  if (!due) return null;
  return new Date(`${due}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** The page range to generate a fresh quiz over: the unread stretch up to the
 * week's target. Null when there's nothing sensible to cover yet. */
function generateRange(
  book: ReadingAdminBook
): { from: number | null; through: number } | null {
  const through =
    book.targetPage ?? (book.currentPage > 0 ? book.currentPage : null);
  if (through == null || through < 1) return null;
  const from = book.currentPage > 0 ? Math.min(book.currentPage, through) : null;
  return { from, through };
}

export default async function ParentAdminPage() {
  if (!(await getIsOwner())) redirect("/reader");

  const members = await getReadingAdmin();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">
          Parent Admin
        </h1>
        <Link
          href={readingHomeHref(null)}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Back to reading
        </Link>
      </div>

      {members.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          No reading to administer yet. Add a kid&apos;s book from the reading
          home to get started.
        </p>
      ) : (
        <div className="mt-6 space-y-10">
          {members.map((m) => (
            <section key={m.email}>
              <h2 className="font-serif text-lg text-foreground">
                {firstName(m.name, m.email)}
              </h2>
              <div className="mt-3 space-y-5">
                {m.books.map((book) => (
                  <BookBlock key={book.bookId} book={book} memberEmail={m.email} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

function BookBlock({
  book,
  memberEmail,
}: {
  book: ReadingAdminBook;
  memberEmail: string;
}) {
  const due = formatDue(book.targetDue);
  const total = book.totalPages ? ` of ${book.totalPages}` : "";
  const genRange = generateRange(book);

  return (
    <div className="rounded-xl border border-border">
      {/* Assignment state (read-only). */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="font-serif text-base text-foreground">{book.title}</p>
          {book.status !== "in_progress" && (
            <Badge variant="outline" className="capitalize">
              {book.status}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Page {book.currentPage}
          {total}
          {" · "}
          {book.targetPage != null
            ? `goal p.${book.targetPage}${due ? ` by ${due}` : ""}`
            : "no target set"}
        </p>
      </div>

      <div className="space-y-4 px-4 py-4">
        {book.draftQuiz && (
          <DraftCard quiz={book.draftQuiz} memberEmail={memberEmail} />
        )}

        {book.activeQuiz ? (
          <ActiveQuizCard
            quiz={book.activeQuiz}
            book={book}
            memberEmail={memberEmail}
          />
        ) : (
          !book.draftQuiz && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                No quiz for this stretch yet.
              </p>
              {genRange ? (
                <GenerateDraftButton
                  bookId={book.bookId}
                  memberEmail={memberEmail}
                  fromPage={genRange.from}
                  throughPage={genRange.through}
                  label={`Generate quiz for ${quizRangeLabel(genRange.from, genRange.through)}`}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Set a target page to generate one.
                </p>
              )}
            </div>
          )
        )}

        {book.history.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground">
              Older quizzes ({book.history.length})
            </summary>
            <div className="mt-2 space-y-1.5">
              {book.history.map((q) => (
                <Link
                  key={q.id}
                  href={quizResultsHref(q.id, memberEmail)}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <span className="capitalize text-muted-foreground">
                    {quizRangeLabel(q.fromPage, q.throughPage)}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {historyLabel(q)}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function ActiveQuizCard({
  quiz,
  book,
  memberEmail,
}: {
  quiz: ReadingAdminQuiz;
  book: ReadingAdminBook;
  memberEmail: string;
}) {
  const attempted = quiz.attempts.length > 0;
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm capitalize text-foreground">
          {quizRangeLabel(quiz.fromPage, quiz.throughPage)}
        </p>
        {attempted ? (
          <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
            In progress · needs revision
          </Badge>
        ) : (
          <Badge variant="outline">Awaiting submission</Badge>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {attempted
          ? `${quiz.attempts.length} ${quiz.attempts.length === 1 ? "attempt" : "attempts"} so far`
          : "Not started yet"}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={quizResultsHref(quiz.id, memberEmail)}
          className={cn(buttonVariants({ variant: "default", size: "sm" }))}
        >
          View quiz
        </Link>
        {/* Curate/steer the question while the kid hasn't started (unlocked). */}
        {!attempted && (
          <Link
            href={quizEditHref(quiz.id, memberEmail)}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Steer question
          </Link>
        )}
        <GenerateDraftButton
          bookId={book.bookId}
          memberEmail={memberEmail}
          fromPage={quiz.fromPage}
          throughPage={quiz.throughPage}
          label="Regenerate"
          regenerate
        />
        <CloseQuizButton
          quizId={quiz.id}
          memberEmail={memberEmail}
          variant="ghost"
        />
        <DeleteQuizButton quizId={quiz.id} memberEmail={memberEmail} />
      </div>
    </div>
  );
}

function DraftCard({
  quiz,
  memberEmail,
}: {
  quiz: ReadingAdminQuiz;
  memberEmail: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm capitalize text-foreground">
          {quizRangeLabel(quiz.fromPage, quiz.throughPage)}
        </p>
        <Badge variant="secondary">Draft — not published</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Review and publish it to make it the live quiz (this replaces any current
        one).
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={quizEditHref(quiz.id, memberEmail)}
          className={cn(buttonVariants({ variant: "default", size: "sm" }))}
        >
          Review draft
        </Link>
        <DeleteQuizButton quizId={quiz.id} memberEmail={memberEmail} />
      </div>
    </div>
  );
}

function historyLabel(quiz: ReadingAdminQuiz): string {
  if (quiz.closedByParent) return "Closed by parent";
  if (quiz.passed) return "Passed";
  if (quiz.status === "archived") return "Replaced";
  if (quiz.status === "draft") return "Draft";
  return "—";
}
