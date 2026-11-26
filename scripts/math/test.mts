/**
 * Runs the importer on scripts/math/sample.csv into a temp folder and puts
 * what it wrote through the checker; also checks the checker itself catches
 * broken questions, and that none of this touches the bank files in the app.
 *
 *   tsx scripts/math/test.mts
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BANK_DIR, bankFile, diagramProblems, here, LEVELS, questionProblems, textProblems, validateBank, type Bank, type Question } from "./bank.mts";
import { checkFile } from "./check.mts";
import { fixDollars, parseCsv, questionId, readTopic, runImport } from "./import.mts";

let failures = 0;
function check(ok: boolean, what: string) {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
}
const errorsIn = (file: string) => checkFile(file).problems.filter((p) => p.level === "error");
const fingerprint = (file: string) => (existsSync(file) ? createHash("sha1").update(readFileSync(file)).digest("hex") : "absent");

const watched = [...LEVELS.map((l) => bankFile(BANK_DIR, l)), path.join(here, "todo.json")];
const before = watched.map(fingerprint);
const csv = path.join(here, "sample.csv");
const tmp = mkdtempSync(path.join(tmpdir(), "math-import-"));

try {
  console.log("The placeholder bank");
  for (const level of LEVELS) {
    const { problems, bank } = checkFile(bankFile(BANK_DIR, level));
    check(problems.length === 0, `${level} bank passes the checker with no warnings`);
    check(bank?.questions.length === 40, `${level} bank has 40 questions`);
  }

  console.log("Reading the CSV");
  const cells = parseCsv('a,"b, ""c""\nd",e\r\n\r\n1,2,3');
  check(cells.length === 2 && cells[0].cells[1] === 'b, "c"\nd' && cells[1].line === 4, "quoted commas, quotes and line breaks");
  check(fixDollars("It costs $5.50 and $6.") === "It costs \\$5.50 and \\$6.", "money dollars are escaped");
  check(fixDollars("If $3x + 5 = 20$, what is $x$?") === "If $3x + 5 = 20$, what is $x$?", "maths dollars are left alone");
  check(fixDollars("Pay $4 for $n$ pens, \\$2 back") === "Pay \\$4 for $n$ pens, \\$2 back", "money and maths in one sentence");
  check(readTopic("Fractions and Decimals")?.topic === "fractions" && readTopic("Order of operations")?.topic === "whole numbers" && readTopic("Poetry") === null, "topics map to the first match");

  console.log("Import with no sidecars (a report only writes nothing)");
  const empty = path.join(tmp, "no-sidecars");
  const dry = runImport({ csv, sidecars: empty });
  check(dry.written.length === 0, "nothing written without --write or --out");

  const out1 = path.join(tmp, "out1");
  const first = runImport({ csv, out: out1, sidecars: empty });
  const lower1 = JSON.parse(readFileSync(bankFile(out1, "lower"), "utf8")) as Bank;
  const middle1 = JSON.parse(readFileSync(bankFile(out1, "middle"), "utf8")) as Bank;
  for (const level of LEVELS) check(errorsIn(bankFile(out1, level)).length === 0, `${level} output passes the checker`);
  check(lower1.questions.length === 1 && middle1.questions.length === 2, "1 lower and 2 middle questions (the undrawn one waits)");
  check([...lower1.questions, ...middle1.questions].every((q) => q.source === "real"), "all real, placeholders dropped");

  const rectId = questionId("lower", "What is the area of the rectangle shown?");
  const algebraId = questionId("middle", "If $3x + 5 = 20$, what is the value of $x$?");
  const coat = middle1.questions.find((q) => q.type === "comparison");
  const apples = lower1.questions[0];
  check(coat?.prompt === "A coat that costs \\$80 is marked 25% off." && coat.columnB === "\\$60" && coat.answer === 2, "the comparison: money escaped, standard choices, answer C");
  check(coat?.ref === "Sample Book, p. 12" && coat.explanation.split("\n").length === 3, "quoted source and a three-line explanation");
  check(apples.topic === "fractions" && apples.type === "word" && apples.answer === 0 && apples.prompt.includes("12 apples, 8 pears, and 4 plums"), "the quoted comma, a mapped topic, a blank type");
  check(first.todo.diagram.length === 1 && first.todo.diagram[0].id === rectId, "todo lists the rectangle's diagram");
  check(first.todo.heldBack.length === 1 && first.todo.heldBack[0].id === rectId, "the rectangle is held back");
  check(first.todo.explanation.map((m) => m.id).sort().join() === [rectId, algebraId].sort().join(), "todo lists the two missing explanations");
  check(first.todo.difficulty.length === 1 && first.todo.difficulty[0].id === rectId, "todo lists the missing difficulty");
  check(existsSync(path.join(out1, "todo.json")), "todo.json is written beside the output");

  const out1b = path.join(tmp, "out1b");
  runImport({ csv, out: out1b, sidecars: empty });
  check(readFileSync(bankFile(out1b, "middle"), "utf8") === readFileSync(bankFile(out1, "middle"), "utf8"), "importing again gives the same ids and file");

  console.log("Import with sidecars and --keep-placeholders");
  const side = path.join(tmp, "sidecars");
  rmSync(side, { recursive: true, force: true });
  const out2 = path.join(tmp, "out2");
  runImport({ csv, out: side, sidecars: empty }); // only to make the folder
  writeFileSync(
    path.join(side, "diagrams.json"),
    JSON.stringify({
      [rectId]: {
        w: 100,
        h: 60,
        items: [
          { t: "poly", pts: [[25, 15], [75, 15], [75, 45], [25, 45]], closed: true, fill: "light" },
          { t: "text", at: [50, 10], s: "5 in", size: "m", anchor: "c" },
          { t: "text", at: [78, 31], s: "3 in", size: "m", anchor: "l" },
        ],
      },
    }),
  );
  writeFileSync(
    path.join(side, "explanations.json"),
    JSON.stringify({ [rectId]: "Area is length times width.\n$5 \\times 3 = 15$.\nThe answer is 15 square inches.", [algebraId]: "Subtract 5: $3x = 15$.\nDivide by 3.\nThe answer is 5." }),
  );
  writeFileSync(path.join(side, "difficulty.json"), JSON.stringify({ [rectId]: 1 }));
  writeFileSync(
    path.join(side, "variants.json"),
    JSON.stringify({
      [algebraId]: [
        { prompt: "If $4x + 3 = 31$, what is the value of $x$?", choices: ["28", "7", "$\\frac{17}{2}$", "112"], answer: 1, explanation: "Subtract 3: $4x = 28$.\nDivide by 4.\nThe answer is 7." },
        { prompt: "A broken variant with $unbalanced maths", choices: ["1", "2", "3", "4"], answer: 0 },
      ],
      "M-00000000": [{ prompt: "An orphan", choices: ["1", "2", "3", "4"], answer: 0 }],
    }),
  );
  const second = runImport({ csv, out: out2, sidecars: side, keepPlaceholders: true });
  const lower2 = JSON.parse(readFileSync(bankFile(out2, "lower"), "utf8")) as Bank;
  const middle2 = JSON.parse(readFileSync(bankFile(out2, "middle"), "utf8")) as Bank;
  for (const level of LEVELS) check(errorsIn(bankFile(out2, level)).length === 0, `${level} output passes the checker`);
  const count = (b: Bank, source: string) => b.questions.filter((q) => q.source === source).length;
  check(count(lower2, "real") === 2 && count(lower2, "placeholder") === 40, "lower: 2 real beside the 40 placeholders");
  check(count(middle2, "real") === 2 && count(middle2, "variant") === 1 && count(middle2, "placeholder") === 40, "middle: 2 real, 1 variant, 40 placeholders");
  const rect = lower2.questions.find((q) => q.id === rectId);
  check(rect?.diagram?.items.length === 3 && rect.difficulty === 1 && rect.answer === 1 && rect.explanation.endsWith("15 square inches."), "the rectangle has its drawing, difficulty, explanation and text answer");
  const variant = middle2.questions.find((q) => q.source === "variant");
  check(variant?.id === `${algebraId}-v1` && variant.of === algebraId && variant.section === "ma" && variant.ref === "Sample Book, p. 77", "the variant's id, parent and inherited fields");
  check(second.todo.diagram.length + second.todo.explanation.length + second.todo.difficulty.length === 0, "nothing left to supply");
  check(second.todo.heldBack.length === 1 && second.todo.heldBack[0].id === `${algebraId}-v2`, "the broken variant is held back");
  check(second.notes.some((n) => n.includes("M-00000000")), "the orphan variant is reported");

  console.log("The checker catches broken questions");
  const good = middle2.questions.find((q) => q.id === algebraId) as Question;
  const broken = (change: Partial<Question>) => questionProblems({ ...good, ...change }, "middle").errors.length > 0;
  check(questionProblems(good, "middle").errors.length === 0, "a good question has no errors");
  check(broken({ id: "X-1" }) && broken({ id: "L-0001" }), "a malformed id, an id for the wrong level");
  check(broken({ choices: ["1", "2", "3"] }) && broken({ choices: ["1", "2", "2", "3"] }), "three choices, a repeated choice");
  check(broken({ answer: 4 }) && broken({ topic: "poetry" as never }) && broken({ section: "xx" as never }) && broken({ difficulty: 4 as never }), "answer, topic, section, difficulty out of range");
  check(broken({ prompt: "It costs $5." }) && broken({ prompt: "What is $\\dfrac{1}{2}$?" }) && broken({ prompt: "What is $\\frac{1}{2$?" }), "unpaired dollars, unknown LaTeX, unpaired braces");
  check(broken({ type: "comparison" }) && broken({ columnA: "x" }), "a comparison without the standard choices, a column on a word question");
  check(questionProblems({ ...good, id: "L-abcd1234", type: "comparison", columnA: "1", columnB: "2", choices: coat?.choices ?? [] }, "lower").errors.length > 0, "a comparison at Lower Level");
  check(broken({ explanation: "a\nb\nc\nd" }), "a four-line explanation");
  check(textProblems("Costs \\$5 and $x^2 \\times 3$ and $90^\\circ$").length === 0, "good text passes");
  check(diagramProblems({ w: 100, h: 60, items: [{ t: "circle", c: [50, 30], r: 40, fill: "none" }] }).errors.length > 0, "a circle outside the box");
  check(diagramProblems({ w: 100, h: 60, items: [{ t: "text", at: [50, 30], s: "$x$", size: "m", anchor: "c" }] }).errors.length > 0, "LaTeX in a diagram label");
  check(diagramProblems({ w: 100, h: 60, items: [{ t: "blob" }] }).errors.length > 0, "an unknown diagram item");
  const orphan = { ...middle2, questions: middle2.questions.filter((q) => q.id !== algebraId) };
  check(validateBank(orphan, "middle").some((p) => p.level === "error" && p.message.includes("not in this bank")), "a variant whose real question is gone");
  check(validateBank({ ...middle2, questions: [good, good] }).some((p) => p.message.includes("more than once")), "a repeated id");

  console.log("The app's files");
  check(watched.map(fingerprint).join() === before.join(), "the bank files and scripts/math/todo.json are untouched");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
