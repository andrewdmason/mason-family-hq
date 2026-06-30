// Generate a big starter bank of trivia questions across the topics/levels/types
// the family discussed, run each through the adversarial verifier, and emit the
// verified ones as a committed data-migration seed (mirrors the baseball
// "generated, idempotent data migration" pattern). Questions that fail
// verification are dropped. Run:
//   npx tsx --tsconfig scripts/tsconfig.json scripts/games/seed-starter-questions.mts
//
// Requires ANTHROPIC_API_KEY. Re-running regenerates the migration file from
// scratch (new questions); commit the result.

import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
config({ path: ".env.local" });

const { generateQuestionBatch } = await import("../../src/lib/games/generate");
const { verifyQuestion } = await import("../../src/lib/games/verify");
import type { GeneratedQuestion, TriviaLevel, TriviaType } from "../../src/lib/games/types";

const AUDIENCE: Record<TriviaLevel, string> = {
  younger_kid: "a 9–10 year old entering 5th grade",
  older_kid: "a 12 year old entering 7th grade",
  adult: "well-read adults",
  all: "a mixed family audience of kids and adults",
};

type Plan = { topic: string; level: TriviaLevel; type: TriviaType; count: number };

// The starter plan, covering everything we talked through: Oscar's 5th-grade
// curriculum + interests, Sebastian's 7th-grade curriculum + interests, the
// parents' wheelhouses, and general/all-ages categories.
const PLAN: Plan[] = [
  // Younger kid (Oscar)
  { topic: "The 13 Colonies and the American Revolution", level: "younger_kid", type: "mc", count: 8 },
  { topic: "The 13 Colonies and the American Revolution", level: "younger_kid", type: "list", count: 3 },
  { topic: "Elementary math: number sense, place value, and math facts", level: "younger_kid", type: "mc", count: 6 },
  { topic: "Modern Major League Baseball (players, teams, recent seasons)", level: "younger_kid", type: "mc", count: 6 },
  { topic: "The books Holes, The Phantom Tollbooth, and Wonder", level: "younger_kid", type: "mc", count: 6 },
  // Older kid (Sebastian)
  { topic: "World history: the rise and fall of empires", level: "older_kid", type: "mc", count: 8 },
  { topic: "World geography and capital cities", level: "older_kid", type: "mc", count: 6 },
  { topic: "World geography: distances, heights, and sizes", level: "older_kid", type: "closest", count: 5 },
  { topic: "Fractions, decimals, percents, ratios, and calculating tips", level: "older_kid", type: "mc", count: 6 },
  { topic: "The San Francisco Giants (last two decades)", level: "older_kid", type: "mc", count: 6 },
  // Parents
  { topic: "Classical music and composers", level: "adult", type: "mc", count: 6 },
  { topic: "Pop and rock music history", level: "adult", type: "mc", count: 6 },
  { topic: "Technology and computing history", level: "adult", type: "mc", count: 6 },
  { topic: "Movies and literature", level: "adult", type: "mc", count: 6 },
  { topic: "Classic and modern literature", level: "adult", type: "list", count: 3 },
  // Everyone
  { topic: "General knowledge", level: "all", type: "mc", count: 6 },
  { topic: "Animals and the natural world", level: "all", type: "mc", count: 6 },
  { topic: "How big, how far, how many (estimation)", level: "all", type: "closest", count: 5 },
];

type Built = Plan & { q: GeneratedQuestion; notes: string | null };

/** Run an array of thunks with bounded concurrency. */
async function pool<T>(items: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await items[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

async function runBatch(plan: Plan): Promise<Built[]> {
  const gen = await generateQuestionBatch({
    topic: plan.topic,
    level: plan.level,
    type: plan.type,
    count: plan.count,
    audience: AUDIENCE[plan.level],
  });
  if (!gen.ok) {
    console.log(`  ✗ ${plan.topic} [${plan.level}/${plan.type}] — generation failed`);
    return [];
  }
  const verdicts = await Promise.all(gen.questions.map((q) => verifyQuestion(q)));
  const ready: Built[] = [];
  gen.questions.forEach((q, i) => {
    if (verdicts[i].verdict === "ready") ready.push({ ...plan, q, notes: verdicts[i].notes });
  });
  console.log(
    `  ✓ ${plan.topic} [${plan.level}/${plan.type}] — ${ready.length}/${gen.questions.length} ready`
  );
  return ready;
}

function sql(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
function jsonb(obj: unknown): string {
  return `${sql(JSON.stringify(obj))}::jsonb`;
}

console.log(`Generating ${PLAN.length} batches…\n`);
const built = (await pool(PLAN.map((p) => () => runBatch(p)), 4)).flat();

if (built.length === 0) {
  console.error("\nNo questions generated; aborting (not writing a migration).");
  process.exit(1);
}

const rows = built
  .map((b) => {
    const verification = { verdict: "ready", notes: b.notes };
    return (
      `  (${sql(b.topic)}, ${sql(b.level)}, ${sql(b.type)}, ${sql(b.q.prompt)}, ` +
      `${jsonb(b.q.payload)}, ${b.q.perishable}, 'ready', ${jsonb(verification)})`
    );
  })
  .join(",\n");

const migration = `-- Games · Trivia — starter question bank.
--
-- A seed of ${built.length} questions across the family's topics/levels/types,
-- generated by scripts/games/seed-starter-questions.mts and gated by the
-- adversarial verifier (only status='ready' questions are written). batch_id is
-- left NULL (these did not come from an in-app generation batch). Regenerate by
-- re-running the script; in-game "toss" handles any that slip through.

INSERT INTO trivia_questions (topic, level, type, prompt, payload, perishable, status, verification)
VALUES
${rows};
`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outPath = join(root, "supabase/migrations/00156_trivia_starter_questions.sql");
writeFileSync(outPath, migration);

const byLevel = built.reduce<Record<string, number>>((m, b) => {
  m[b.level] = (m[b.level] ?? 0) + 1;
  return m;
}, {});
console.log(`\nWrote ${built.length} questions to ${outPath}`);
console.log("By level:", byLevel);
