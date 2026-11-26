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
import { BANK_DIR, bankFile, diagramProblems, here, LEVELS, questionProblems, textProblems, validateBank, type Bank, type Question } from "./bank.mjs";
import { checkFile } from "./check.mjs";
import { cellText, markup } from "./convert.mjs";
import { fixDollars, parseCsv, questionId, readId, readTopic, runImport } from "./import.mjs";

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
  console.log("The app's bank");
  for (const level of LEVELS) {
    const { problems, bank } = checkFile(bankFile(BANK_DIR, level));
    check(problems.every((p) => p.level !== "error"), `${level} bank passes the checker`);
    check((bank?.questions.length ?? 0) >= 40, `${level} bank has at least 40 questions`);
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
  // The placeholders come from the app's bank, which has none left once the real import has been written.
  const kept = (level: (typeof LEVELS)[number]) => checkFile(bankFile(BANK_DIR, level)).bank?.questions.filter((q) => q.source === "placeholder").length ?? 0;
  check(count(lower2, "real") === 2 && count(lower2, "placeholder") === kept("lower"), "lower: 2 real beside the bank's placeholders");
  check(count(middle2, "real") === 2 && count(middle2, "variant") === 1 && count(middle2, "placeholder") === kept("middle"), "middle: 2 real, 1 variant, and the bank's placeholders");
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

  console.log("A sheet with its own ids, fine-grained topics and written questions");
  const sheetCsv = path.join(tmp, "sheet.csv");
  const sheetHeader = "id,level,section,topic,type,question,choice_a,choice_b,choice_c,choice_d,answer,explanation,difficulty,diagram,source,column_a,column_b,origin,markup";
  const sheetRows = [
    'M007,middle,Quantitative Reasoning,Word Problems with Ratios,word problem,"$AB = 5$ and $BC = 10$. What is $\\frac{AB}{BC}$?",$\\frac{1}{2}$,2,5,50,A,"$\\frac{5}{10} = \\frac{1}{2}$.",2,,Written for the test,,,written,bank',
    "L012,lower,Mathematics Achievement,Area of Rectangles,computation,What is the area of a 3 by 4 rectangle?,7,12,14,24,B,3 times 4 is 12.,1,,Written for the test,,,written,bank",
  ];
  writeFileSync(sheetCsv, [sheetHeader, ...sheetRows].join("\n"));
  const out3 = path.join(tmp, "out3");
  const third = runImport({ csv: sheetCsv, out: out3, sidecars: empty });
  const m7 = third.banks.middle?.questions[0];
  const l12 = third.banks.lower?.questions[0];
  for (const level of LEVELS) check(errorsIn(bankFile(out3, level)).length === 0, `${level} output passes the checker`);
  check(m7?.id === "M-0007" && l12?.id === "L-0012" && readId("m-12") === "M-0012", "the sheet's ids are used: M007 becomes M-0007");
  check(m7?.source === "written" && m7.ref === "Written for the test", 'origin "written" is recorded as the source');
  check(m7?.topic === "ratios" && m7.subtopic === "Word Problems with Ratios" && l12?.topic === "geometry" && l12.subtopic === "Area of Rectangles", "topics.json maps the topic and the sheet's own is kept as subtopic");
  check(m7?.prompt === "$AB = 5$ and $BC = 10$. What is $\\frac{AB}{BC}$?", 'text marked "bank" keeps its dollar signs as they are');
  writeFileSync(sheetCsv, [sheetHeader, sheetRows[0], sheetRows[0].replace("M007", "M-0007")].join("\n"));
  let refused = "";
  try {
    runImport({ csv: sheetCsv, sidecars: empty });
  } catch (e) {
    refused = (e as Error).message;
  }
  check(refused.includes("M-0007"), "an id used twice stops the import");
  writeFileSync(sheetCsv, [sheetHeader, sheetRows[0].replace("M007", "L007")].join("\n"));
  check(runImport({ csv: sheetCsv, sidecars: empty }).todo.heldBack[0]?.reasons.join().includes("does not belong") === true, "an id for the wrong level is held back");

  console.log("Corrections and the per-level diagram files");
  const fixCsv = path.join(tmp, "fix.csv");
  const fixRow = (id: string, level: string, question: string, diagram = "") =>
    `${id},${level},qr,algebra,word problem,${question},1,2,3,4,A,It is 1.,1,${diagram},Written for the test,,,written,bank`;
  writeFileSync(
    fixCsv,
    [
      sheetHeader,
      fixRow("L001", "lower", "Wrong answer key?"),
      fixRow("L002", "lower", "Wrong choice?"),
      fixRow("L003", "lower", "Unanswerable?"),
      fixRow("L004", "lower", "Corrected into nonsense?"),
      fixRow("L005", "lower", "What is shown in the drawn figure?", "A square of side 2"),
      fixRow("L006", "lower", "What is shown in the impossible figure?", "A triangle with sides 1 1 and 5"),
      fixRow("L007", "lower", "What is shown in the figure nobody drew?", "A circle"),
      fixRow("M001", "middle", "Fine as it is?"),
    ].join("\n"),
  );
  const fixes = path.join(tmp, "fixes");
  runImport({ csv: fixCsv, out: fixes, sidecars: empty }); // only to make the folder
  const square = { w: 100, h: 60, items: [{ t: "poly", pts: [[30, 10], [70, 10], [70, 50], [30, 50]], closed: true, fill: "none" }] };
  const writeFixes = (lower: Record<string, unknown>) => writeFileSync(path.join(fixes, "corrections-lower.json"), JSON.stringify({ checked: 300, corrections: lower }));
  writeFixes({
    "L-0001": { why: "the key was wrong", answer: 2, explanation: "It is 3." },
    "L-0002": { why: "two choices should differ more", choices: ["1", "2", "$\\frac{7}{2}$", "4"], difficulty: 3, prompt: "Which is 1?" },
    "L-0003": { why: "no right answer", drop: true },
    "L-0004": { why: "a bad correction", choices: ["1", "1", "3", "4"] },
  });
  writeFileSync(path.join(fixes, "corrections-middle.json"), JSON.stringify({ checked: 300, corrections: {} }));
  writeFileSync(path.join(fixes, "diagrams-lower.json"), JSON.stringify({ diagrams: { "L-0005": square, "L-0006": square }, problems: { "L-0006": "the sides cannot make a triangle" } }));
  const fixOut = path.join(tmp, "fixout");
  const fixed = runImport({ csv: fixCsv, out: fixOut, sidecars: [empty, fixes] });
  const got = new Map(fixed.banks.lower?.questions.map((q) => [q.id, q]));
  for (const level of LEVELS) check(errorsIn(bankFile(fixOut, level)).length === 0, `${level} output passes the checker`);
  check(got.get("L-0001")?.answer === 2 && got.get("L-0001")?.explanation === "It is 3.", "a correction changes the answer and the explanation");
  check(got.get("L-0002")?.choices[2] === "$\\frac{7}{2}$" && got.get("L-0002")?.difficulty === 3 && got.get("L-0002")?.prompt === "Which is 1?" && got.get("L-0002")?.answer === 0, "a correction changes the choices, difficulty and prompt");
  check(!got.has("L-0003") && fixed.todo.dropped.map((d) => d.id).join() === "L-0003" && !fixed.todo.heldBack.some((h) => h.id === "L-0003"), "a dropped question is left out and counted, not held back");
  check(!got.has("L-0004") && fixed.todo.heldBack.find((h) => h.id === "L-0004")?.reasons.join().includes("after its correction") === true, "a correction that breaks a rule holds the question back with the reason");
  check(fixed.todo.corrected.map((c) => c.id).join() === "L-0001,L-0002,L-0004" && fixed.banks.middle?.questions.length === 1, "the report counts the corrected questions, level by level");
  check(got.get("L-0005")?.diagram?.items.length === 1, "a figure in diagrams-lower.json is attached");
  check(!got.has("L-0006") && fixed.todo.diagram.find((d) => d.id === "L-0006")?.problem === "the sides cannot make a triangle" && fixed.todo.heldBack.some((h) => h.id === "L-0006"), "a figure listed under problems is held back and listed in todo");
  check(!got.has("L-0007") && fixed.todo.diagram.some((d) => d.id === "L-0007"), "a described figure with no drawing is held back as before");
  check(JSON.parse(readFileSync(path.join(fixOut, "todo.json"), "utf8")).dropped.length === 1, "todo.json records what was dropped");
  writeFixes({ "L-0999": { why: "no such question", answer: 1 } });
  let stray = "";
  try {
    runImport({ csv: fixCsv, sidecars: [empty, fixes] });
  } catch (e) {
    stray = (e as Error).message;
  }
  check(stray.includes("L-0999"), "a correction for an id the CSV does not have stops the import");

  console.log("Converting the Sheet's cells");
  const cell = (c: unknown) => cellText(c).text;
  check(cell(3) === "3" && cell(2.5) === "2.5" && cell(null) === "" && cell("'-67") === "-67", "3.0 is 3, blank is empty, the text apostrophe goes");
  check(cell({ date: "2026-01-02" }) === "1/2" && cell({ date: "2026-03-04" }) === "3/4" && cell({ date: "2026-11-15" }) === "11/15", "dates are read back as fractions");
  check(cellText({ date: "2032-01-01" }).recovery?.certain === false && cellText({ time: "02:30:00" }).recovery?.certain === false, "a date in another year and a time are flagged as uncertain");
  check(cell({ number: 0.5, shown: "50%" }) === "50%" && cell({ number: 2, shown: "$2.00" }) === "$2.00", "percent and money cells use what was shown");
  const mk = (t: string) => markup(t).text;
  check(mk("What is 3/8 + 3/8?") === "What is $\\frac{3}{8} + \\frac{3}{8}$?" && mk("What is 3 1/4 ÷ 3 1/2?") === "What is $3\\frac{1}{4} \\div 3\\frac{1}{2}$?", "fractions and mixed numbers");
  check(mk("If x = 1 and y = 2, what is 3x² − 2xy + y?") === "If $x = 1$ and $y = 2$, what is $3x^2 - 2xy + y$?", "an expression with a superscript");
  check(mk("l = (P − 2w)/2") === "$l = \\frac{P - 2w}{2}$" && mk("1/x^7") === "$\\frac{1}{x^7}$" && mk("2y^12") === "$2y^{12}$" && mk("√(9² + 40²)") === "$\\sqrt{9^2 + 40^2}$", "fractions of brackets, exponents, roots");
  check(mk("C = 9h − 39; $-12") === "$C = 9h - 39$; \\$-12" && mk("Sam pays $3.75 each.") === "Sam pays \\$3.75 each.", "money is escaped");
  check(mk("The figure is a 10 × 9 rectangle.") === "The figure is a $10 \\times 9$ rectangle." && mk("36π sq cm") === "$36\\pi$ sq cm" && mk("V = πr²h") === "$V = \\pi r^2h$", "times, pi, and words left alone");
  check(mk("A 2-unit-wide strip on the x-axis at 9:15 A.M. costs 40% more.") === "A 2-unit-wide strip on the $x$-axis at 9:15 A.M. costs 40% more." && mk("32 cm") === "32 cm" && mk("What is 1,971 + 4,271?") === "What is 1,971 + 4,271?", "hyphens, times of day, percents, units and comma numbers are not maths");
  check(markup("If □ − 21 = 107, what goes in the □?").doubt !== null && markup("Sum = 72, ÷ 6 = 12.").doubt !== null && markup("35 min = 0 h 35 min").doubt !== null, "half an expression is doubtful, so the field stays plain");
  check([mk("(-5, -3)"), mk("-7/2"), mk("x = 6, y = -4")].join("|") === "$(-5, -3)$|$-\\frac{7}{2}$|$x = 6$, $y = -4$", "coordinates and negatives");

  console.log("The app's files");
  check(watched.map(fingerprint).join() === before.join(), "the bank files and scripts/math/todo.json are untouched");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
