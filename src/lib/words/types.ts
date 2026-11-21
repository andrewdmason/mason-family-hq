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
  removed: "Skipped",
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
  /** Only for the Tuttles app, which grades on the phone so an answer shows at once. */
  key?: QuestionKey;
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

/**
 * A question's answer, sent along with it so it can be graded where it's
 * shown, without waiting on the network. The server still grades the answer
 * when it arrives; this only says ahead of time what it will say.
 */
export type QuestionKey = Omit<Feedback, "result" | "chosenWhy" | "mastered"> & {
  /** For each choice, why it's wrong: null for the right one, or when nothing is written. */
  whys: (string | null)[];
  /** A right answer would make it mastered. */
  masteredIfRight: boolean;
};

/** A word in the sort, with a question on it (and the answer) for the spot check. */
export type SortWord = { id: string; title: string; question: ClientQuestion };

/**
 * A page of the sort: the commonest words not yet met, to say which of them
 * are known already. `through` is how far down the list the page goes, and
 * `left` how many words are still to look at, this page included.
 */
export type SortPage = { words: SortWord[]; through: number; left: number };

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
  /** Time spent answering today, this session included, and the day's ten minutes. */
  dayMs: number;
  goalMs: number;
};

export type SessionState = {
  sessionId: string;
  elapsedMs: number;
  limitMs: number;
  noDontKnow: boolean;
  question: ClientQuestion | null;
  summary: SessionSummary | null;
  /**
   * Only for the Tuttles app: the question that follows a right answer to this
   * one, so the app can move on without waiting to be told what's next.
   */
  nextIfRight?: ClientQuestion | null;
};
