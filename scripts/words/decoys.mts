/**
 * Other vocab words as the wrong answers to the sentence completions.
 *
 * The traps generate.mts wrote for a sentence completion are everyday words
 * ("Asked to be ancient: modern, shiny, recent"), so the one word that looks
 * like a vocab word is always the answer, and the kids learned to pick it
 * without reading the sentence. A decoy is another word from the same deck,
 * the same part of speech, and met around the same time, that is clearly
 * wrong in the sentence. A session asks a sentence with the decoys the kid
 * has already met (pickWrong in src/lib/words/schedule.ts), so every choice
 * is a word they've seen and only the sentence can say which one it is.
 *
 *   tsx --env-file=.env.local scripts/words/decoys.mts write   # chooses decoys for each sentence: gen-decoys-*.json
 *   tsx --env-file=.env.local scripts/words/decoys.mts check   # puts each sentence to a solver cold: checked-decoys.json
 *   tsx scripts/words/build.mts                                # keeps the decoys the solver didn't think fit
 *
 * Both steps keep what they've done and only do what's new, so a rerun after
 * a failure picks up where it stopped.
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const content = path.join(here, "../../src/lib/words/content");
const MODEL = "claude-opus-5-5";
const AT_ONCE = 6;
/** Candidates offered for each sentence: the nearest words met before it, then after. */
const CANDIDATES = 20;
const EARLIER = 14;
/** Decoys kept for each sentence, at most: a session asks three. */
const MOST = 6;

type Level = "lower" | "middle";
type DeckWord = {
  word: string;
  pos: string;
  meaning: string;
  synonym: string;
  cousins: string[];
  rank: number;
};
type Form = {
  kind: string;
  stem: string;
  answer: string;
  traps: { text: string }[];
};
type Item = { id: string; word: string; forms: Record<string, Form> };
type GenDecoy = { text: string; trap: string; why: string };
type DecoyStore = Record<string, { stem: string; decoys: GenDecoy[] }>;
type DecoyVerdict = { fits: string[]; best: string };

const norm = (s: string) => s.trim().toLowerCase();
const read = <T,>(file: string, otherwise?: T): T => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : (otherwise as T));
const storePath = (level: Level) => path.join(here, `gen-decoys-${level}.json`);
const checkedPath = path.join(here, "checked-decoys.json");

/** One sentence completion and the deck words that might be decoys for it. */
type Question = {
  level: Level;
  key: string;
  word: string;
  pos: string;
  meaning: string;
  stem: string;
  candidates: DeckWord[];
};

function questions(level: Level): Question[] {
  const deck = read<DeckWord[]>(path.join(here, `deck-${level}.json`));
  const byWord = new Map(deck.map((w) => [norm(w.word), w]));
  const items = read<Item[]>(path.join(content, `${level}.json`));
  const out: Question[] = [];
  for (const it of items) {
    const w = byWord.get(norm(it.word));
    if (!w) continue;
    // Close in meaning either way round: a decoy that could be a synonym could be an answer.
    const near = new Set([w.word, w.synonym, ...w.cousins].map(norm));
    for (const [name, form] of Object.entries(it.forms)) {
      if (form.kind !== "sc") continue;
      const inSentence = (word: string) => new RegExp(`\\b${word}\\b`, "i").test(form.stem);
      const pool = deck.filter(
        (d) =>
          d.pos === w.pos &&
          !near.has(norm(d.word)) &&
          norm(d.synonym) !== norm(w.word) &&
          !d.cousins.map(norm).includes(norm(w.word)) &&
          !inSentence(d.word),
      );
      const earlier = pool
        .filter((d) => d.rank < w.rank)
        .sort((a, b) => b.rank - a.rank)
        .slice(0, EARLIER);
      const later = pool
        .filter((d) => d.rank > w.rank)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, CANDIDATES - earlier.length);
      out.push({
        level,
        key: `${it.word}|${name}`,
        word: it.word,
        pos: w.pos,
        meaning: w.meaning,
        stem: form.stem,
        candidates: [...earlier, ...later],
      });
    }
  }
  return out;
}

const client = new Anthropic({ maxRetries: 5 });

async function ask<T>(system: string, body: string, schema: object, effort: "low" | "medium"): Promise<T> {
  const message = await client.messages
    .stream({
      model: MODEL,
      max_tokens: 32000,
      system,
      messages: [{ role: "user", content: body }],
      output_config: { effort, format: { type: "json_schema", schema } },
    } as unknown as Anthropic.MessageStreamParams)
    .finalMessage();
  if (message.stop_reason !== "end_turn") throw new Error(`stopped: ${message.stop_reason}`);
  return JSON.parse(message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")) as T;
}

/** Runs `groups` through `work`, a few at a time, saving as it goes. */
async function each<T>(groups: T[], work: (group: T) => Promise<void>, save: () => void) {
  let next = 0;
  let failed = 0;
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      while (next < groups.length) {
        const mine = next++;
        try {
          await work(groups[mine]);
        } catch (error) {
          failed++;
          console.log(`group ${mine}: ${error instanceof Anthropic.APIError ? `API error ${error.status}` : String(error)}`);
        }
        if (mine % 10 === 0) {
          console.log(`${mine + 1}/${groups.length}`);
          save();
        }
      }
    }),
  );
  save();
  if (failed) console.log(`${failed} groups failed: run it again for those`);
}

const chunk = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

// MARK: write

const TRAPS = ["opposite", "lookalike", "soundalike", "root", "related", "tone", "strength", "broad", "other-meaning"];

const WRITE_SYSTEM = `You choose wrong answers for vocabulary sentence completions written for 10 to 13 year olds preparing for the ISEE.

The kids have noticed that the right answer is always the one vocab word among everyday words, and pick it without reading the sentence. So the wrong answers are now to be other vocab words they are learning. For each sentence you get the target word that fills the blank and a list of candidate words from the same deck. Choose up to ${MOST} candidates, as many as honestly qualify, each of which:

- Fits the blank's grammar exactly as written, with the sentence unchanged. Mind "a" or "an" before the blank, verb forms, and singular or plural.
- Is clearly wrong once the sentence is read: a careful reader would never say it completes the sentence sensibly. Not a synonym of the target, and not a word that would also work.
- Is tempting to someone who only half reads the sentence: best is a word that fits if you miss the clue (the opposite of what the clue asks for, the right topic with the wrong meaning, the wrong feeling). A candidate that is merely unrelated is fine when it fits the grammar, but prefer tempting ones.

Use each candidate exactly as written. Label each with the kind of trap it is: opposite, lookalike, soundalike, root, related, tone, strength, broad or other-meaning (use "related" for one that is about something else entirely).

"why" is one short sentence said to the student explaining why it is wrong here, pointing at the sentence: "The sentence says he had never felt so scared, and calm is the opposite." At most 18 words. Talk to the student as "you" if you need to. No exclamation marks, no emoji, no dashes used as punctuation. American spelling.`;

const writeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "decoys"],
        properties: {
          n: { type: "integer" },
          decoys: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "trap", "why"],
              properties: {
                text: { type: "string" },
                trap: { type: "string", enum: TRAPS },
                why: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

async function choose(group: Question[], store: DecoyStore) {
  const body = group
    .map(
      (q, i) =>
        `${i + 1}. ${q.stem}\nfills the blank: ${q.word} (${q.pos}: ${q.meaning})\ncandidates:\n${q.candidates.map((c) => `- ${c.word}: ${c.meaning}`).join("\n")}`,
    )
    .join("\n\n");
  const { questions: answers } = await ask<{
    questions: { n: number; decoys: GenDecoy[] }[];
  }>(WRITE_SYSTEM, `Choose the wrong answers for these ${group.length} sentences.\n\n${body}`, writeSchema, "medium");
  for (const a of answers) {
    const q = group[a.n - 1];
    if (!q) continue;
    const allowed = new Map(q.candidates.map((c) => [norm(c.word), c.word]));
    const seen = new Set<string>();
    const decoys = a.decoys
      .filter((d) => allowed.has(norm(d.text)) && !seen.has(norm(d.text)) && seen.add(norm(d.text)))
      .map((d) => ({
        text: allowed.get(norm(d.text))!,
        trap: d.trap,
        why: d.why.trim(),
      }))
      .slice(0, MOST);
    store[q.key] = { stem: q.stem, decoys };
  }
}

async function write() {
  for (const level of ["lower", "middle"] as const) {
    const store = read<DecoyStore>(storePath(level), {});
    const todo = questions(level).filter((q) => store[q.key]?.stem !== q.stem && q.candidates.length >= 3);
    console.log(`${level}: ${todo.length} sentences to choose decoys for`);
    await each(
      chunk(todo, 10),
      (group) => choose(group, store),
      () => writeFileSync(storePath(level), JSON.stringify(store, null, 1)),
    );
  }
}

/** A look at what `write` would choose, for a few sentences a long way apart, without keeping it. */
async function sample(level: Level) {
  const all = questions(level);
  const group = [0, 1, 150, 151, 400, 401, 700, 701, 950, 951].map((i) => all[i]).filter(Boolean);
  const store: DecoyStore = {};
  await choose(group, store);
  for (const q of group) {
    console.log(`\n${q.stem}\n  answer: ${q.word}\n  offered: ${q.candidates.map((c) => c.word).join(", ")}`);
    for (const d of store[q.key]?.decoys ?? []) console.log(`  - ${d.text} (${d.trap}): ${d.why}`);
  }
}

// MARK: check

/** What a sentence's decoys are checked under: change the sentence or the decoys and it's checked again. */
const decoyCheckKey = (level: string, key: string, answer: string, decoys: { text: string }[]) =>
  `${level}|${key}|${answer}|${decoys.map((d) => d.text).join("/")}`;

const LETTERS = "ABCDEFGHIJ";

// The same order every run, so a key always means the same question.
function order(key: string, choices: string[]): string[] {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = choices.slice();
  for (let i = a.length - 1; i > 0; i--) {
    h = (h * 1664525 + 1013904223) >>> 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const CHECK_SYSTEM = `You are checking vocabulary sentence completions written for 10 to 13 year olds, in the style of the ISEE. Each has a sentence with a blank and several choices. Read each one as a careful, well-read adult would.

For each sentence give:
- "fits": the letters of every choice that could reasonably complete the sentence, so that a fair teacher would accept it. Leave out choices that are wrong given the sentence's clue, or that don't fit its grammar.
- "best": the letter of the single best choice.`;

const checkSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answers"],
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "fits", "best"],
        properties: {
          n: { type: "integer" },
          fits: {
            type: "array",
            items: { type: "string", enum: [...LETTERS] },
          },
          best: { type: "string", enum: [...LETTERS] },
        },
      },
    },
  },
};

async function check() {
  const checked = read<Record<string, DecoyVerdict>>(checkedPath, {});
  const todo: { key: string; stem: string; choices: string[] }[] = [];
  for (const level of ["lower", "middle"] as const) {
    const store = read<DecoyStore>(storePath(level), {});
    for (const q of questions(level)) {
      const gen = store[q.key];
      if (!gen || gen.stem !== q.stem || gen.decoys.length === 0) continue;
      const key = decoyCheckKey(level, q.key, q.word, gen.decoys);
      if (checked[key]) continue;
      todo.push({
        key,
        stem: q.stem,
        choices: order(key, [q.word, ...gen.decoys.map((d) => d.text)]),
      });
    }
  }
  console.log(`${todo.length} sentences to check`);
  await each(
    chunk(todo, 30),
    async (group) => {
      const body = group.map((q, i) => `${i + 1}. ${q.stem}\n${q.choices.map((c, j) => `${LETTERS[j]}. ${c}`).join("\n")}`).join("\n\n");
      const { answers } = await ask<{
        answers: { n: number; fits: string[]; best: string }[];
      }>(CHECK_SYSTEM, body, checkSchema, "low");
      for (const a of answers) {
        const q = group[a.n - 1];
        if (!q) continue;
        const at = (letter: string) => q.choices[LETTERS.indexOf(letter)];
        checked[q.key] = {
          fits: a.fits.map(at).filter(Boolean),
          best: at(a.best) ?? "",
        };
      }
    },
    () => writeFileSync(checkedPath, JSON.stringify(checked, null, 1)),
  );
  const verdicts = Object.entries(checked);
  const missed = verdicts.filter(([key, v]) => v.best !== key.split("|")[3]);
  const doubled = verdicts.reduce((n, [key, v]) => n + v.fits.filter((f) => f !== key.split("|")[3]).length, 0);
  console.log(
    `checked ${verdicts.length}: ${missed.length} where the solver's best wasn't the answer (no decoys kept), ${doubled} decoys it thought also fit (left out)`,
  );
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === "write") await write();
  else if (command === "sample") await sample(arg === "middle" ? "middle" : "lower");
  else if (command === "check") await check();
  else console.log("usage: decoys.mts write | check | sample [lower|middle]");
} catch (error) {
  if (error instanceof Anthropic.APIError) console.error(`API error ${error.status}: ${error.message}`);
  else console.error(error);
  process.exit(1);
}
