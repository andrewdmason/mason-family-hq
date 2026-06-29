// Headless verification for the GameChanger parsers (U2).
// Run: npx tsx scripts/verify-baseball-parse.mts
//
// Pure — no DB, no network. Exercises parse.ts against the real captured sample
// payloads in scripts/baseball/fixtures/. Exits non-zero on the first failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseSeasonStats,
  parseGameSummaries,
  parseBoxScore,
  parseEvents,
  parseRoster,
  parseSchedule,
  linkBoxScoreToRoster,
  parseInnings,
} from "./baseball/parse";

const here = dirname(fileURLToPath(import.meta.url));
const fix = (n: string) => JSON.parse(readFileSync(join(here, "baseball/fixtures", n), "utf8"));

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}
function throws(name: string, fn: () => unknown) {
  try {
    fn();
    failures++;
    console.log(`  ✗ ${name} — expected throw`);
  } catch {
    console.log(`  ✓ ${name}`);
  }
}

// ---- season stats ----
console.log("parseSeasonStats");
const season = parseSeasonStats(fix("season-stats-sample.json"));
check("12 players", season.length === 12, season.length);
const p0 = season[0].stats as { offense: { AVG: number; H: number }; general: { GP: number } };
check("first player has offense.AVG", typeof p0.offense.AVG === "number", p0.offense.AVG);
check("first player gc_player_id present", /^[0-9a-f-]{36}$/.test(season[0].gc_player_id));

// ---- game summaries ----
console.log("parseGameSummaries");
const games = parseGameSummaries(fix("game-summaries-sample.json"));
check("15 games", games.length === 15, games.length);
const g0 = games[0];
check("game id carried", g0.gc_game_id === "08b0166c-17ae-4a9e-8894-36aa2aa8c806");
check("16-2 home win -> result W", g0.result === "W" && g0.team_score === 16 && g0.opponent_score === 2, g0);
check("stream id carried", g0.gc_stream_id === "b074c9cd-7976-4358-8421-22b1964ec022");

// ---- box score (AE4: fidelity to rendered numbers) ----
console.log("parseBoxScore (away = SFL9, real rendered values)");
const box = fix("box-score-sample.json");
const away = parseBoxScore(box, { side: "away" });
const parker = away.find((p) => p.jersey === "14");
check("Parker #14 batting matches rendered AB2 R0 H0 RBI1 BB1 SO0",
  !!parker && parker.batting!.AB === 2 && parker.batting!.R === 0 && parker.batting!.H === 0 &&
  parker.batting!.RBI === 1 && parker.batting!.BB === 1 && parker.batting!.SO === 0, parker?.batting);
const levi = away.find((p) => p.jersey === "42");
check("Levi #42 extras: 2B=1 (note), SB=2 (counted note)", !!levi && levi.batting!["2B"] === 1 && levi.batting!.SB === 2, levi?.batting);
check("Levi has no pitching -> null", !!levi && levi.pitching === null);
const gavinP = away.find((p) => p.jersey === "44");
check("Gavin #44 pitching IP 0.1 -> ~0.333, ER 4", !!gavinP && Math.abs(gavinP.pitching!.IP - 1 / 3) < 1e-9 && gavinP.pitching!.ER === 4, gavinP?.pitching);
const noName = away.find((p) => p.jersey === "32");
check("no-name #32 row kept (BB 2)", !!noName && noName.batting!.BB === 2, noName?.batting);
check("TEAM total row dropped", !away.some((p) => p.name.toLowerCase() === "team"));

console.log("parseBoxScore (our side = home selects NOLL, drops opponent)");
const home = parseBoxScore(box, { side: "home" });
check("home has Sebastian Mason", home.some((p) => p.jersey === "28"));
check("home does NOT include away players", !home.some((p) => p.jersey === "14"));
const seb = home.find((p) => p.jersey === "28")!;
check("Sebastian batting H2 + 2B extra", seb.batting!.H === 2 && seb.batting!["2B"] === 1, seb.batting);
check("Sebastian pitching IP2 SO3", seb.pitching!.IP === 2 && seb.pitching!.SO === 3, seb.pitching);

// select-by-name also works
check("select by team name", parseBoxScore(box, { name: "SFAL 9U All Stars" }).length === away.length);

// extras attribution survives first-name-only labels vs full-name notes
const fnBox = {
  gc_game_id: "g",
  teams: [{
    side: "home" as const,
    name: "Test",
    batting: [{ label: "Levi #42", values: ["3", "1", "1", "0", "0", "0"] }],
    pitching: [],
    notes: { "2B": "Levi Evans", HR: "Levi Evans 2" },
  }],
};
const fnLevi = parseBoxScore(fnBox, { side: "home" }).find((p) => p.jersey === "42");
check("first-name label gets extras from full-name note", !!fnLevi && fnLevi.batting!["2B"] === 1 && fnLevi.batting!.HR === 2, fnLevi?.batting);

// ---- roster + linking (AE: link box lines back to gc ids) ----
console.log("parseRoster + linkBoxScoreToRoster");
const roster = parseRoster(fix("roster-sample.json"));
check("10 roster players", roster.length === 10, roster.length);
check("jersey is string", roster[0].jersey === "14");
const { linked, unmatched } = linkBoxScoreToRoster(away, roster);
check("all away players linked (jersey match despite first-name-only labels)", unmatched.length === 0, unmatched.map((u) => u.name));
check("Parker links to gc-away-14 by jersey", linked.some((l) => l.gc_player_id === "gc-away-14" && l.batting!.AB === 2));
check("no-name #32 links to gc-away-32 by jersey", linked.some((l) => l.gc_player_id === "gc-away-32"));

// ---- events ----
console.log("parseEvents");
const ev = parseEvents(fix("game-events-sample.json"));
check("stream id present", typeof ev.gc_stream_id === "string" && ev.gc_stream_id.length > 0);
check("360 raw events archived", ev.events.length === 360, ev.events.length);

// ---- schedule (defensive) ----
console.log("parseSchedule");
const sched = parseSchedule([{ event_id: "g1", start: "2023-06-04T17:00:00Z", opponent_name: "Wildcats" }]);
check("schedule maps date + opponent", sched.get("g1")?.played_on === "2023-06-04" && sched.get("g1")?.opponent_name === "Wildcats", sched.get("g1"));

// ---- innings helper ----
console.log("parseInnings");
check("2.2 -> 2 + 2/3", Math.abs(parseInnings("2.2") - (2 + 2 / 3)) < 1e-9);
check("empty -> 0", parseInnings("") === 0);

// ---- error paths ----
console.log("error paths");
throws("parseSeasonStats({}) throws", () => parseSeasonStats({}));
throws("parseGameSummaries({}) throws", () => parseGameSummaries({} as unknown));
throws("parseBoxScore with no matching side throws", () => parseBoxScore(box, { side: undefined, name: "Nope" }));

console.log("");
if (failures > 0) {
  console.error(`FAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("All baseball parse checks passed.");
