// Generate a wave of trivia questions across the family's topics/levels/types,
// run each through the adversarial verifier, and emit the verified ones as a
// committed data-migration seed (mirrors the baseball "generated data migration"
// pattern). On merge to main, .github/workflows/migrate.yml applies the migration
// to production. Questions that fail verification are dropped. Run:
//   npx tsx --tsconfig scripts/tsconfig.json scripts/games/seed-starter-questions.mts
//
// Requires ANTHROPIC_API_KEY. Each run AUTO-NUMBERS a NEW migration (the next
// available 00NNN), so it tops up the bank rather than overwriting an existing
// seed — safe to run repeatedly. Commit the new migration file it writes.

import { config } from "dotenv";
import { writeFileSync, readdirSync } from "node:fs";
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

// A wave of topics across Oscar's 5th-grade curriculum + interests, Sebastian's
// 7th-grade curriculum + interests, the parents' wheelhouses, and general/all-ages
// categories. Re-running with different topics here tops up the bank further.
const PLAN: Plan[] = [
  // Younger kid (Oscar)
  { topic: "U.S. states and their capitals", level: "younger_kid", type: "mc", count: 7 },
  { topic: "The solar system, planets, and space", level: "younger_kid", type: "mc", count: 7 },
  { topic: "Multiplication and division facts", level: "younger_kid", type: "mc", count: 7 },
  { topic: "Dinosaurs and prehistoric life", level: "younger_kid", type: "mc", count: 6 },
  { topic: "Minecraft and popular video games", level: "younger_kid", type: "mc", count: 6 },
  { topic: "Pokémon", level: "younger_kid", type: "mc", count: 6 },
  { topic: "American symbols and famous landmarks", level: "younger_kid", type: "mc", count: 6 },
  { topic: "Kids' books: Percy Jackson, Harry Potter, and Charlotte's Web", level: "younger_kid", type: "mc", count: 6 },
  // Older kid (Sebastian)
  { topic: "Ancient Egypt, Greece, and Rome", level: "older_kid", type: "mc", count: 7 },
  { topic: "World rivers, mountains, and deserts", level: "older_kid", type: "mc", count: 6 },
  { topic: "Pre-algebra: integers and one-step equations", level: "older_kid", type: "mc", count: 7 },
  { topic: "The U.S. Constitution and branches of government", level: "older_kid", type: "mc", count: 6 },
  { topic: "Famous scientists and their inventions", level: "older_kid", type: "mc", count: 6 },
  { topic: "Geometry: area, perimeter, and volume", level: "older_kid", type: "mc", count: 6 },
  { topic: "World capitals (challenging)", level: "older_kid", type: "mc", count: 6 },
  { topic: "The San Francisco Giants (last two decades)", level: "older_kid", type: "mc", count: 6 },
  // Parents
  { topic: "1980s and 1990s pop music", level: "adult", type: "mc", count: 7 },
  { topic: "Classic rock bands and albums", level: "adult", type: "mc", count: 6 },
  { topic: "Famous novels and their authors", level: "adult", type: "mc", count: 6 },
  { topic: "Movies: directors and Best Picture winners", level: "adult", type: "mc", count: 6 },
  { topic: "Programming languages and tech companies", level: "adult", type: "mc", count: 6 },
  { topic: "Classical composers and their works", level: "adult", type: "mc", count: 6 },
  { topic: "20th-century world history", level: "adult", type: "mc", count: 6 },
  { topic: "World geography (challenging)", level: "adult", type: "mc", count: 6 },
  // Everyone
  { topic: "Food and cooking around the world", level: "all", type: "mc", count: 6 },
  { topic: "The Olympics and famous athletes", level: "all", type: "mc", count: 6 },
  { topic: "Music, instruments, and bands", level: "all", type: "mc", count: 6 },
  { topic: "General knowledge", level: "all", type: "mc", count: 6 },
  { topic: "Famous landmarks: how tall and how old", level: "all", type: "closest", count: 5 },
  { topic: "Animal records and extremes", level: "all", type: "closest", count: 5 },
  { topic: "Inventions and discoveries: what year", level: "all", type: "closest", count: 5 },
  { topic: "Geography lists (continents, oceans, Great Lakes)", level: "all", type: "list", count: 4 },
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
const built = (await pool(PLAN.map((p) => () => runBatch(p)), 5)).flat();

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

const migration = `-- Games · Trivia — question bank seed.
--
-- A wave of ${built.length} questions across the family's topics/levels/types,
-- generated by scripts/games/seed-starter-questions.mts and gated by the
-- adversarial verifier (only status='ready' questions are written). batch_id is
-- left NULL (these did not come from an in-app generation batch). Applied to
-- production by .github/workflows/migrate.yml on merge; in-game "toss" handles
-- any that slip through.

INSERT INTO trivia_questions (topic, level, type, prompt, payload, perishable, status, verification)
VALUES
${rows};
`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migDir = join(root, "supabase/migrations");
const nums = readdirSync(migDir)
  .map((f) => parseInt(f.slice(0, 5), 10))
  .filter((n) => !Number.isNaN(n));
const next = String(Math.max(0, ...nums) + 1).padStart(5, "0");
const outPath = join(migDir, `${next}_trivia_questions_seed.sql`);
writeFileSync(outPath, migration);

const byLevel = built.reduce<Record<string, number>>((m, b) => {
  m[b.level] = (m[b.level] ?? 0) + 1;
  return m;
}, {});
console.log(`\nWrote ${built.length} questions to ${outPath}`);
console.log("By level:", byLevel);
