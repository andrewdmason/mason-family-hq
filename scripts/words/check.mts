/**
 * A second opinion on every question generate.mts wrote: each one is put to
 * the model cold, with its choices in a fixed shuffled order and no answer
 * key. A question whose "right" answer the solver doesn't pick has either two
 * defensible answers or none, and a kid shouldn't be marked wrong on it, so
 * build.mts leaves it out.
 *
 * Results are kept in scripts/words/checked.json, keyed by question, so a
 * rerun only looks at what's new.
 *
 *   tsx --env-file=.env.local scripts/words/check.mts
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const content = path.join(here, "../../src/lib/words/content");
const MODEL = "claude-opus-5-5";
const PER_REQUEST = 40;
const AT_ONCE = 6;

type Form = { kind: string; stem: string; answer: string; traps: { text: string }[] };
type Item = { id: string; forms: Record<string, Form> };
type Question = { key: string; kind: string; stem: string; choices: string[]; answer: string };

const checkedPath = path.join(here, "checked.json");
const checked: Record<string, { ok: boolean; picked: string; answer: string }> = existsSync(checkedPath)
  ? JSON.parse(readFileSync(checkedPath, "utf8"))
  : {};

// The same order every run, so a question's key means the same question.
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

const questions: Question[] = [];
for (const file of ["lower", "middle", "parts"]) {
  const items = JSON.parse(readFileSync(path.join(content, `${file}.json`), "utf8")) as Item[];
  for (const it of items) {
    for (const [name, form] of Object.entries(it.forms)) {
      // "What does this part mean" is built from the parts table, not generated.
      if (name === "mean") continue;
      const key = `${file}|${it.id}|${name}|${form.answer}|${form.traps.map((t) => t.text).join("/")}`;
      if (checked[key]) continue;
      questions.push({ key, kind: form.kind, stem: form.stem, choices: order(key, [form.answer, ...form.traps.map((t) => t.text)]), answer: form.answer });
    }
  }
}
console.log(`${questions.length} questions to check`);

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["answers"],
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "choice", "sure"],
        properties: { n: { type: "integer" }, choice: { type: "string", enum: ["A", "B", "C", "D"] }, sure: { type: "boolean" } },
      },
    },
  },
};

const SYSTEM = `You are checking multiple-choice vocabulary questions written for 10 to 13 year olds, in the style of the ISEE. Answer each one as a careful, well-read adult would.

- A question that shows a single word in capitals asks for the choice closest in meaning to it.
- A sentence with a blank asks for the choice that best completes it.
- Any other question is about a word part (a prefix, root or suffix): answer it as asked.

For each question give the letter of the best choice. Set "sure" to false when two choices are both defensible or none really fits; otherwise true.`;

const client = new Anthropic({ maxRetries: 5 });

async function solve(group: Question[]) {
  const body = group
    .map((q, i) => `${i + 1}. ${q.stem}\n${q.choices.map((c, j) => `${"ABCD"[j]}. ${c}`).join("\n")}`)
    .join("\n\n");
  const message = await client.messages
    .stream({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content: body }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
    } as unknown as Anthropic.MessageStreamParams)
    .finalMessage();
  if (message.stop_reason !== "end_turn") throw new Error(`stopped: ${message.stop_reason}`);
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const { answers } = JSON.parse(text) as { answers: { n: number; choice: string; sure: boolean }[] };
  for (const a of answers) {
    const q = group[a.n - 1];
    if (!q) continue;
    const picked = q.choices["ABCD".indexOf(a.choice)];
    checked[q.key] = { ok: picked === q.answer && a.sure, picked: a.sure ? picked : `${picked} (unsure)`, answer: q.answer };
  }
}

const groups: Question[][] = [];
for (let i = 0; i < questions.length; i += PER_REQUEST) groups.push(questions.slice(i, i + PER_REQUEST));
let next = 0;
let failed = 0;
await Promise.all(
  Array.from({ length: AT_ONCE }, async () => {
    while (next < groups.length) {
      const mine = next++;
      try {
        await solve(groups[mine]);
      } catch (error) {
        failed++;
        console.log(`group ${mine}: ${error instanceof Anthropic.APIError ? `API error ${error.status}` : String(error)}`);
      }
      if (mine % 10 === 0) {
        console.log(`${mine + 1}/${groups.length}`);
        writeFileSync(checkedPath, JSON.stringify(checked, null, 1));
      }
    }
  })
);
writeFileSync(checkedPath, JSON.stringify(checked, null, 1));
const bad = Object.entries(checked).filter(([, v]) => !v.ok);
console.log(`checked ${Object.keys(checked).length}, ${bad.length} not agreed, ${failed} groups failed`);
for (const [key, v] of bad.slice(0, 40)) console.log(`  ${key.split("|").slice(0, 3).join(" ")}: wanted "${v.answer}", solver picked "${v.picked}"`);
