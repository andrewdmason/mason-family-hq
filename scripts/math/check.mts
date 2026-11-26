/**
 * Checks Math bank files against the format the app reads (see bank.mts for
 * the rules): ids, sections, topics, types, four choices, the answer index,
 * the comparison rules, LaTeX and dollar signs, diagrams inside their box,
 * variants pointing at a real question. Prints what is wrong and exits
 * non-zero on any error. Warnings (a missing explanation, a long prompt, a
 * shape in the label margin) don't fail the check unless --strict is given.
 *
 *   tsx scripts/math/check.mts                    the two bank files in the app
 *   tsx scripts/math/check.mts path/to/bank.json  any other bank file(s)
 *   tsx scripts/math/check.mts --strict
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BANK_DIR, bankFile, LEVELS, validateBank, type Bank, type Level, type Problem } from "./bank.mjs";

export function checkFile(file: string): { problems: Problem[]; bank: Bank | null } {
  if (!existsSync(file)) return { problems: [{ id: null, level: "error", message: "file not found" }], bank: null };
  let bank: unknown;
  try {
    bank = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { problems: [{ id: null, level: "error", message: `not valid JSON: ${(e as Error).message}` }], bank: null };
  }
  const named = /math-(lower|middle)\.json$/.exec(path.basename(file))?.[1] as Level | undefined;
  const problems = validateBank(bank, named);
  return { problems, bank: problems.some((p) => p.level === "error" && p.id === null) ? null : (bank as Bank) };
}

function tally(bank: Bank, key: "section" | "topic" | "type" | "difficulty" | "source"): string {
  const counts = new Map<string, number>();
  for (const q of bank.questions) counts.set(String(q[key]), (counts.get(String(q[key])) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${k} ${n}`).join(", ");
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const files = args.filter((a) => !a.startsWith("--"));
  const targets = files.length ? files : LEVELS.map((l) => bankFile(BANK_DIR, l));

  let failed = false;
  for (const file of targets) {
    const { problems, bank } = checkFile(file);
    const errors = problems.filter((p) => p.level === "error");
    const warnings = problems.filter((p) => p.level === "warning");
    console.log(`\n${path.relative(process.cwd(), file) || file}`);
    if (bank) {
      console.log(`  ${bank.questions.length} questions, version ${bank.version}`);
      for (const key of ["source", "section", "type", "difficulty", "topic"] as const) console.log(`  by ${key}: ${tally(bank, key)}`);
      console.log(`  with a diagram: ${bank.questions.filter((q) => q.diagram).length}`);
    }
    for (const p of errors) console.log(`  ERROR ${p.id ? `${p.id}: ` : ""}${p.message}`);
    for (const p of warnings) console.log(`  warn  ${p.id ? `${p.id}: ` : ""}${p.message}`);
    console.log(`  ${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`);
    if (errors.length || (strict && warnings.length)) failed = true;
  }
  console.log(failed ? "\nFAILED" : "\nOK");
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
