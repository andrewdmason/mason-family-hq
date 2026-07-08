import "server-only";
import {
  ESSAY_OPTION_COUNT,
  generateEssayAssignments,
  type GeneratedEssaySet,
} from "@/lib/reading/quiz-generate";

export type SteeringTurn = { role: "user" | "assistant"; content: string };

/** A two-part candidate as it exists on the quiz, for rendering into the thread. */
export type CurrentCandidate = {
  comprehensionPrompt: string | null;
  prompt: string;
};

/** Render two-part candidates as plain text for the steering thread and prompt. */
export function renderCandidates(candidates: CurrentCandidate[]): string {
  return candidates
    .map(
      (c, i) =>
        `Candidate ${i + 1}\n  Part 1: ${c.comprehensionPrompt ?? "(none)"}\n` +
        `  Part 2: ${c.prompt}`
    )
    .join("\n\n");
}

/** The assistant's thread turn: what it just proposed, so the next round can build
 *  on it (and the parent can see the running conversation). */
export function renderGeneratedForThread(set: GeneratedEssaySet): string {
  return renderCandidates(
    set.options.map((o) => ({
      comprehensionPrompt: o.comprehensionPrompt,
      prompt: o.prompt,
    }))
  );
}

/**
 * Regenerate a quiz's three two-part candidates from the accumulated parent↔AI
 * steering conversation plus the parent's latest guidance. Reuses the same
 * tool-forced two-part generator (so the shape and interest-forward Part 2 hold),
 * seeding it with the prior turns and a note carrying the current candidates and
 * the new guidance. Resilient: returns an empty set on failure so the caller keeps
 * the existing candidates and surfaces a retry rather than blanking them.
 */
export async function regenerateSteeredCandidates(input: {
  bookTitle: string;
  author: string | null;
  fromPage: number | null;
  throughPage: number;
  text: string;
  readerAge: number | null;
  readerContext: string | null;
  minWords: number;
  priorTurns: SteeringTurn[];
  currentCandidates: CurrentCandidate[];
  guidance: string;
}): Promise<GeneratedEssaySet> {
  const steeringNote =
    `A parent is steering these prompts for their child. The current ` +
    `${ESSAY_OPTION_COUNT} candidates are:\n\n` +
    `${renderCandidates(input.currentCandidates)}\n\n` +
    `The parent's latest guidance: "${input.guidance.trim()}"\n\n` +
    `Rewrite ALL ${ESSAY_OPTION_COUNT} candidates to follow this guidance and the ` +
    `whole conversation above. Keep each a two-part assignment (a short Part 1 ` +
    `comprehension check + a Part 2 that asks the child to take and defend a point of ` +
    `view on something real in their own life, not a feelings check-in), keep them ` +
    `genuinely distinct, and keep every Part 1 anchored in the book text below.`;

  return generateEssayAssignments({
    bookTitle: input.bookTitle,
    author: input.author,
    fromPage: input.fromPage,
    throughPage: input.throughPage,
    text: input.text,
    readerAge: input.readerAge,
    readerContext: input.readerContext,
    minWords: input.minWords,
    priorTurns: input.priorTurns,
    steeringNote,
  });
}
