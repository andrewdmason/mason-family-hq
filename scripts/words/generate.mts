/**
 * Writes the Words app's questions: for every word in the two ISEE decks, four
 * multiple-choice questions whose wrong answers are the traps the real test
 * sets (opposites, look-alikes, the right topic at the wrong strength…), plus
 * a memory hook and the word parts it's built from; and for every word part,
 * two questions that use it.
 *
 * Runs once, through the Message Batches API (half price, no hurry), and
 * leaves the raw output in scripts/words/gen-*.json for build.mts to check
 * and turn into src/lib/words/content/.
 *
 *   tsx --env-file=.env.local scripts/words/generate.mts submit   # prints a batch id
 *   tsx --env-file=.env.local scripts/words/generate.mts wait <batch id>
 *   tsx --env-file=.env.local scripts/words/generate.mts retry    # whatever's still missing
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const MODEL = "claude-opus-5-5";
const WORDS_PER_REQUEST = 10;
const PARTS_PER_REQUEST = 18;

type DeckWord = {
  word: string;
  pos: string;
  meaning: string;
  synonym: string;
  example: string;
  sentence: string;
  clue: string;
  cousins: string[];
};
type PartSeed = { id: string; part: string; kind: string; meaning: string; examples: string[] };

const read = <T,>(name: string): T => JSON.parse(readFileSync(path.join(here, name), "utf8")) as T;
const parts = read<PartSeed[]>("parts-seed.json");
const decks = { lower: read<DeckWord[]>("deck-lower.json"), middle: read<DeckWord[]>("deck-middle.json") };

const TRAPS = ["opposite", "lookalike", "soundalike", "root", "related", "tone", "strength", "broad", "other-meaning"] as const;

const trapSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "trap", "why"],
  properties: {
    text: { type: "string" },
    trap: { type: "string", enum: [...TRAPS] },
    why: { type: "string" },
  },
};
const questionProps = {
  answer: { type: "string" },
  traps: { type: "array", items: trapSchema },
  tip: { type: "string" },
};
const wordSchema = {
  type: "object",
  additionalProperties: false,
  required: ["words"],
  properties: {
    words: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["word", "hook", "tone", "parts", "syn1", "syn2", "sc1", "sc2"],
        properties: {
          word: { type: "string" },
          hook: { type: "string" },
          tone: { type: "string", enum: ["positive", "negative", "neutral"] },
          parts: { type: "array", items: { type: "string" } },
          syn1: { type: "object", additionalProperties: false, required: ["answer", "traps", "tip"], properties: questionProps },
          syn2: { type: "object", additionalProperties: false, required: ["answer", "traps", "tip"], properties: questionProps },
          sc1: { type: "object", additionalProperties: false, required: ["traps", "tip"], properties: { traps: questionProps.traps, tip: questionProps.tip } },
          sc2: {
            type: "object",
            additionalProperties: false,
            required: ["sentence", "traps", "tip"],
            properties: { sentence: { type: "string" }, traps: questionProps.traps, tip: questionProps.tip },
          },
        },
      },
    },
  },
};
const partSchema = {
  type: "object",
  additionalProperties: false,
  required: ["parts"],
  properties: {
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "hook", "apply1", "apply2"],
        properties: {
          id: { type: "string" },
          hook: { type: "string" },
          apply1: { type: "object", additionalProperties: false, required: ["prompt", "answer", "wrong", "tip"], properties: { prompt: { type: "string" }, answer: { type: "string" }, wrong: { type: "array", items: { type: "string" } }, tip: { type: "string" } } },
          apply2: { type: "object", additionalProperties: false, required: ["prompt", "answer", "wrong", "tip"], properties: { prompt: { type: "string" }, answer: { type: "string" }, wrong: { type: "array", items: { type: "string" } }, tip: { type: "string" } } },
        },
      },
    },
  },
};

const partList = parts.map((p) => `${p.id} (${p.part}: ${p.meaning})`).join("; ");

function wordSystem(level: "lower" | "middle"): string {
  const who =
    level === "lower"
      ? "a fifth grader preparing for the ISEE Lower Level (entering grade 6)"
      : "a seventh grader preparing for the ISEE Middle Level (entering grade 8)";
  return `You write vocabulary practice questions for ${who}. The questions go into an app the student uses every day; a parent has asked that the wrong answers be the kind of traps the real ISEE sets, not random words.

For each word you're given, write four multiple-choice questions and a few notes. Every question has exactly one right answer and exactly three wrong answers ("traps").

The four questions:
- syn1: a synonym question. The student sees the word in capitals and four choices. Use the given synonym as the answer unless it is a poor fit.
- syn2: a second synonym question with a DIFFERENT right answer (another close synonym or a short defining phrase of two to four words) and three different traps, so the student can't memorise the first one.
- sc1: a sentence completion using the sentence you're given, where the target word fills the blank. You only write the three traps and the tip.
- sc2: a new sentence completion you write. One blank, written as _____ (five underscores), which the target word fills exactly as given (same form: don't inflect it). 18 to 32 words, about something a kid that age knows. The sentence must contain a real clue that settles the answer, and it should use a different kind of clue from the given sentence (contrast, cause and effect, restatement, or tone). Don't use the target word's given synonym as the clue word if you can help it.

The traps. Each trap is labelled with the kind it is:
- opposite: an antonym of the word. Use one in most synonym questions; it is the most common ISEE trap.
- lookalike: a word that looks like the target but means something else (conscience / conscious).
- soundalike: a word that sounds like it (accept / except).
- root: a meaning the word's parts seem to suggest but that is wrong (awful isn't "full of awe").
- related: the same topic, but not the meaning (scarce / valuable).
- tone: about the same subject with the wrong feeling, positive where the word is negative or the reverse (frugal / stingy).
- strength: the right direction but too strong or too weak (furious / annoyed).
- broad: too general or too narrow (saunter / move).
- other-meaning: fits a different, more familiar meaning of the target word (novel / book).
Use a mix: across a word's four questions, at least three different kinds, and only kinds that are honestly true of that trap. For sentence completions the traps must fit the sentence's grammar and be tempting to someone who half-reads it (for example the word that fits if you miss the "although"), while being clearly wrong given the clue.

Rules for every choice:
- Same part of speech as the right answer, and the same shape (all single words, or all short phrases).
- Words the student already knows or could plausibly meet on the test. A trap they can't read teaches nothing. The right answer in a synonym question should be an easier word than the target.
- A trap must be definitely wrong. Never use a word that could be defended as a synonym, and never one that would also complete the sentence sensibly.
- No trap may be the target word itself or share its root in a synonym question (not "careful" for CAREFULLY). In a sentence completion no trap may be a synonym of the target.
- The three traps in a question are all different, and none repeats that question's answer.

For each trap, "why" is one short sentence said to the student explaining why it's wrong, naming the trap in plain words: "Scarce is the opposite of abundant." "Valuable things are often rare, but abundant is about how much there is." At most 16 words.

"tip" is shown when the student misses that question: one or two short sentences on how they could have got it. For a synonym question, give a way in (a word part, a familiar phrase it appears in, its feeling, a word it's inside). For a sentence completion, point at the clue in the sentence by quoting the signal words. At most 30 words. Talk to the student as "you". Don't open with "Remember".

"hook" is one sentence that makes the word stick: a vivid picture, a phrase they've heard it in, or how it breaks into parts. At most 22 words. It must be true: no invented etymologies.

"tone" is the word's feeling: positive, negative or neutral.

"parts" lists which of these word parts are truly in the word, by id, and only when the part carries its usual meaning there (bene in benevolent: yes; "in" in "interest": no; "re" in "rest": no). Usually zero or one, sometimes two. The ids: ${partList}.

Write plainly. No exclamation marks, no emoji, no dashes used as punctuation. American spelling.`;
}

const PART_SYSTEM = `You write practice questions about word parts (prefixes, roots and suffixes) for students aged 10 to 13 preparing for the ISEE. For each word part you're given, write:

- hook: one sentence that makes the part stick, built on words they already know ("A submarine goes under the sea and a subway runs under the street: sub- means under."). At most 24 words.
- apply1 and apply2: two different multiple-choice questions that make the student USE the part to work out a word, in the style of these: "A portable speaker is one that can be:" (carried / hidden / repaired / studied); "To transmit a message is to:" (send it across / hide it carefully / write it slowly / change it into a poem); "Something audible is able to be:" (heard / lifted / measured / smelled). Use a word that contains the part with its usual meaning, ideally a word the student might not know well, so the part does the work. Don't reuse the example words you're given if you can avoid it, and don't use the same word in both questions.
  - prompt: the question, ending in a colon or a question mark.
  - answer: the right choice, short.
  - wrong: exactly three wrong choices of the same shape and length as the answer. Make them tempting: one should be what the student would pick if they confused this part with another common part (pre- with post-, sub- with super-, aud with vis), where there is one.
  - tip: one or two short sentences shown after a miss, breaking the word into its parts. At most 28 words. Say "you".

Everything must be true: real words, real meanings. Write plainly, with no exclamation marks, no emoji and no dashes used as punctuation. American spelling.`;

function wordRequests(level: "lower" | "middle", only?: Set<string>) {
  const words = decks[level].filter((w) => !only || only.has(w.word));
  const requests = [];
  for (let i = 0; i < words.length; i += WORDS_PER_REQUEST) {
    const group = words.slice(i, i + WORDS_PER_REQUEST);
    const body = group
      .map(
        (w) =>
          `word: ${w.word}\npart of speech: ${w.pos}\nmeaning: ${w.meaning}\ngiven synonym: ${w.synonym}\nother close words: ${w.cousins.join(", ") || "(none)"}\nexample: ${w.example}\nsentence for sc1: ${w.sentence}\nits clue: ${w.clue}`
      )
      .join("\n\n");
    requests.push({
      custom_id: `${level}-${String(i / WORDS_PER_REQUEST).padStart(3, "0")}-${Date.now().toString(36)}`,
      params: {
        model: MODEL,
        max_tokens: 32000,
        system: [{ type: "text" as const, text: wordSystem(level), cache_control: { type: "ephemeral" as const } }],
        messages: [{ role: "user" as const, content: `Write the questions for these ${group.length} words, in this order.\n\n${body}` }],
        output_config: { format: { type: "json_schema", schema: wordSchema } },
      },
    });
  }
  return requests;
}

function partRequests(only?: Set<string>) {
  const list = parts.filter((p) => !only || only.has(p.id));
  const requests = [];
  for (let i = 0; i < list.length; i += PARTS_PER_REQUEST) {
    const group = list.slice(i, i + PARTS_PER_REQUEST);
    const body = group.map((p) => `id: ${p.id}\npart: ${p.part} (${p.kind})\nmeaning: ${p.meaning}\nexamples: ${p.examples.join(", ")}`).join("\n\n");
    requests.push({
      custom_id: `parts-${String(i / PARTS_PER_REQUEST).padStart(3, "0")}-${Date.now().toString(36)}`,
      params: {
        model: MODEL,
        max_tokens: 32000,
        system: PART_SYSTEM,
        messages: [{ role: "user" as const, content: `Write the questions for these ${group.length} word parts, in this order.\n\n${body}` }],
        output_config: { format: { type: "json_schema", schema: partSchema } },
      },
    });
  }
  return requests;
}

type Store = Record<string, unknown>;
const storePath = (kind: string) => path.join(here, `gen-${kind}.json`);
const loadStore = (kind: string): Store => (existsSync(storePath(kind)) ? (JSON.parse(readFileSync(storePath(kind), "utf8")) as Store) : {});

function missing() {
  const out: { lower: Set<string>; middle: Set<string>; parts: Set<string> } = { lower: new Set(), middle: new Set(), parts: new Set() };
  for (const level of ["lower", "middle"] as const) {
    const have = loadStore(level);
    for (const w of decks[level]) if (!have[w.word]) out[level].add(w.word);
  }
  const haveParts = loadStore("parts");
  for (const p of parts) if (!haveParts[p.id]) out.parts.add(p.id);
  return out;
}

async function submit(client: Anthropic) {
  const need = missing();
  const requests = [
    ...(need.lower.size ? wordRequests("lower", need.lower) : []),
    ...(need.middle.size ? wordRequests("middle", need.middle) : []),
    ...(need.parts.size ? partRequests(need.parts) : []),
  ];
  if (requests.length === 0) {
    console.log("nothing missing");
    return null;
  }
  // The SDK's types predate output_config on batch params.
  const batch = await client.messages.batches.create({ requests } as unknown as Anthropic.Messages.BatchCreateParams);
  console.log(`batch ${batch.id}: ${requests.length} requests (${need.lower.size} lower, ${need.middle.size} middle, ${need.parts.size} parts)`);
  return batch.id;
}

async function wait(client: Anthropic, id: string) {
  for (;;) {
    const batch = await client.messages.batches.retrieve(id);
    if (batch.processing_status === "ended") {
      console.log("ended", JSON.stringify(batch.request_counts));
      break;
    }
    console.log(new Date().toISOString(), batch.processing_status, JSON.stringify(batch.request_counts));
    await new Promise((r) => setTimeout(r, 60_000));
  }
  const stores = { lower: loadStore("lower"), middle: loadStore("middle"), parts: loadStore("parts") };
  let ok = 0;
  let bad = 0;
  let tokensOut = 0;
  for await (const item of await client.messages.batches.results(id)) {
    const kind = item.custom_id.split("-")[0] as "lower" | "middle" | "parts";
    if (item.result.type !== "succeeded") {
      bad++;
      console.log(item.custom_id, item.result.type);
      continue;
    }
    const message = item.result.message;
    tokensOut += message.usage.output_tokens;
    if (message.stop_reason !== "end_turn") {
      bad++;
      console.log(item.custom_id, "stopped:", message.stop_reason);
      continue;
    }
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    try {
      const parsed = JSON.parse(text) as { words?: { word: string }[]; parts?: { id: string }[] };
      for (const w of parsed.words ?? []) stores[kind][w.word] = w;
      for (const p of parsed.parts ?? []) stores[kind][p.id] = p;
      ok++;
    } catch {
      bad++;
      console.log(item.custom_id, "unparseable");
    }
  }
  for (const kind of ["lower", "middle", "parts"] as const) writeFileSync(storePath(kind), JSON.stringify(stores[kind], null, 1));
  const need = missing();
  console.log(`requests ok ${ok}, failed ${bad}, output tokens ${tokensOut}. Still missing: ${need.lower.size} lower, ${need.middle.size} middle, ${need.parts.size} parts`);
}

async function main() {
  const client = new Anthropic({ maxRetries: 5 });
  const [command, arg] = process.argv.slice(2);
  if (command === "submit") {
    await submit(client);
  } else if (command === "wait" && arg) {
    await wait(client, arg);
  } else if (command === "sample") {
    const level = (arg === "lower" ? "lower" : "middle") as "lower" | "middle";
    const pick = new Set(process.argv.slice(4));
    const [request] = pick.has("parts") ? partRequests(new Set(["sub", "spect", "less"])) : wordRequests(level, pick);
    const message = await client.messages.stream(request.params as unknown as Anthropic.MessageStreamParams).finalMessage();
    console.log(message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
    console.error(JSON.stringify(message.usage));
  } else if (command === "retry" || command === "run") {
    const id = await submit(client);
    if (id) await wait(client, id);
  } else {
    console.log("usage: generate.mts submit | wait <batch id> | run");
  }
}

main().catch((error) => {
  if (error instanceof Anthropic.APIError) console.error(`API error ${error.status}: ${error.message}`);
  else console.error(error);
  process.exit(1);
});
