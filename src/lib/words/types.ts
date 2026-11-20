// Words: daily ISEE vocabulary practice. The words, their questions and the
// word parts are files in ./content (written once by scripts/words); these are
// the shapes of that content and of what each person has done with it.

export type Level = "lower" | "middle";

/** The kinds of wrong answer the ISEE sets, which every wrong choice is labelled with. */
export type Trap =
  | "opposite"
  | "lookalike"
  | "soundalike"
  | "root"
  | "related"
  | "tone"
  | "strength"
  | "broad"
  | "other-meaning";

export type WrongChoice = { text: string; trap?: Trap; why?: string };

/** One way of asking about a word or part: what's shown, the right answer, three traps, and the tip for a miss. */
export type Form = {
  kind: "syn" | "sc" | "part";
  /** The word in capitals, the sentence with its blank, or the question about a word part. */
  stem: string;
  answer: string;
  traps: WrongChoice[];
  tip: string;
};

export type WordItem = {
  /** "w:abundant" */
  id: string;
  type: "word";
  word: string;
  pos: string;
  meaning: string;
  example: string;
  /** One sentence that makes it stick. */
  hook: string;
  tone: "positive" | "negative" | "neutral";
  /** Ids of the word parts it's built from ("p:bene"). */
  parts: string[];
  tier: "core" | "ext";
  /** Its place in the order words are met: core before extension, common before rare. */
  rank: number;
  forms: Record<string, Form>;
};

export type PartItem = {
  /** "p:bene" */
  id: string;
  type: "part";
  /** As written: "bene-", "scrib/script", "-less". */
  part: string;
  kind: "prefix" | "root" | "suffix";
  meaning: string;
  examples: string[];
  hook: string;
  rank: number;
  forms: Record<string, Form>;
};

export type Item = WordItem | PartItem;

export type Result = "correct" | "wrong" | "dontknow";

/** A words_progress row. No row means the item is still new. */
export type Progress = {
  item: string;
  /** 0 learning, 1 and 2 almost, 3 mastered. */
  stage: number;
  due_on: string;
  fast: boolean;
  first_seen_on: string;
  last_seen_on: string;
  last_correct_on: string | null;
  correct_days: number;
  forms_right: string[];
  last_form: string | null;
  seen: number;
  right_count: number;
  wrong_count: number;
  dontknow_count: number;
  mastered_at: string | null;
  /** Taken out by the person: never asked again unless they bring it back. */
  removed_at?: string | null;
};

export type Status = "new" | "learning" | "almost" | "mastered" | "removed";

export const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  learning: "Learning",
  almost: "Almost",
  mastered: "Mastered",
  removed: "Removed",
};

export function statusOf(progress: Progress | undefined | null): Status {
  if (!progress) return "new";
  if (progress.removed_at) return "removed";
  if (progress.stage >= 3) return "mastered";
  return progress.stage === 0 ? "learning" : "almost";
}

/** The question as the browser gets it: no answer in it. */
export type ClientQuestion = {
  position: number;
  total: number;
  kind: Form["kind"];
  stem: string;
  choices: string[];
  /** A word or part they've never been asked before. */
  isNew: boolean;
  allowDontKnow: boolean;
};

export type PartNote = { part: string; meaning: string };

/** What comes back after an answer: how it went, and the word laid out for learning. */
export type Feedback = {
  result: Result;
  correctIndex: number;
  /** Why the choice they picked is wrong, when it was. */
  chosenWhy: string | null;
  tip: string;
  /** The word or part itself. */
  title: string;
  pos: string | null;
  meaning: string;
  example: string | null;
  hook: string;
  parts: PartNote[];
  /** It just became mastered. */
  mastered: boolean;
};

export type SessionSummary = {
  id: string;
  total: number;
  correct: number;
  wrong: number;
  dontknow: number;
  elapsedMs: number;
  limitMs: number;
  newItems: number;
  masteredGained: number;
  /** What was missed, to look over at the end. */
  missed: { title: string; meaning: string }[];
};

export type SessionState = {
  sessionId: string;
  elapsedMs: number;
  limitMs: number;
  noDontKnow: boolean;
  question: ClientQuestion | null;
  summary: SessionSummary | null;
};
