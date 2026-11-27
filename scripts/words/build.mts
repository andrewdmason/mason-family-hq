/**
 * Turns the decks (deck-*.json), the word parts (parts-seed.json) and what
 * generate.mts wrote (gen-*.json) into the files the app reads:
 * src/lib/words/content/{lower,middle,parts}.json. Checks every question on
 * the way and lists what it had to leave out. The sentence completions get
 * the decoys decoys.mts chose for them (gen-decoys-*.json), less any the
 * solver thought would also fit the sentence (checked-decoys.json).
 *
 *   tsx scripts/words/build.mts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "../../src/lib/words/content");
const read = <T,>(name: string): T => JSON.parse(readFileSync(path.join(here, name), "utf8")) as T;
const readIf = <T,>(name: string, otherwise: T): T => (existsSync(path.join(here, name)) ? read<T>(name) : otherwise);

type DeckWord = { word: string; pos: string; meaning: string; synonym: string; example: string; sentence: string; clue: string; tier: "core" | "ext"; rank: number };
type GenTrap = { text: string; trap: string; why: string };
type GenWord = {
  word: string;
  hook: string;
  tone: "positive" | "negative" | "neutral";
  parts: string[];
  syn1: { answer: string; traps: GenTrap[]; tip: string };
  syn2: { answer: string; traps: GenTrap[]; tip: string };
  sc1: { traps: GenTrap[]; tip: string };
  sc2: { sentence: string; traps: GenTrap[]; tip: string };
};
type PartSeed = { id: string; part: string; kind: "prefix" | "root" | "suffix"; meaning: string; examples: string[]; rank: number };
type GenApply = { prompt: string; answer: string; wrong: string[]; tip: string };
type GenPart = { id: string; hook: string; apply1: GenApply; apply2: GenApply };

// What check.mts made of each question when it answered them cold. One it
// didn't agree with has two defensible answers or none, and is left out.
const checked = readIf<Record<string, { ok: boolean }>>("checked.json", {});
let dropped = 0;
function agreed(file: string, id: string, forms: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [name, form] of Object.entries(forms) as [string, { answer: string; traps: { text: string }[] }][]) {
    const verdict = checked[`${file}|${id}|${name}|${form.answer}|${form.traps.map((t) => t.text).join("/")}`];
    if (verdict && !verdict.ok) dropped++;
    else kept[name] = form;
  }
  return kept;
}

type GenDecoy = { text: string; trap: string; why: string };
const decoysChecked = readIf<Record<string, { fits: string[]; best: string }>>("checked-decoys.json", {});
let decoysKept = 0;
let decoysLeftOut = 0;

/**
 * The decoys for a sentence completion that the solver, answering it cold,
 * didn't think would also fit. None when it didn't pick the answer, or the
 * sentence hasn't been checked yet with these decoys.
 */
function decoysFor(level: string, word: string, key: string, stem: string, gen: Record<string, { stem: string; decoys: GenDecoy[] }>, words: Set<string>) {
  const mine = gen[`${word}|${key}`];
  if (!mine || mine.stem !== stem || mine.decoys.length === 0) return [];
  const verdict = decoysChecked[`${level}|${word}|${key}|${word}|${mine.decoys.map((d) => d.text).join("/")}`];
  if (!verdict || verdict.best !== word) {
    decoysLeftOut += mine.decoys.length;
    return [];
  }
  const fits = new Set(verdict.fits.map(norm));
  const kept = mine.decoys.filter((d) => !fits.has(norm(d.text)) && words.has(norm(d.text)) && norm(d.text) !== norm(word));
  decoysKept += kept.length;
  decoysLeftOut += mine.decoys.length - kept.length;
  return kept.map((d) => ({ item: `w:${d.text}`, text: d.text, trap: d.trap, why: d.why }));
}

const norm = (s: string) => s.trim().toLowerCase();
const problems: string[] = [];

function checkChoices(where: string, answer: string, traps: { text: string }[]): boolean {
  const texts = traps.map((t) => norm(t.text));
  if (traps.length !== 3) return fail(where, `has ${traps.length} traps`);
  if (new Set(texts).size !== 3) return fail(where, "repeats a trap");
  if (texts.includes(norm(answer))) return fail(where, "has the answer among its traps");
  if (texts.some((t) => !t)) return fail(where, "has an empty trap");
  return true;
}
function fail(where: string, what: string): false {
  problems.push(`${where} ${what}`);
  return false;
}

const seeds = read<PartSeed[]>("parts-seed.json");
const partIds = new Set(seeds.map((p) => p.id));

// Parts that get mixed up with each other: the wrong answers for "what does
// this part mean" start with these.
const CONFUSED: string[][] = [
  ["pre", "post", "fore", "re"],
  ["sub", "super", "over", "inter"],
  ["bene", "mal", "mis"],
  ["un", "re", "dis", "in"],
  ["aud", "vis", "spect", "phon", "dict"],
  ["scrib", "graph", "dict", "port"],
  ["mit", "port", "tract", "ject", "duc"],
  ["struct", "rupt", "tract"],
  ["less", "ful", "ous", "able"],
  ["anti", "contra", "co", "ex", "de"],
  ["mono", "multi", "micro", "auto", "semi"],
  ["chron", "geo", "bio", "path", "therm"],
  ["ped", "man", "voc", "cred"],
  ["trans", "inter", "circum", "ex"],
  ["tion", "ify", "er", "able"],
];

function buildParts() {
  const gen = readIf<Record<string, GenPart>>("gen-parts.json", {});
  const byId = new Map(seeds.map((p) => [p.id, p]));
  return seeds.map((seed) => {
    const wrongMeanings: string[] = [];
    const consider = (id: string) => {
      const other = byId.get(id);
      if (!other || other.id === seed.id) return;
      if (norm(other.meaning) === norm(seed.meaning) || wrongMeanings.includes(other.meaning)) return;
      // "not" and "not or apart" would both be right for un-.
      const mine = seed.meaning.split(" or ").map(norm);
      if (other.meaning.split(" or ").some((m) => mine.includes(norm(m)))) return;
      if (wrongMeanings.length < 3) wrongMeanings.push(other.meaning);
    };
    for (const group of CONFUSED) if (group.includes(seed.id)) group.forEach(consider);
    for (let d = 1; wrongMeanings.length < 3 && d < seeds.length; d++) {
      const sameKind = seeds.filter((p) => p.kind === seed.kind);
      const at = sameKind.indexOf(seed);
      const neighbour = sameKind[(at + d) % sameKind.length];
      consider(neighbour.id);
    }
    const forms: Record<string, unknown> = {
      mean: {
        kind: "part",
        stem: `The ${seed.kind} ${seed.part} most nearly means:`,
        answer: seed.meaning,
        traps: wrongMeanings.map((text) => ({ text })),
        tip: `You already know ${seed.part} from ${seed.examples.join(" and ")}.`,
      },
    };
    const g = gen[seed.id];
    if (!g) problems.push(`part ${seed.id} has no generated questions`);
    for (const key of ["apply1", "apply2"] as const) {
      const q = g?.[key];
      if (!q) continue;
      if (!checkChoices(`part ${seed.id} ${key}`, q.answer, q.wrong.map((text) => ({ text })))) continue;
      forms[key] = { kind: "part", stem: q.prompt, answer: q.answer, traps: q.wrong.map((text) => ({ text })), tip: q.tip };
    }
    return {
      id: `p:${seed.id}`,
      type: "part",
      part: seed.part,
      kind: seed.kind,
      meaning: seed.meaning,
      examples: seed.examples,
      hook: g?.hook ?? `${seed.part} means ${seed.meaning}, as in ${seed.examples.join(" and ")}.`,
      rank: seed.rank,
      forms: agreed("parts", `p:${seed.id}`, forms),
    };
  });
}

function buildWords(level: "lower" | "middle") {
  const deck = read<DeckWord[]>(`deck-${level}.json`);
  const gen = readIf<Record<string, GenWord>>(`gen-${level}.json`, {});
  const genDecoys = readIf<Record<string, { stem: string; decoys: GenDecoy[] }>>(`gen-decoys-${level}.json`, {});
  const deckWords = new Set(deck.map((w) => norm(w.word)));
  const items = [];
  for (const w of deck) {
    const g = gen[w.word];
    if (!g) {
      problems.push(`${level} ${w.word} has no generated questions`);
      continue;
    }
    const forms: Record<string, unknown> = {};
    const cleanTraps = (traps: GenTrap[]) => traps.map((t) => ({ text: t.text.trim(), trap: t.trap, why: t.why.trim() }));
    const stem = w.word.toUpperCase();
    if (checkChoices(`${level} ${w.word} syn1`, g.syn1.answer, g.syn1.traps)) {
      forms.syn1 = { kind: "syn", stem, answer: g.syn1.answer.trim(), traps: cleanTraps(g.syn1.traps), tip: g.syn1.tip };
    }
    if (checkChoices(`${level} ${w.word} sc1`, w.word, g.sc1.traps)) {
      forms.sc1 = { kind: "sc", stem: w.sentence, answer: w.word, traps: cleanTraps(g.sc1.traps), tip: g.sc1.tip };
    }
    if (norm(g.syn2.answer) === norm(g.syn1.answer)) fail(`${level} ${w.word} syn2`, "repeats syn1's answer");
    else if (checkChoices(`${level} ${w.word} syn2`, g.syn2.answer, g.syn2.traps)) {
      forms.syn2 = { kind: "syn", stem, answer: g.syn2.answer.trim(), traps: cleanTraps(g.syn2.traps), tip: g.syn2.tip };
    }
    const blanks = g.sc2.sentence.split("_____").length - 1;
    if (blanks !== 1 || /_{6,}/.test(g.sc2.sentence)) fail(`${level} ${w.word} sc2`, `has ${blanks} blanks`);
    else if (new RegExp(`\\b${w.word}\\b`, "i").test(g.sc2.sentence)) fail(`${level} ${w.word} sc2`, "gives the word away");
    else if (checkChoices(`${level} ${w.word} sc2`, w.word, g.sc2.traps)) {
      forms.sc2 = { kind: "sc", stem: g.sc2.sentence.trim(), answer: w.word, traps: cleanTraps(g.sc2.traps), tip: g.sc2.tip };
    }
    const usable = agreed(level, `w:${w.word}`, forms);
    for (const [key, form] of Object.entries(usable) as [string, { kind: string; stem: string; decoys?: unknown[] }][]) {
      if (form.kind !== "sc") continue;
      const decoys = decoysFor(level, w.word, key, form.stem, genDecoys, deckWords);
      if (decoys.length) form.decoys = decoys;
    }
    if (Object.keys(usable).length < 2) {
      problems.push(`${level} ${w.word} left out: fewer than two usable questions`);
      continue;
    }
    items.push({
      id: `w:${w.word}`,
      type: "word",
      word: w.word,
      pos: w.pos,
      meaning: w.meaning,
      example: w.example,
      hook: g.hook,
      tone: g.tone,
      parts: g.parts.filter((p) => partIds.has(p)).map((p) => `p:${p}`),
      tier: w.tier,
      rank: w.rank,
      forms: usable,
    });
  }
  return items;
}

const parts = buildParts();
writeFileSync(path.join(out, "parts.json"), JSON.stringify(parts));
for (const level of ["lower", "middle"] as const) {
  const items = buildWords(level);
  writeFileSync(path.join(out, `${level}.json`), JSON.stringify(items));
  const forms = items.reduce((n, it) => n + Object.keys(it.forms).length, 0);
  const withParts = items.filter((it) => it.parts.length > 0).length;
  console.log(`${level}: ${items.length} words, ${forms} questions, ${withParts} words tied to a word part`);
}
console.log(`parts: ${parts.length}, ${parts.reduce((n, p) => n + Object.keys(p.forms).length, 0)} questions`);
if (dropped) console.log(`left out ${dropped} questions the cold check didn't agree with`);
console.log(`decoys: kept ${decoysKept}, left out ${decoysLeftOut} the solver thought might fit (or that aren't checked yet)`);
if (problems.length) console.log(`\n${problems.length} problems:\n${problems.join("\n")}`);
