import { cn } from "@/lib/utils";
import { ESSAY_BONUS_BUCKS } from "@/lib/reading/essay-scoring";
import type { ThinkingBand } from "@/lib/types";

/**
 * The single source of truth for how an essay is graded, shared by the writing screen's
 * always-on criteria sidebar, the "how it's graded" dialog, and the feedback card's band
 * labels. Two pass/fail gates (a quick reading check, then readable writing), and one
 * real grade — the quality of thinking — on a below/meets/exceeds band.
 */

/** Band labels + how each reads, shared by the criteria panel and the feedback card. */
export const THINKING_BANDS: Record<
  ThinkingBand,
  { label: string; verdict: string; tone: "amber" | "emerald" | "gold" }
> = {
  below: {
    label: "Below expectations",
    verdict: "Not there yet — revise and turn it in again.",
    tone: "amber",
  },
  meets: {
    label: "Meets expectations",
    verdict: "Solid, honest thinking — this passes.",
    tone: "emerald",
  },
  exceeds: {
    label: "Exceeds expectations",
    verdict: `Real insight — you earned ${ESSAY_BONUS_BUCKS} Mason Bucks.`,
    tone: "gold",
  },
};

/** What strong thinking looks like — the static bullets the writer always sees. */
const GOOD_ESSAY = [
  {
    title: "Say what you actually think",
    detail:
      "Take a real point of view of your own — not a summary of the book or something anyone could say.",
  },
  {
    title: "Back it up",
    detail:
      "Use one specific example from your own life (or the book) and say why it matters.",
  },
  {
    title: "Go further to earn the bonus",
    detail: `Show another side, a tension, or how your thinking changed — real insight like that earns ${ESSAY_BONUS_BUCKS} Mason Bucks (length and big words don't).`,
  },
];

/** The two pass/fail gates, shown above the thinking bullets. */
const GATES = [
  {
    title: "Show you read it",
    detail: "A quick check first — a sentence or two proving you read the pages.",
  },
  {
    title: "Write so it's easy to read",
    detail:
      "Real sentences, broken into paragraphs, with spelling and punctuation mostly right.",
  },
];

function Bullet({ title, detail }: { title: string; detail: string }) {
  return (
    <li className="flex gap-3">
      <span
        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/40"
        aria-hidden
      />
      <div>
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
    </li>
  );
}

/**
 * The static "what makes a good essay" content — same on every essay. Rendered in the
 * writing screen's sidebar (always visible) and inside the grading-criteria dialog.
 */
export function EssayCriteriaContent({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-5", className)}>
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Two quick checks, then the part that really counts — your thinking.
        </p>
      </div>

      <ul className="space-y-3">
        {GATES.map((g) => (
          <Bullet key={g.title} title={g.title} detail={g.detail} />
        ))}
      </ul>

      <div className="border-t border-border/60 pt-4">
        <p className="font-serif text-xs uppercase tracking-wide text-muted-foreground">
          What makes the thinking strong
        </p>
        <ul className="mt-3 space-y-3">
          {GOOD_ESSAY.map((g) => (
            <Bullet key={g.title} title={g.title} detail={g.detail} />
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The always-on sidebar panel for the writing screen — a bordered card wrapping the
 * static criteria, so the reader can always see what they're being graded on.
 */
export function EssayCriteriaPanel({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card shadow-sm",
        className
      )}
    >
      <div className="border-b border-border/60 px-5 py-3">
        <p className="font-serif text-[0.7rem] uppercase tracking-[0.15em] text-muted-foreground">
          What makes a good essay
        </p>
      </div>
      <div className="px-5 py-4">
        <EssayCriteriaContent />
      </div>
    </div>
  );
}
