"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Lock, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteQuiz,
  publishQuiz,
  regenerateQuizDraft,
  setChosenQuestion,
  steerQuizQuestions,
  updateQuizQuestion,
  type QuizSteeringMessage,
} from "@/app/(books)/books/quizzes/actions";
import { bookshelfHref } from "@/lib/reading/links";
import { quizRangeLabel } from "@/lib/reading/quiz-format";
import { cn } from "@/lib/utils";
import type { ReadingQuizQuestion, ReadingQuizWithQuestions } from "@/lib/types";

export function QuizDraftEditor({
  quiz,
  memberEmail = null,
  steeringMessages = [],
  locked = false,
}: {
  quiz: ReadingQuizWithQuestions;
  memberEmail?: string | null;
  /** The parent↔AI steering conversation for this quiz (essay quizzes). */
  steeringMessages?: QuizSteeringMessage[];
  /** True once the kid has started — the whole surface goes read-only. */
  locked?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isEssay =
    quiz.questions.length > 0 && quiz.questions.every((q) => q.type === "essay");
  const isDraft = quiz.status === "draft";
  const mcCount = quiz.questions.filter((q) => q.type === "multiple_choice").length;
  const ftCount = quiz.questions.filter((q) => q.type === "free_text").length;
  const editable = !locked;

  function handleRegenerate() {
    if (
      !window.confirm(
        "Regenerate this quiz? The current questions and any edits will be replaced."
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await regenerateQuizDraft(quiz.id, memberEmail);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't regenerate.");
      }
    });
  }

  function handlePublish() {
    setError(null);
    startTransition(async () => {
      try {
        await publishQuiz(quiz.id, memberEmail);
        router.push(bookshelfHref(memberEmail));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't publish.");
      }
    });
  }

  function handleDelete() {
    if (!window.confirm("Delete this quiz?")) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteQuiz(quiz.id, memberEmail);
        router.push(bookshelfHref(memberEmail));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete.");
      }
    });
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-serif text-2xl tracking-tight text-foreground">
              {quiz.title || "Quiz"}
            </h1>
            <Badge variant="secondary">{isDraft ? "Draft" : "Published"}</Badge>
          </div>
          <p className="mt-1 text-sm capitalize text-muted-foreground">
            {quizRangeLabel(quiz.from_page, quiz.through_page)} ·{" "}
            {isEssay
              ? "two-part essay"
              : `${mcCount} multiple-choice · ${ftCount} writing`}
          </p>
        </div>
        {editable && (
          <div className="flex items-center gap-2">
            {isDraft && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRegenerate}
                disabled={pending}
              >
                <RefreshCw className="h-4 w-4" />
                Regenerate
              </Button>
            )}
            {isDraft && (
              <Button
                type="button"
                size="sm"
                onClick={handlePublish}
                disabled={pending || quiz.questions.length === 0}
              >
                <Check className="h-4 w-4" />
                Publish
              </Button>
            )}
          </div>
        )}
      </div>

      {locked && (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" />
          The reader has started — this question is locked and can no longer be
          changed. Steer the next quiz instead.
        </p>
      )}

      {quiz.generation_error && (
        <p className="mt-4 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {quiz.generation_error} Use Regenerate to try again.
        </p>
      )}

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      <div className="mt-6 space-y-4">
        {isEssay && quiz.questions.length > 1 && (
          <p className="text-sm text-muted-foreground">
            Three candidates — pick the one your kid writes, edit it, or steer the
            AI below for a new set. The reader only sees the one you pick.
          </p>
        )}
        {quiz.questions.map((question, i) => (
          <QuestionCard
            key={question.id}
            index={i}
            question={question}
            memberEmail={memberEmail}
            isChosen={question.id === quiz.chosen_question_id}
            canPick={isEssay && quiz.questions.length > 1}
            editable={editable}
            onSaved={() => router.refresh()}
          />
        ))}
        {quiz.questions.length === 0 && (
          <p className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            No questions yet. Try Regenerate.
          </p>
        )}
      </div>

      {isEssay && (
        <SteeringChat
          quizId={quiz.id}
          memberEmail={memberEmail}
          messages={steeringMessages}
          locked={locked}
          onRegenerated={() => router.refresh()}
        />
      )}

      {editable && (
        <div className="mt-8 border-t border-border pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            disabled={pending}
            className="text-destructive hover:text-destructive"
          >
            Delete quiz
          </Button>
        </div>
      )}
    </main>
  );
}

/**
 * The parent↔AI steering conversation: the running thread, then a box to send
 * guidance and regenerate all three candidates. Building on the whole thread, not
 * just the latest note. Read-only once the reader has started.
 */
function SteeringChat({
  quizId,
  memberEmail,
  messages,
  locked,
  onRegenerated,
}: {
  quizId: string;
  memberEmail: string | null;
  messages: QuizSteeringMessage[];
  locked: boolean;
  onRegenerated: () => void;
}) {
  const [guidance, setGuidance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    const note = guidance.trim();
    if (!note) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await steerQuizQuestions(quizId, note, memberEmail);
        if (res.status === "failed") {
          setError(
            "The AI couldn't write a new set from that — your note was saved, try rephrasing and send again."
          );
          return;
        }
        setGuidance("");
        onRegenerated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't regenerate.");
      }
    });
  }

  if (locked && messages.length === 0) return null;

  return (
    <section className="mt-8 rounded-lg border border-border">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground">Steer the AI</h2>
      </header>

      {messages.length > 0 && (
        <ol className="space-y-3 px-4 py-3">
          {messages.map((m) => (
            <li
              key={m.id}
              className={cn(
                "text-sm",
                m.role === "user" ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {m.role === "user" ? "You asked" : "New candidates"}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap leading-relaxed">
                {m.content}
              </p>
            </li>
          ))}
        </ol>
      )}

      {locked ? (
        <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
          Locked — the reader has started.
        </p>
      ) : (
        <div className="grid gap-2 border-t border-border px-4 py-3">
          <Label htmlFor="steer-guidance" className="sr-only">
            What should the AI change?
          </Label>
          <Textarea
            id="steer-guidance"
            placeholder="e.g. Make Part 2 about his baseball goals, not stats — tie it to teamwork."
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            disabled={pending}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={send}
              disabled={pending || !guidance.trim()}
            >
              {pending ? "Regenerating…" : "Regenerate 3 new"}
            </Button>
            <span className="text-xs text-muted-foreground">
              Builds on the whole conversation above.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function QuestionCard({
  index,
  question,
  memberEmail,
  isChosen,
  canPick,
  editable,
  onSaved,
}: {
  index: number;
  question: ReadingQuizQuestion;
  memberEmail: string | null;
  isChosen: boolean;
  canPick: boolean;
  editable: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pick() {
    setError(null);
    startTransition(async () => {
      try {
        await setChosenQuestion(question.quiz_id, question.id, memberEmail);
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't pick this one.");
      }
    });
  }

  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3",
        isChosen ? "border-primary bg-primary/5" : "border-border"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {question.type === "essay" ? `Option ${index + 1}` : `Q${index + 1}`}
          </span>
          <Badge variant="outline">
            {question.type === "multiple_choice"
              ? "Multiple choice"
              : question.type === "essay"
                ? "Two-part essay"
                : "Writing"}
          </Badge>
          {isChosen && canPick && <Badge>Chosen</Badge>}
        </div>
        {!editing && (
          <div className="flex items-center gap-1">
            {editable && canPick && !isChosen && (
              <Button type="button" variant="outline" size="xs" onClick={pick} disabled={pending}>
                {pending ? "Picking…" : "Use this one"}
              </Button>
            )}
            {editable && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            )}
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {editing ? (
        <QuestionEditForm
          question={question}
          memberEmail={memberEmail}
          onDone={(saved) => {
            setEditing(false);
            if (saved) onSaved();
          }}
        />
      ) : (
        <QuestionPreview question={question} />
      )}
    </div>
  );
}

function QuestionPreview({ question }: { question: ReadingQuizQuestion }) {
  if (question.type === "essay") {
    return (
      <div className="mt-2 space-y-2">
        {question.comprehension_prompt && (
          <p className="text-sm leading-relaxed text-foreground">
            <span className="font-medium text-muted-foreground">Part 1:</span>{" "}
            {question.comprehension_prompt}
          </p>
        )}
        <p className="text-sm leading-relaxed text-foreground">
          <span className="font-medium text-muted-foreground">Part 2:</span>{" "}
          {question.prompt}
        </p>
        <div className="space-y-1 text-xs text-muted-foreground">
          {question.anchor_summary && (
            <p>
              <span className="font-medium text-foreground">
                Anchor (hidden from the reader):
              </span>{" "}
              {question.anchor_summary}
            </p>
          )}
          {question.essay_rubric && (
            <>
              <p>
                <span className="font-medium text-foreground">Comprehension gate:</span>{" "}
                {question.essay_rubric.comprehension}
              </p>
              <p>
                <span className="font-medium text-foreground">Grammar (readability gate):</span>{" "}
                {question.essay_rubric.grammar}
              </p>
              <p>
                <span className="font-medium text-foreground">Thinking:</span>{" "}
                {question.essay_rubric.thinking}
              </p>
            </>
          )}
          <p>
            <span className="font-medium text-foreground">Minimum words (Part 2):</span>{" "}
            {question.min_words ?? "—"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <p className="text-sm text-foreground">{question.prompt}</p>
      {question.type === "multiple_choice" ? (
        <>
          <ul className="mt-2 space-y-1">
            {(question.options ?? []).map((opt, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  i === question.correct_index
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {i === question.correct_index ? (
                  <Check className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <span className="h-3.5 w-3.5" />
                )}
                {opt}
              </li>
            ))}
          </ul>
          {question.explanation && (
            <p className="mt-2 text-xs italic text-muted-foreground">
              Why: {question.explanation}
            </p>
          )}
        </>
      ) : (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {question.grading_rubric && (
            <p>
              <span className="font-medium text-foreground">Rubric:</span>{" "}
              {question.grading_rubric}
            </p>
          )}
          {question.sample_answer && (
            <p>
              <span className="font-medium text-foreground">Sample:</span>{" "}
              {question.sample_answer}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function QuestionEditForm({
  question,
  memberEmail,
  onDone,
}: {
  question: ReadingQuizQuestion;
  memberEmail: string | null;
  onDone: (saved: boolean) => void;
}) {
  const [comprehensionPrompt, setComprehensionPrompt] = useState(
    question.comprehension_prompt ?? ""
  );
  const [prompt, setPrompt] = useState(question.prompt);
  const [options, setOptions] = useState<string[]>(question.options ?? []);
  const [correctIndex, setCorrectIndex] = useState(question.correct_index ?? 0);
  const [explanation, setExplanation] = useState(question.explanation ?? "");
  const [rubric, setRubric] = useState(question.grading_rubric ?? "");
  const [sample, setSample] = useState(question.sample_answer ?? "");
  const [comprehension, setComprehension] = useState(
    question.essay_rubric?.comprehension ?? ""
  );
  const [grammar, setGrammar] = useState(
    question.essay_rubric?.grammar ?? ""
  );
  const [thinking, setThinking] = useState(question.essay_rubric?.thinking ?? "");
  const [minWords, setMinWords] = useState(String(question.min_words ?? 150));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        if (question.type === "multiple_choice") {
          await updateQuizQuestion(
            question.id,
            { prompt, options, correctIndex, explanation },
            memberEmail
          );
        } else if (question.type === "essay") {
          const words = Number(minWords);
          await updateQuizQuestion(
            question.id,
            {
              comprehensionPrompt,
              prompt,
              essayRubric: { comprehension, grammar, thinking },
              ...(Number.isFinite(words) && words > 0 ? { minWords: words } : {}),
            },
            memberEmail
          );
        } else {
          await updateQuizQuestion(
            question.id,
            { prompt, gradingRubric: rubric, sampleAnswer: sample },
            memberEmail
          );
        }
        onDone(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save.");
      }
    });
  }

  return (
    <div className="mt-3 grid gap-3">
      {question.type === "essay" && (
        <div className="grid gap-1.5">
          <Label htmlFor={`part1-${question.id}`}>Part 1 · Comprehension prompt</Label>
          <Textarea
            id={`part1-${question.id}`}
            value={comprehensionPrompt}
            onChange={(e) => setComprehensionPrompt(e.target.value)}
          />
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor={`prompt-${question.id}`}>
          {question.type === "essay" ? "Part 2 · Writing prompt" : "Question"}
        </Label>
        <Textarea
          id={`prompt-${question.id}`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      {question.type === "essay" ? (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor={`comprehension-${question.id}`}>
              Rubric · Comprehension gate
            </Label>
            <Textarea
              id={`comprehension-${question.id}`}
              value={comprehension}
              onChange={(e) => setComprehension(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`grammar-${question.id}`}>
              Rubric · Grammar (readability gate)
            </Label>
            <Textarea
              id={`grammar-${question.id}`}
              value={grammar}
              onChange={(e) => setGrammar(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`thinking-${question.id}`}>Rubric · Thinking</Label>
            <Textarea
              id={`thinking-${question.id}`}
              value={thinking}
              onChange={(e) => setThinking(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`minwords-${question.id}`}>Minimum words (Part 2)</Label>
            <Input
              id={`minwords-${question.id}`}
              type="number"
              min={1}
              value={minWords}
              onChange={(e) => setMinWords(e.target.value)}
            />
          </div>
        </>
      ) : question.type === "multiple_choice" ? (
        <>
          <div className="grid gap-1.5">
            <Label>Options (select the correct one)</Label>
            {options.map((opt, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`correct-${question.id}`}
                  checked={correctIndex === i}
                  onChange={() => setCorrectIndex(i)}
                  aria-label={`Mark option ${i + 1} correct`}
                />
                <Input
                  value={opt}
                  onChange={(e) =>
                    setOptions((prev) =>
                      prev.map((o, j) => (j === i ? e.target.value : o))
                    )
                  }
                />
              </div>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`explanation-${question.id}`}>
              Why it&apos;s correct
            </Label>
            <Textarea
              id={`explanation-${question.id}`}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor={`rubric-${question.id}`}>
              Grading rubric (what a correct answer needs)
            </Label>
            <Textarea
              id={`rubric-${question.id}`}
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`sample-${question.id}`}>Sample answer</Label>
            <Textarea
              id={`sample-${question.id}`}
              value={sample}
              onChange={(e) => setSample(e.target.value)}
            />
          </div>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onDone(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
