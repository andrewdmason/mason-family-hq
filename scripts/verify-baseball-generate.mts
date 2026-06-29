// Headless verification for the migration generator (U5).
// Run: npx tsx scripts/verify-baseball-generate.mts
//
// Builds SQL from the cache fixture, asserts structure + the unresolved-player
// guard, then applies the SQL TWICE inside a rolled-back transaction against the
// local DB to prove it loads correctly and is idempotent (AE1). Rollback leaves
// the local DB untouched.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildMigrationSql, type Cache } from "./baseball/sql";
import { autoResolve, type Registry } from "./baseball/identity";

const here = dirname(fileURLToPath(import.meta.url));
const cache = JSON.parse(readFileSync(join(here, "baseball/fixtures/cache-sample.json"), "utf8")) as Cache;
const baseReg: Registry = (() => {
  const raw = JSON.parse(readFileSync(join(here, "baseball/people.json"), "utf8"));
  return { people: raw.people, aliases: raw.aliases };
})();

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};

// ---- guard: unresolved roster aborts ----
console.log("generator guard");
{
  let threw = false;
  try { buildMigrationSql([cache], baseReg); } catch { threw = true; }
  check("unresolved roster (base registry) throws", threw);
}

// ---- resolve identities, then build ----
const { registry } = autoResolve(cache.roster, baseReg);
const sql = buildMigrationSql([cache], registry);

console.log("generated SQL structure");
// Count over statement lines only (ignore -- comment lines like the header).
const statementSql = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");
const count = (re: RegExp) => (statementSql.match(re) ?? []).length;
check("3 people upserts", count(/INSERT INTO baseball_people/g) === 3, count(/INSERT INTO baseball_people/g));
check("1 team upsert", count(/INSERT INTO baseball_teams/g) === 1);
check("3 team_player upserts", count(/INSERT INTO baseball_team_players/g) === 3);
check("2 game upserts", count(/INSERT INTO baseball_games/g) === 2);
check("3 season stat upserts", count(/INSERT INTO baseball_season_player_stats/g) === 3);
check("3 game player stat upserts", count(/INSERT INTO baseball_game_player_stats/g) === 3);
check("no game events by default (too large for the migration)", count(/INSERT INTO baseball_game_events/g) === 0);
check("includeEvents emits 2 event upserts", (buildMigrationSql([cache], registry, { includeEvents: true }).match(/INSERT INTO baseball_game_events/g) ?? []).length === 2);
check("15 INSERT statements (no events)", count(/INSERT INTO/g) === 15, count(/INSERT INTO/g));
check("every statement is ON CONFLICT DO UPDATE", count(/ON CONFLICT/g) === count(/INSERT INTO/g) && count(/DO UPDATE/g) === count(/INSERT INTO/g));
check("kid user_id resolved via family_members subquery", /family_members WHERE lower\(name\) = lower\('Sebastian'\)/.test(sql));
// Escaping: a value containing an apostrophe is doubled, never emitted raw.
{
  const tricky: Cache = { ...cache, team: { ...cache.team, gc_team_id: "t-esc", name: "O'Brien Stars" } };
  const escSql = buildMigrationSql([tricky], autoResolve(tricky.roster, baseReg).registry);
  check("apostrophe escaped as ''", escSql.includes("O''Brien Stars") && !/[^']'O'Brien/.test(escSql));
}

// ---- apply twice in a rolled-back txn; assert idempotent counts ----
console.log("apply x2 in rolled-back txn (idempotency / AE1)");
const countsSql = `
SELECT
  (SELECT count(*) FROM baseball_people WHERE slug IN ('sebastian','marc-hauser','carter-dela-cruz')) AS people,
  (SELECT count(*) FROM baseball_teams WHERE gc_team_id='t-test-1') AS teams,
  (SELECT count(*) FROM baseball_team_players tp JOIN baseball_teams t ON tp.team_id=t.id WHERE t.gc_team_id='t-test-1') AS players,
  (SELECT count(*) FROM baseball_team_players tp JOIN baseball_teams t ON tp.team_id=t.id WHERE t.gc_team_id='t-test-1' AND tp.person_id IS NOT NULL) AS linked,
  (SELECT count(*) FROM baseball_games g JOIN baseball_teams t ON g.team_id=t.id WHERE t.gc_team_id='t-test-1') AS games,
  (SELECT count(*) FROM baseball_game_player_stats s JOIN baseball_games g ON s.game_id=g.id JOIN baseball_teams t ON g.team_id=t.id WHERE t.gc_team_id='t-test-1') AS gstats,
  (SELECT count(*) FROM baseball_season_player_stats s JOIN baseball_teams t ON s.team_id=t.id WHERE t.gc_team_id='t-test-1') AS sstats,
  (SELECT count(*) FROM baseball_game_events e JOIN baseball_games g ON e.game_id=g.id JOIN baseball_teams t ON g.team_id=t.id WHERE t.gc_team_id='t-test-1') AS events;
`;
const script = `BEGIN;\n${sql}\n${sql}\n\\echo COUNTS_BEGIN\n${countsSql}\n\\echo COUNTS_END\nROLLBACK;\n`;

let out = "";
try {
  out = execFileSync(
    "psql",
    ["-h", "127.0.0.1", "-p", "54522", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-A", "-F", "\t", "-t", "-q"],
    { input: script, env: { ...process.env, PGPASSWORD: "postgres" }, encoding: "utf8" },
  );
} catch (e) {
  failures++;
  console.log(`  ✗ psql apply failed — ${(e as { stderr?: string }).stderr ?? (e as Error).message}`);
}
if (out) {
  const line = out.split("\n").map((l) => l.trim()).filter((l) => l.includes("\t")).pop() ?? "";
  const [people, teams, players, linked, games, gstats, sstats, events] = line.split("\t").map((n) => parseInt(n, 10));
  check("people = 3 after two applies", people === 3, people);
  check("teams = 1 (not 2)", teams === 1, teams);
  check("players = 3", players === 3, players);
  check("all players person-linked", linked === 3, linked);
  check("games = 2", games === 2, games);
  check("game player stats = 3", gstats === 3, gstats);
  check("season stats = 3", sstats === 3, sstats);
  check("game events = 0 (events excluded by default)", events === 0, events);
}

console.log("");
if (failures > 0) { console.error(`FAILED: ${failures} check(s)`); process.exit(1); }
console.log("All baseball generate checks passed.");
