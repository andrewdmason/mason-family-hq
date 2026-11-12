import type { QuestionRow, QuizSettings, SetRow, SetSummary } from "@/lib/tuttles/study-db";
import { letter, type Level, type TopicState } from "@/lib/tuttles/study";

/**
 * What the tutor is told about study sets and quizzes (src/lib/tuttles/study.ts).
 *
 * In an ordinary chat it learns the student's sets and how to make or update
 * one (a ```studyset block the server saves). In a quiz chat it gets the set's
 * material, the plan of topics for this quiz and how it's going, and asks
 * questions as ```question blocks (typed) or with the ask_question tool
 * (voice). The server keeps each question's answer and does the grading for
 * multiple choice; the tutor only calls the rest.
 */

const LEVEL_WORDS: Record<Level, string> = {
  new: "not quizzed yet",
  learning: "learning",
  shaky: "shaky",
  solid: "solid",
  mastered: "mastered",
};

function today(now = new Date()): string {
  return now.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function when(testDate: string | null, daysLeft: number | null): string {
  if (!testDate) return "no test date";
  const d = new Date(`${testDate}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  if (daysLeft == null) return `test ${d}`;
  if (daysLeft < 0) return `test was ${d}`;
  if (daysLeft === 0) return `test today (${d})`;
  if (daysLeft === 1) return `test tomorrow (${d})`;
  return `test ${d}, in ${daysLeft} days`;
}

/** For an ordinary chat: the student's sets, and how to make or change one. */
export function studySetsContext(
  name: string,
  sets: SetSummary[],
  classNames: (id: number | null) => string | null,
  voice = false,
): string {
  const list = sets.length
    ? sets
        .map((s) => {
          const cls = classNames(s.courseId);
          return `- "${s.title}" (id ${s.id})${cls ? ` · ${cls}` : ""} · ${when(s.testDate, s.daysLeft)} · ${s.topics.length} topics, overall ${LEVEL_WORDS[s.overall.level]} · material ${s.coverage}${s.coverageNote ? ` (${s.coverageNote})` : ""}`;
        })
        .join("\n")
    : "(none yet)";
  return `## Study sets
Today is ${today()}. When ${name} has a quiz or test coming up, Tuttles keeps a study set for it: what's on the test, split into topics, and study notes to quiz from. Quizzes on a set track how well ${name} knows each topic. ${name}'s sets now:
${list}

When ${name} mentions something coming up (a quiz, test, exam, vocab check, the ISEE) or asks to study for one, offer to set it up, and once you know what it's for, ${
    voice
      ? `save it by calling save_study_set with these fields as JSON (the app saves it and shows it):\n${SET_EXAMPLE}`
      : `write the set as a block (the app saves it and shows it as a card):\n\`\`\`studyset\n${SET_EXAMPLE}\n\`\`\``
  }
- To change one of the sets above (more material came in, the date moved, topics changed), ${voice ? "save it again" : "write the same block"} with its "id" and only the fields that change. "topics", when given, is the whole list. "material", when given, replaces the notes, so write them out in full with what was there before.
- For the ISEE, add "template":"isee" and leave out "topics" and "format": it brings the official sections. Add their test date and anything they tell you.
- Topics: 4 to 12, specific and testable ("-ar verbs in the present tense", "food vocabulary, list 4", "solving two-step equations"), not "Chapter 3". Weight 3 for a big part of the test, 1 for a small one.
- Material: the facts, definitions, vocabulary, formulas and example problems a quiz could be written from. Copy photos of study guides, vocab lists and worksheets into it faithfully and completely; that's what quizzes are written from later.
- Canvas (if it's above) often says when a test is and roughly what unit, but rarely what's on it. Be honest about that. Coverage is "thin" when you're mostly going from a title, "okay" with a topic list but few details, "good" with a study guide or the actual content. While it's thin or okay, ask for more, and say exactly what would help most (a photo of the study guide, the vocab list, the notes from class, an old quiz), or have ${name} just tell you what the teacher said.
- After saving it, say in a line that it's set up and that the Quiz me button on it starts a quiz that tracks how they're doing. Quizzes that count happen there, not in this chat.`;
}

const SET_EXAMPLE = `{"title":"Science quiz: cells","class":"<a class name exactly as in their classes, if it's for one>","testDate":"YYYY-MM-DD","format":"what the real test asks: question types, how many, anything known","topics":[{"name":"Organelles and their jobs","weight":3},{"name":"Plant vs animal cells","weight":2}],"material":"study notes to quiz from","coverage":"thin","coverageNote":"what's missing"}`;

// --- Quiz chats -----------------------------------------------------------------------

const KIND_GUIDE = `Question kinds: "choice" (multiple choice, 4 options), "truefalse", "short" (a word or a sentence or two), "fill" (fill in the blank: write the blank as ____), "math" (a problem to work out; "answer" is the final answer).
- Use the kinds the real test uses (see "What the test is like"). When that's unknown: multiple choice for recognizing (what a word means, which organelle does what), short answer or fill-in for recalling (spelling a vocab word, translating into the language, defining), math for problems.
- Multiple choice: one clearly right answer and three wrong ones that a student who half-knows it would pick (common mistakes, near misses). Don't letter the options yourself; the app labels them A–D. Vary where the right answer falls.
- Never give away the answer in the question. Math in prompts and choices is LaTeX ($...$).`;

export function quizInstructions(args: {
  name: string;
  set: SetRow;
  className: string | null;
  quiz: QuizSettings;
  topics: TopicState[];
  asked: QuestionRow[];
  voice: boolean;
}): string {
  const { name, set, quiz, asked, voice } = args;
  const test = quiz.mode === "test";
  const topicName = (id: string | null) => args.topics.find((t) => t.id === id)?.name ?? "(no topic)";
  const answeredCount = asked.filter((q) => q.result).length;
  const open = asked.at(-1) && !asked.at(-1)!.result ? asked.at(-1)! : null;
  const done = Boolean(quiz.finishedAt) || answeredCount >= quiz.count || (asked.length >= quiz.count && !open);
  const daysLeft = set.test_date
    ? Math.round((Date.parse(`${set.test_date}T00:00:00Z`) - Date.parse(`${new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })}T00:00:00Z`)) / 864e5)
    : null;

  const howToAsk = voice
    ? `- Ask each question by calling ask_question (it puts the question on ${name}'s screen), then say it aloud. For multiple choice read every option with its letter ("A, mitochondria. B, ribosome…"). Short, one question per turn, then wait.
- When ${name} answers out loud, call record_answer before you say anything about it: for multiple choice or true/false pass the choice they said ("B", or the option's words); otherwise pass your call as "result". Its reply tells you if a multiple choice was right. ${name} can also tap an option on the screen; then you'll get a note saying what they tapped and whether it was right.`
    : `- One question per message, written as a block (the app shows it as a card with tappable options), with at most a short line before it and nothing after it:
\`\`\`question
{"topic":"<a topic name from the plan>","kind":"choice","prompt":"Which organelle makes proteins?","choices":["Mitochondria","Ribosome","Golgi body","Vacuole"],"answer":"B","explanation":"Ribosomes read mRNA and build proteins."}
\`\`\`
  "answer" is the right option's letter for multiple choice and true/false, the right answer in words otherwise. "explanation" is a sentence or two on why, for going over it.
- When ${name} answers something other than multiple choice or true/false, start your reply with your call on it:
\`\`\`grade
{"result":"correct"}
\`\`\`
  If they typed a multiple choice answer instead of tapping, write {"choice":"B"} (the letter or option they gave) and the app grades it. A tapped answer is already graded: see "How it's going".`;

  const results = `Results: "correct" right (accept small spelling slips unless spelling is what's tested, and any equivalent form); "hinted" right only after you gave a hint on this question; "wrong"; "skipped" when they don't know or give up.`;

  const feedback = test
    ? `- This is a test run: no feedback and no hints while it runs, like the real test. After each answer just say something short like "Got it" and ask the next question. If they ask whether it was right, say you'll go over everything at the end.
- After the last answer: go over the ones they missed, one at a time, briefly (the right answer and why), then one line of encouragement and what to practice next.`
    : `- Practice: after each answer say whether it's right in a few words. If it's wrong, the first time you may give one hint and let them try again (a right answer then is "hinted"); otherwise give the right answer and a one- or two-sentence why. Then the next question${voice ? "" : ", in the same message"}.
- Keep the energy up and the pace quick. Praise effort and specific good thinking, not just right answers.`;

  const plan = quiz.plan
    .map((s, i) => `${i + 1}. ${s.name} (${s.reason === "warmup" ? "warm-up, a likely win" : s.reason === "finish" ? "to finish on, a likely win" : s.reason === "weak" ? "a weak spot" : s.reason === "review" ? "review of something solid" : "not quizzed yet"}; ${s.difficulty})`)
    .join("\n");

  const progress = asked.length
    ? asked
        .map((q) => {
          const chosen = q.chosen_index != null && q.choices ? `${letter(q.chosen_index)} (${q.choices[q.chosen_index]})` : null;
          const status = q.result
            ? `${q.result}${chosen ? `, chose ${chosen}` : ""}${q.response ? `, said "${q.response}"` : ""}`
            : "waiting for an answer";
          return `Q${q.number} [${topicName(q.topic_id)}, ${q.kind}]: ${q.prompt}${q.choices ? ` | ${q.choices.map((c, i) => `${letter(i)}) ${c}`).join(" ")}` : ""} | answer: ${q.choices && q.answer_index != null ? letter(q.answer_index) + " " : ""}${q.answer} → ${status}`;
        })
        .join("\n")
    : "No questions yet. Say hi in a few words and ask question 1.";

  const ending = done
    ? `\n\nAll ${quiz.count} questions are answered: the quiz is over. ${test ? "Go over the misses now if you haven't." : `Wrap up in two or three short sentences: one genuine bit of encouragement, and the one or two things to look at next.`} The app shows ${name} the score and how each topic moved, so don't list scores. Don't ask another question. If ${name} wants more, say they can start another quiz from the set.`
    : open
      ? `\n\nQuestion ${open.number} is open. ${voice ? "If the call just started, ask it again." : ""}`
      : `\n\nNext: question ${asked.length + 1} of ${quiz.count}.`;

  return `## This chat is a quiz
${name} is getting ready for "${set.title}"${args.className ? ` (${args.className})` : ""}, ${set.test_date ? (daysLeft != null && daysLeft >= 0 ? `test in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : "test date passed") : "no test date"}. This quiz: ${test ? "a test run (like the real thing)" : "practice"}, ${quiz.count} questions. Today is ${today()}.

In this chat the quiz comes first: the tutoring rules above about not giving answers apply to homework, not to these questions, whose answers you give when going over them.

### How to quiz
${howToAsk}
${results}
${feedback}
- If ${name} wants to stop and understand something, teach it briefly (a few short ${voice ? "turns" : "messages"}), then offer to carry on. An open question stays open.
- Follow the plan: question N is about topic N at that difficulty. If the material has nothing for a topic, use what a ${name}-level test on it would ask.
${KIND_GUIDE}

### What the test is like
${set.format || "Not known. Mix kinds sensibly for the subject."}

### Material to quiz from
${set.material.trim() || "(None yet: ask about what the topics would normally cover at their grade.)"}

### Plan for this quiz
${plan}

### How it's going
${progress}${ending}`;
}

// --- Voice tools ---------------------------------------------------------------------------

export const ASK_QUESTION_TOOL = {
  type: "function" as const,
  name: "ask_question",
  description:
    "Put the next quiz question on the student's screen (multiple choice shows tappable options). Call it for every question, then say the question aloud.",
  parameters: {
    type: "object",
    properties: {
      topic: { type: "string", description: "The planned topic's name." },
      kind: { type: "string", enum: ["choice", "truefalse", "short", "fill", "math"] },
      prompt: { type: "string", description: "The question. Math in LaTeX ($...$)." },
      choices: { type: "array", items: { type: "string" }, description: "Multiple choice: the options, unlettered." },
      answer: { type: "string", description: "The right option's letter for multiple choice/true-false, otherwise the right answer." },
      explanation: { type: "string", description: "A sentence or two on why." },
    },
    required: ["topic", "kind", "prompt", "answer"],
    additionalProperties: false,
  },
};

export const RECORD_ANSWER_TOOL = {
  type: "function" as const,
  name: "record_answer",
  description:
    "Record the student's spoken answer to the open question, before reacting to it. Multiple choice/true-false: pass the choice they said; it's graded for you. Anything else: pass your call as result.",
  parameters: {
    type: "object",
    properties: {
      choice: { type: "string", description: "Multiple choice/true-false: the letter or option they said." },
      result: { type: "string", enum: ["correct", "hinted", "wrong", "skipped"] },
      response: { type: "string", description: "What they said, briefly." },
    },
    additionalProperties: false,
  },
};

export const SAVE_STUDY_SET_TOOL = {
  type: "function" as const,
  name: "save_study_set",
  description: "Make or update one of the student's study sets (see Study sets in your instructions).",
  parameters: {
    type: "object",
    properties: {
      set: { type: "string", description: "The set as one JSON object, in the format described." },
    },
    required: ["set"],
    additionalProperties: false,
  },
};
