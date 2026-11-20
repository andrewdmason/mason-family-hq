"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Undo2, Volume2, X } from "lucide-react";
import { beginSession, submitAnswer } from "@/app/(words)/words/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ClientQuestion, Feedback, SessionState, SessionSummary } from "@/lib/words/types";

const LETTERS = ["A", "B", "C", "D"];
const KIND_LABEL: Record<ClientQuestion["kind"], string> = {
  syn: "Which word means nearly the same?",
  sc: "Which word best completes the sentence?",
  part: "Word part",
};

function clock(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * One timed session: a question at a time against a ten-minute countdown.
 * The clock only runs while a question is waiting for an answer, so reading
 * the tip after a miss costs nothing. When it runs out they finish anyway and
 * the end screen says how far over they went.
 */
export function SessionRunner({ initial }: { initial: SessionState }) {
  const [state, setState] = useState(initial);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [picked, setPicked] = useState<number | null | undefined>(undefined);
  const [pending, setPending] = useState<SessionState | null>(null);
  // Choices they've ruled out on the question on screen. Theirs to keep track of: nothing is sent or saved.
  const [crossed, setCrossed] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Time spent on the question on screen; the server holds the rest.
  const [running, setRunning] = useState(0);
  const startedAt = useRef<number>(0);
  const lesson = useRef<HTMLDivElement>(null);

  const question = state.question;
  const waiting = !!question && picked === undefined;

  useEffect(() => {
    if (!waiting) return;
    startedAt.current = performance.now();
    setRunning(0);
    const timer = setInterval(() => setRunning(performance.now() - startedAt.current), 250);
    return () => clearInterval(timer);
  }, [waiting, question?.position]);

  const advance = useCallback(() => {
    if (!pending) return;
    setState(pending);
    setPending(null);
    setFeedback(null);
    setPicked(undefined);
    setCrossed([]);
    setRunning(0);
  }, [pending]);

  const toggleCross = useCallback((i: number) => {
    setCrossed((list) => (list.includes(i) ? list.filter((n) => n !== i) : [...list, i]));
  }, []);

  const answer = useCallback(
    async (choice: number | null) => {
      if (!question || picked !== undefined || busy) return;
      const ms = performance.now() - startedAt.current;
      setPicked(choice);
      setRunning(ms);
      setBusy(true);
      setFailed(false);
      try {
        const result = await submitAnswer(state.sessionId, question.position, choice, ms);
        if (!result) {
          // The session moved on without this tab (another device, or a second tap): pick it up where it is.
          const fresh = await beginSession();
          if (fresh) setState(fresh);
          setCrossed([]);
          setPicked(undefined);
          return;
        }
        setFeedback(result.feedback);
        setPending(result.state);
      } catch {
        setFailed(true);
        setPicked(undefined);
      } finally {
        setBusy(false);
      }
    },
    [question, picked, busy, state.sessionId]
  );

  // A right answer moves on by itself; a miss waits for them to read it.
  useEffect(() => {
    if (!feedback || feedback.result !== "correct" || !pending) return;
    const timer = setTimeout(advance, feedback.mastered ? 1500 : 900);
    return () => clearTimeout(timer);
  }, [feedback, pending, advance]);

  // After a miss the word's card can land below the fold on a phone: bring it up.
  useEffect(() => {
    if (feedback && feedback.result !== "correct") lesson.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [feedback]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (feedback && pending && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        advance();
        return;
      }
      if (!waiting || !question) return;
      const byNumber = ["1", "2", "3", "4"].indexOf(e.key);
      const byLetter = LETTERS.indexOf(e.key.toUpperCase());
      const index = byNumber >= 0 ? byNumber : byLetter;
      if (index < 0 || index >= question.choices.length) return;
      // Shift with a letter crosses that choice off (or brings it back); a crossed-off choice can't be picked by key.
      if (e.shiftKey) toggleCross(index);
      else if (!crossed.includes(index)) answer(index);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [waiting, question, feedback, pending, answer, advance, crossed, toggleCross]);

  if (state.summary) return <Summary summary={state.summary} />;
  if (!question) return null;

  const spent = pending?.elapsedMs ?? state.elapsedMs + running;
  const left = state.limitMs - spent;
  const missed = feedback && feedback.result !== "correct";

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-5 pb-8 pt-4">
      <div className="flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground/70 transition-[width] duration-300"
            style={{ width: `${((question.position - 1 + (feedback ? 1 : 0)) / question.total) * 100}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {question.position} of {question.total}
        </span>
        <span
          className={cn(
            "min-w-14 rounded-md px-2 py-1 text-center text-sm font-medium tabular-nums",
            left < 0 ? "bg-destructive/10 text-destructive" : left < 60_000 ? "bg-amber-100 text-amber-900" : "bg-muted text-foreground"
          )}
          aria-label={left < 0 ? `${clock(left)} over time` : `${clock(left)} left`}
        >
          {left < 0 ? `+${clock(left)}` : clock(left)}
        </span>
      </div>

      <div className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{KIND_LABEL[question.kind]}</span>
        {question.isNew && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-foreground">New</span>}
      </div>
      <h1
        className={cn(
          "mt-2 text-foreground",
          question.kind === "syn" ? "font-serif text-4xl tracking-wide" : "text-xl leading-relaxed"
        )}
      >
        {question.stem}
      </h1>

      <div className="mt-6 grid gap-2">
        {question.choices.map((text, i) => {
          const isCorrect = feedback?.correctIndex === i;
          const isPicked = picked === i;
          const isCrossed = !feedback && crossed.includes(i);
          return (
            <div key={`${question.position}-${i}`} className="relative">
              <button
                type="button"
                disabled={picked !== undefined}
                // Tapping a crossed-off choice brings it back; it takes a second tap to pick it.
                onClick={() => (isCrossed ? toggleCross(i) : answer(i))}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border border-border bg-card py-3.5 pl-4 pr-14 text-left text-base transition-colors",
                  picked === undefined && !isCrossed && "hover:border-foreground/30 hover:bg-accent active:bg-accent",
                  isCrossed && "border-dashed bg-transparent text-muted-foreground",
                  feedback && isCorrect && "border-emerald-500 bg-emerald-50 text-emerald-900",
                  feedback && isPicked && !isCorrect && "border-destructive bg-destructive/10",
                  !feedback && isPicked && "border-foreground/40 bg-accent",
                  feedback && !isCorrect && !isPicked && "opacity-50"
                )}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs text-muted-foreground">
                  {LETTERS[i]}
                </span>
                <span className={cn("flex-1", isCrossed && "line-through")}>{text}</span>
              </button>
              <span className="absolute inset-y-0 right-2 flex items-center">
                {feedback && isCorrect && <Check className="mr-2 size-5 text-emerald-600" />}
                {feedback && isPicked && !isCorrect && <X className="mr-2 size-5 text-destructive" />}
                {picked === undefined && (
                  <button
                    type="button"
                    onClick={() => toggleCross(i)}
                    aria-pressed={isCrossed}
                    aria-label={isCrossed ? `Bring back ${text}` : `Cross off ${text}`}
                    title={isCrossed ? "Bring back" : "Cross off"}
                    className="flex size-10 items-center justify-center rounded-full text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                  >
                    {isCrossed ? <Undo2 className="size-4" /> : <X className="size-4" />}
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {!feedback && question.allowDontKnow && (
        <button
          type="button"
          disabled={picked !== undefined}
          onClick={() => answer(null)}
          className={cn(
            "mt-2 rounded-xl border border-dashed border-border px-4 py-3 text-center text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
            picked === null && "border-foreground/40 text-foreground"
          )}
        >
          Don&rsquo;t know
        </button>
      )}
      {!feedback && !question.allowDontKnow && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Test-day practice: rule out what you can, then take your best guess.
        </p>
      )}
      {failed && <p className="mt-3 text-center text-sm text-destructive">That didn&rsquo;t go through. Try again.</p>}

      {feedback && feedback.result === "correct" && (
        <p className="mt-5 text-center text-sm text-muted-foreground">
          {feedback.mastered ? (
            <span className="font-medium text-emerald-700">Mastered: {feedback.title}</span>
          ) : (
            <>
              <span className="font-medium text-foreground">{feedback.title}</span>: {feedback.meaning}
            </>
          )}
        </p>
      )}

      {missed && feedback && (
        <div ref={lesson} className="mt-5 scroll-mb-6 rounded-xl border border-border bg-card p-4">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-2xl text-foreground">{feedback.title}</span>
            {feedback.pos && <span className="text-xs italic text-muted-foreground">{feedback.pos}</span>}
            <SayIt word={feedback.title} show={feedback.pos !== "prefix" && feedback.pos !== "root" && feedback.pos !== "suffix"} />
          </div>
          <p className="mt-1 text-base text-foreground">{feedback.meaning}</p>
          {feedback.example && <p className="mt-1 text-sm italic text-muted-foreground">{feedback.example}</p>}

          {feedback.chosenWhy && (
            <p className="mt-3 text-sm text-foreground">
              <span className="font-medium">Why not {question.choices[picked as number]}?</span> {feedback.chosenWhy}
            </p>
          )}
          <p className="mt-3 text-sm text-foreground">
            <span className="font-medium">Next time:</span> {feedback.tip}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{feedback.hook}</p>
          {feedback.parts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {feedback.parts.map((p) => (
                <span key={p.part} className="rounded-full bg-accent px-2.5 py-1 text-xs text-foreground">
                  <span className="font-medium">{p.part}</span> means {p.meaning}
                </span>
              ))}
            </div>
          )}
          <Button className="mt-4 w-full" size="lg" onClick={advance} disabled={!pending}>
            {pending?.summary ? "Finish" : "Next"}
          </Button>
        </div>
      )}
    </div>
  );
}

function SayIt({ word, show }: { word: string; show: boolean }) {
  // Only ever drawn after an answer, so there's a browser to ask.
  if (!show || typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return (
    <button
      type="button"
      aria-label={`Hear ${word}`}
      className="ml-auto rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={() => {
        window.speechSynthesis.cancel();
        const say = new SpeechSynthesisUtterance(word);
        say.lang = "en-US";
        say.rate = 0.9;
        window.speechSynthesis.speak(say);
      }}
    >
      <Volume2 className="size-4" />
    </button>
  );
}

function Summary({ summary }: { summary: SessionSummary }) {
  const spare = summary.limitMs - summary.elapsedMs;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-5 pb-8 pt-8">
      <h1 className="font-serif text-3xl tracking-tight text-foreground">Done for today</h1>
      <p className={cn("mt-2 text-base", spare >= 0 ? "text-emerald-700" : "text-amber-800")}>
        {spare >= 0 ? `Finished with ${clock(spare)} to spare.` : `Finished ${clock(spare)} over the ten minutes.`}
      </p>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Right" value={`${summary.correct} of ${summary.total}`} />
        <Stat label="New today" value={String(summary.newItems)} />
        <Stat label="Mastered" value={String(summary.masteredGained)} />
      </div>

      {summary.missed.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-foreground">To look over</h2>
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-card">
            {summary.missed.map((m) => (
              <li key={m.title} className="flex flex-col px-4 py-2.5">
                <span className="font-medium text-foreground">{m.title}</span>
                <span className="text-sm text-muted-foreground">{m.meaning}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">These come back tomorrow.</p>
        </div>
      )}

      <div className="mt-8 flex flex-col gap-2">
        <Link href="/words" className={buttonVariants({ size: "lg" })}>
          Done
        </Link>
        {/* A full page load, so the next session starts from a fresh one. */}
        <a href="/words/session" className={buttonVariants({ variant: "ghost" })}>
          Do another
        </a>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3 text-center">
      <div className="text-xl font-medium tabular-nums text-foreground">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
