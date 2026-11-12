/**
 * Study sets: the rules, with no database or model in them, so they can be
 * checked (scripts/verify-tuttles-study.mts).
 *
 * A set is something a kid is getting ready for, split into topics. Every quiz
 * question is tied to a topic and ends with a result. How well a topic is
 * known (its level) is worked out from those results by fixed rules, not from
 * the model's impression, so it's the same every time and can be explained.
 *
 * Levels, lowest to highest: New (never asked), Learning (missing it),
 * Shaky (getting some right), Solid, Mastered (solid, and still right days
 * later). One quiz moves a topic at most one step:
 * - a quiz where it was all right moves it up a step;
 * - a quiz with a miss (or a skip) moves it down a step, and then it takes two
 *   all-right quizzes to climb again, so a lucky guess doesn't undo a miss;
 * - right only with a hint holds it where it is.
 * Mastered also needs the right answers to come at least two days after it
 * became Solid, so it isn't reached by cramming one evening.
 *
 * Which topics a quiz asks about is planned here too (planQuiz): about half
 * the weak ones, a third review of solid ones not seen lately, the rest new,
 * capped per topic so one bad topic doesn't take over, and widening to cover
 * everything as the test gets close.
 */

export const LEVELS = ["new", "learning", "shaky", "solid", "mastered"] as const;
export type Level = (typeof LEVELS)[number];

export type Result = "correct" | "hinted" | "wrong" | "skipped";
export type Outcome = { result: Result; at: Date; quiz: string };

const DAY = 864e5;
/** Mastered needs right answers this long after reaching Solid. */
const MASTERY_GAP = 2 * DAY;
/** All-right quizzes needed to climb again after a miss. */
const RECOVERY = 2;

export type TopicProgress = {
  level: Level;
  lastSeen: Date | null;
  asked: number;
  right: number;
  /** All-right quizzes still needed before the next climb (after a miss). */
  recovering: number;
};

export function topicProgress(outcomes: Outcome[]): TopicProgress {
  const sorted = [...outcomes].sort((a, b) => a.at.getTime() - b.at.getTime());
  // One quiz at a time, in the order they happened.
  const quizzes: Outcome[][] = [];
  const index = new Map<string, number>();
  for (const o of sorted) {
    if (!index.has(o.quiz)) {
      index.set(o.quiz, quizzes.length);
      quizzes.push([]);
    }
    quizzes[index.get(o.quiz)!].push(o);
  }

  let step = 0;
  let recovering = 0;
  let solidSince: number | null = null;
  for (const quiz of quizzes) {
    const at = quiz[quiz.length - 1].at.getTime();
    const missed = quiz.some((o) => o.result === "wrong" || o.result === "skipped");
    const clean = quiz.every((o) => o.result === "correct");
    if (missed) {
      step = step <= 1 ? 1 : step - 1;
      recovering = RECOVERY;
    } else if (clean) {
      if (recovering > 0) recovering -= 1;
      if (recovering === 0) {
        if (step === 0) step = 2; // right the first time it's asked: some of it's there
        else if (step < 3) step += 1;
        else if (step === 3 && solidSince != null && at - solidSince >= MASTERY_GAP) step = 4;
      }
    }
    // Hinted only: stays put.
    if (step >= 3) solidSince ??= at;
    else solidSince = null;
  }

  return {
    level: LEVELS[step],
    lastSeen: sorted.length ? sorted[sorted.length - 1].at : null,
    asked: sorted.length,
    right: sorted.filter((o) => o.result === "correct").length,
    recovering,
  };
}

export type TopicState = {
  id: string;
  name: string;
  /** 1 a little of the test, 2 a fair share, 3 a big part. */
  weight: number;
} & TopicProgress;

export type Overall = {
  level: Level;
  /** "Ready for 5 of 7 topics". */
  ready: number;
  total: number;
  /** A warning worth showing, close to the test: "2 big topics still shaky". */
  note: string | null;
};

/** The set as a whole: its topics' levels, weighted by how much of the test each is. */
export function overallFor(topics: TopicState[], testDate: string | null, now = new Date()): Overall {
  const total = topics.length;
  const ready = topics.filter((t) => t.level === "solid" || t.level === "mastered").length;
  const tried = topics.filter((t) => t.level !== "new");
  let level: Level = "new";
  if (tried.length) {
    const weight = topics.reduce((s, t) => s + t.weight, 0) || 1;
    const score = topics.reduce((s, t) => s + t.weight * LEVELS.indexOf(t.level), 0) / weight;
    level = score < 1.5 ? "learning" : score < 2.5 ? "shaky" : score < 3.5 ? "solid" : "mastered";
  }
  let note: string | null = null;
  const days = daysUntil(testDate, now);
  if (days != null && days >= 0 && days <= 7) {
    const big = topics.filter((t) => t.weight >= 2);
    const untried = big.filter((t) => t.level === "new").length;
    const weak = big.filter((t) => t.level === "learning" || t.level === "shaky").length;
    if (weak) note = `${weak} big topic${weak > 1 ? "s" : ""} still shaky`;
    else if (untried) note = `${untried} big topic${untried > 1 ? "s" : ""} not practiced yet`;
  }
  return { level, ready, total, note };
}

/** Whole days from today to the test (0 on the day), in Pacific time; null without a date. */
export function daysUntil(testDate: string | null, now = new Date()): number | null {
  if (!testDate) return null;
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  return Math.round((Date.parse(`${testDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
}

// --- Planning a quiz -----------------------------------------------------------

export type SlotReason = "warmup" | "weak" | "review" | "new" | "finish";
export type Slot = { topicId: string; name: string; reason: SlotReason; difficulty: "easier" | "on level" | "harder" };

export const QUIZ_LENGTHS = [5, 10, 20] as const;
export const DEFAULT_LENGTH = 10;

/**
 * Which topic each question of a quiz is about, in order. Weak topics get
 * about half the questions, solid ones not seen lately about a third, and new
 * ones the rest. No weak topic gets more than a few, so a quiz isn't all the
 * hard stuff. It opens with a couple of likely wins and ends on one.
 *
 * Close to the test it widens: within a week review gets more room, and in
 * the last two days every topic comes up before any repeats, like a dress
 * rehearsal.
 */
export function planQuiz(topics: TopicState[], count: number, testDate: string | null, now = new Date()): Slot[] {
  if (!topics.length || count <= 0) return [];
  const days = daysUntil(testDate, now);
  const staleness = (t: TopicState) => (t.lastSeen ? now.getTime() - t.lastSeen.getTime() : Infinity);
  const byNeed = (a: TopicState, b: TopicState) =>
    b.weight - a.weight || LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || staleness(b) - staleness(a);

  const weak = topics.filter((t) => t.level === "learning" || t.level === "shaky").sort(byNeed);
  const fresh = topics.filter((t) => t.level === "new").sort(byNeed);
  // Review: solid before mastered, the longest unseen first.
  const review = topics
    .filter((t) => t.level === "solid" || t.level === "mastered")
    .sort((a, b) => (a.level === b.level ? staleness(b) - staleness(a) : a.level === "solid" ? -1 : 1));

  const counts = new Map<string, number>();
  const used = (t: TopicState) => counts.get(t.id) ?? 0;
  const slots: { topic: TopicState; reason: SlotReason }[] = [];
  const take = (t: TopicState, reason: SlotReason) => {
    counts.set(t.id, used(t) + 1);
    slots.push({ topic: t, reason });
  };

  if (days != null && days >= 0 && days <= 2) {
    // Dress rehearsal: everything once, the most important first, then the weak spots again.
    for (const t of [...topics].sort(byNeed)) if (slots.length < count) take(t, reasonFor(t));
  }

  const shares = days != null && days >= 0 && days <= 7 ? { weak: 0.4, review: 0.4 } : { weak: 0.5, review: 0.3 };
  const cap = Math.max(2, Math.min(3, Math.ceil((count * shares.weak) / Math.max(1, weak.length))));
  const want = {
    weak: Math.round(count * shares.weak),
    review: Math.round(count * shares.review),
  };
  const fill = (pool: TopicState[], n: number, reason: SlotReason, limit: number) => {
    let added = 0;
    // Round-robin, so the questions spread over the pool before any topic repeats.
    for (let round = 0; added < n && slots.length < count; round++) {
      const open = pool.filter((t) => used(t) <= round && used(t) < limit);
      if (!open.length) break;
      for (const t of open) {
        if (added >= n || slots.length >= count) break;
        if (used(t) > round) continue;
        take(t, reason);
        added++;
      }
    }
  };
  fill(weak, want.weak, "weak", cap);
  fill(review, want.review, "review", 2);
  fill(fresh, count - slots.length, "new", 2);
  // Whatever's left: anything that isn't at its cap, then anything at all.
  fill(weak, count - slots.length, "weak", cap);
  fill(review, count - slots.length, "review", 3);
  fill(fresh, count - slots.length, "new", 3);
  const everything = [...topics].sort(byNeed);
  for (let i = 0; slots.length < count; i++) {
    const t = everything[i % everything.length];
    take(t, reasonFor(t));
  }

  return order(slots).map(({ topic, reason: planned }, i, all) => {
    const reason: SlotReason = i === all.length - 1 && all.length > 2 && planned !== "weak" ? "finish" : planned;
    return {
      topicId: topic.id,
      name: topic.name,
      reason,
      difficulty: reason === "warmup" || reason === "finish" || reason === "new" ? "easier" : reason === "review" ? "harder" : "on level",
    };
  });
}

function reasonFor(t: TopicState): SlotReason {
  return t.level === "new" ? "new" : t.level === "learning" || t.level === "shaky" ? "weak" : "review";
}

/**
 * Likely wins first and last, the hard ones in the middle, and the same topic
 * never twice in a row when it can be helped.
 */
function order(slots: { topic: TopicState; reason: SlotReason }[]): { topic: TopicState; reason: SlotReason }[] {
  if (slots.length <= 2) return slots;
  const strength = (s: { topic: TopicState }) => LEVELS.indexOf(s.topic.level) || 1.5; // new sits between learning and shaky
  const easiest = [...slots].sort((a, b) => strength(b) - strength(a));
  const warmups = slots.length >= 6 ? 2 : 1;
  const firsts = easiest.slice(0, warmups);
  const closing = easiest[warmups];
  const opening = firsts.map((s) => ({ ...s, reason: (s.reason === "weak" ? "weak" : "warmup") as SlotReason }));

  // The middle: weak, new and review taken in turn, so the hard ones are
  // spread out, and the same topic never twice in a row when it can be helped.
  const pending = slots.filter((s) => !firsts.includes(s) && s !== closing);
  const turns: SlotReason[] = ["weak", "new", "weak", "review"];
  const middle: typeof slots = [];
  for (let turn = 0; pending.length; turn++) {
    const prev = middle[middle.length - 1] ?? opening[opening.length - 1];
    const differs = (s: (typeof slots)[number]) => s.topic.id !== prev?.topic.id;
    const want = turns[turn % turns.length];
    let at = pending.findIndex((s) => s.reason === want && differs(s));
    if (at < 0) at = pending.findIndex(differs);
    if (at < 0) at = 0;
    middle.push(pending.splice(at, 1)[0]);
  }
  return [...opening, ...middle, ...(closing ? [closing] : [])];
}

// --- Built-in outlines -----------------------------------------------------------

export type Template = {
  id: string;
  title: string;
  format: string;
  topics: { name: string; weight: number }[];
  material: string;
};

/**
 * The ISEE Upper Level, which an 8th grader applying to 9th takes. Canvas
 * doesn't know about it, so its outline is built in. Sections and question
 * types are the published ones.
 */
export const ISEE_UPPER: Template = {
  id: "isee",
  title: "ISEE (Upper Level)",
  format:
    "All multiple choice with four options (A–D), no calculator, except an unscored essay. Verbal Reasoning: synonyms (pick the word closest in meaning) and sentence completions (one or two blanks). Quantitative Reasoning: word problems and quantitative comparisons (Column A vs Column B: A is greater, B is greater, they're equal, or it can't be determined). Reading Comprehension: passages, each followed by questions on the main idea, details, inference, vocabulary in context, and the author's purpose and tone. Mathematics Achievement: grade-level math problems.",
  topics: [
    { name: "Verbal: synonyms", weight: 2 },
    { name: "Verbal: sentence completion", weight: 2 },
    { name: "Reading comprehension", weight: 3 },
    { name: "Quantitative: word problems", weight: 2 },
    { name: "Quantitative: quantitative comparison", weight: 2 },
    { name: "Math: numbers and operations", weight: 2 },
    { name: "Math: algebra", weight: 2 },
    { name: "Math: geometry and measurement", weight: 2 },
    { name: "Math: data analysis and probability", weight: 1 },
  ],
  material:
    "ISEE Upper Level. Verbal Reasoning (40 questions, 20 minutes): synonyms with advanced grade 8–12 vocabulary; sentence completions testing vocabulary and logic (contrast and cause words like although, because, despite). Quantitative Reasoning (37 questions, 35 minutes): reasoning more than computation; word problems and quantitative comparisons across numbers and operations, algebra, geometry, measurement, data and probability. Reading Comprehension (36 questions, 35 minutes): six passages from history, science and literature. Mathematics Achievement (47 questions, 40 minutes): fractions, decimals, percents, ratios, exponents and roots, linear equations and inequalities, functions, coordinate geometry, area and volume, angles, the Pythagorean theorem, mean/median/mode, probability. Essay (30 minutes): unscored, sent to schools. Wrong answers aren't penalized, so never leave one blank.",
};

export const TEMPLATES: Record<string, Template> = { isee: ISEE_UPPER };

// --- What the model writes ---------------------------------------------------------

export const QUESTION_KINDS = ["choice", "short", "fill", "math", "truefalse"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export type QuestionDraft = {
  topic: string;
  kind: QuestionKind;
  prompt: string;
  choices: string[] | null;
  answerIndex: number | null;
  answer: string;
  explanation: string | null;
};

/** A question the tutor wrote (a ```question block, or the voice tool's arguments), checked. */
export function parseQuestion(raw: unknown): QuestionDraft | null {
  const q = typeof raw === "string" ? safeJSON(raw) : raw;
  if (!q || typeof q !== "object") return null;
  const o = q as Record<string, unknown>;
  const prompt = str(o.prompt, 2000);
  if (!prompt) return null;
  let kind = (QUESTION_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as QuestionKind) : "short";
  let choices = Array.isArray(o.choices) ? o.choices.map((c) => str(c, 400)).filter(Boolean).slice(0, 6) : null;
  if (kind === "truefalse") choices = ["True", "False"];
  let answerIndex: number | null = null;
  if (choices && choices.length >= 2) {
    if (kind !== "truefalse") kind = "choice";
    answerIndex = choiceIndex(o.answer, choices);
    if (answerIndex == null) return null; // a multiple choice with no right answer can't be graded
  } else {
    choices = null;
    if (kind === "choice") kind = "short";
  }
  const answer = answerIndex != null && choices ? choices[answerIndex] : str(o.answer, 1000);
  return {
    topic: str(o.topic, 200),
    kind,
    prompt,
    choices,
    answerIndex,
    answer,
    explanation: str(o.explanation, 1500) || null,
  };
}

/** "B", "b)", 1, "1", or the option's own text, as an index into the choices. */
export function choiceIndex(raw: unknown, choices: string[]): number | null {
  if (typeof raw === "number" && Number.isInteger(raw)) {
    return raw >= 0 && raw < choices.length ? raw : null;
  }
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  // The option's own words first: an option can itself start with "A ".
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const at = choices.findIndex((c) => norm(c) === norm(s));
  if (at >= 0) return at;
  const letter = s.match(/^\(?([A-Fa-f])\)?[.):]?(\s|$)/);
  if (letter) {
    const i = letter[1].toUpperCase().charCodeAt(0) - 65;
    if (i < choices.length) return i;
  }
  if (/^\d+$/.test(s)) {
    const i = Number(s);
    return i >= 0 && i < choices.length ? i : null;
  }
  return null;
}

export type SetDraft = {
  title: string | null;
  className: string | null;
  testDate: string | null;
  template: string | null;
  format: string | null;
  material: string | null;
  coverage: "thin" | "okay" | "good" | null;
  coverageNote: string | null;
  topics: { name: string; weight: number }[] | null;
};

/** A study set the tutor drafted or updated (a ```studyset block), checked. Missing fields are left as they are. */
export function parseSetDraft(raw: unknown): SetDraft | null {
  const s = typeof raw === "string" ? safeJSON(raw) : raw;
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  const date = str(o.testDate, 10);
  const coverage = ["thin", "okay", "good"].includes(o.coverage as string) ? (o.coverage as SetDraft["coverage"]) : null;
  const template = str(o.template, 20).toLowerCase();
  const topics = Array.isArray(o.topics)
    ? o.topics
        .map((t) =>
          typeof t === "string"
            ? { name: str(t, 120), weight: 2 }
            : t && typeof t === "object"
              ? {
                  name: str((t as Record<string, unknown>).name, 120),
                  weight: clampWeight((t as Record<string, unknown>).weight),
                }
              : { name: "", weight: 2 },
        )
        .filter((t) => t.name)
        .filter((t, i, all) => all.findIndex((u) => u.name.toLowerCase() === t.name.toLowerCase()) === i)
        .slice(0, 40)
    : null;
  return {
    title: str(o.title, 120) || null,
    className: str(o.class ?? o.className, 120) || null,
    testDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    template: template in TEMPLATES ? template : null,
    format: str(o.format, 1500) || null,
    material: str(o.material, 20000) || null,
    coverage,
    coverageNote: str(o.coverageNote, 500) || null,
    topics: topics && topics.length ? topics : null,
  };
}

export type Grade = { result: Result | null; choice: number | string | null; response: string | null };

/** The tutor's call on an answer (a ```grade block, or the voice tool's arguments). */
export function parseGrade(raw: unknown): Grade | null {
  const g = typeof raw === "string" ? safeJSON(raw) : raw;
  if (!g || typeof g !== "object") return null;
  const o = g as Record<string, unknown>;
  const result = ["correct", "hinted", "wrong", "skipped"].includes(o.result as string) ? (o.result as Result) : null;
  const choice = typeof o.choice === "number" || typeof o.choice === "string" ? o.choice : null;
  if (!result && choice == null) return null;
  return { result, choice, response: str(o.response, 1000) || null };
}

/** Matches a topic the tutor named to one of the set's, forgivingly. */
export function matchTopic<T extends { name: string }>(name: string, topics: T[]): T | null {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const n = norm(name);
  if (!n) return null;
  return (
    topics.find((t) => norm(t.name) === n) ??
    topics.find((t) => norm(t.name).includes(n) || n.includes(norm(t.name))) ??
    null
  );
}

function clampWeight(w: unknown): number {
  const n = typeof w === "number" ? Math.round(w) : 2;
  return Math.min(3, Math.max(1, n));
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function safeJSON(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** "A", "B", …: how choices are labeled everywhere (cards, voice, grading). */
export const letter = (i: number) => String.fromCharCode(65 + i);
