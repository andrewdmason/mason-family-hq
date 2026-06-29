// GameChanger capture (U4). Run: npm run baseball:capture -- --team <name-or-public-id>
//
// Interactive + local-only. Launches a real Chromium with a persistent profile so
// the GameChanger login sticks across runs. For the target team-season it pulls
// roster, schedule, game-summaries, and season-stats from the REST API (replaying
// the gc-token the web app uses), and for each completed game it scrapes the
// rendered box score (reusing GameChanger's own stat engine — we never recompute)
// plus the raw play-by-play event log. Output: scripts/baseball/.cache/<gc_team_id>.json
// in the shape scripts/baseball/sql.ts consumes.
//
// Resumable: re-running skips games already captured in the cache file. The DOM
// box-score selectors are the one piece that may need a small tweak on first live
// run (GameChanger markup can shift); the script logs what it scraped per game so
// mismatches are obvious. See docs/baseball-import-runbook.md.

import { chromium, type BrowserContext, type Page, type APIRequestContext } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  parseRoster,
  parseSchedule,
  parseGameSummaries,
  parseSeasonStats,
  parseBoxScore,
  parseEvents,
  linkBoxScoreToRoster,
  type BoxScoreCapture,
  type GameSummary,
} from "./parse";
import type { Cache } from "./sql";

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, ".cache");
const profileDir = join(cacheDir, ".chrome-profile");
const API = "https://api.team-manager.gc.com";
const WEB = "https://web.gc.com";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const log = (...a: unknown[]) => console.log("[capture]", ...a);

// Headers the web app sends to the API; we replay the ones the request listener
// observes (gc-token rotates ~hourly — a fresh login refreshes it).
let apiHeaders: Record<string, string> = {};
function captureHeaders(page: Page) {
  page.on("request", (req) => {
    if (!req.url().startsWith(API)) return;
    const h = req.headers();
    if (h["gc-token"]) {
      apiHeaders = {
        "gc-token": h["gc-token"],
        "gc-app-name": h["gc-app-name"] ?? "web",
        ...(h["gc-device-id"] ? { "gc-device-id": h["gc-device-id"] } : {}),
        ...(h["x-aws-waf-token"] ? { "x-aws-waf-token": h["x-aws-waf-token"] } : {}),
        accept: "application/json",
      };
    }
  });
}

async function waitForLogin(page: Page) {
  await page.goto(`${WEB}/teams`, { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (page.url().includes("/teams") && Object.keys(apiHeaders).length) return;
    if (page.url().includes("/login")) log("Please log in to GameChanger in the opened browser window…");
    await page.waitForTimeout(2000);
    if (page.url().includes("/teams") && !Object.keys(apiHeaders).length) {
      // On /teams but no API call seen yet — nudge a reload to trigger one.
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
    }
  }
  throw new Error("Timed out waiting for GameChanger login.");
}

async function apiGet<T>(req: APIRequestContext, path: string): Promise<T> {
  const res = await req.get(`${API}${path}`, { headers: apiHeaders });
  if (!res.ok()) throw new Error(`GET ${path} -> ${res.status()} (token may have expired; re-run after logging in again)`);
  return (await res.json()) as T;
}

type MeTeam = { id: string; name?: string; public_team_profile_id?: string; season?: string; season_year?: number };

async function pickTeam(req: APIRequestContext, filter: string | undefined) {
  const teams = await apiGet<MeTeam[] | { teams: MeTeam[] }>(req, "/me/teams?include=user_team_associations,team_public_profile_id");
  const list = Array.isArray(teams) ? teams : teams.teams;
  if (!filter) {
    log("Teams on this account (re-run with --team <name or public id>):");
    for (const t of list) log(`  - ${t.name ?? "(unnamed)"}  [${t.public_team_profile_id ?? t.id}]`);
    process.exit(0);
  }
  const f = filter.toLowerCase();
  const match = list.find(
    (t) => t.public_team_profile_id === filter || t.id === filter || (t.name ?? "").toLowerCase().includes(f),
  );
  if (!match) throw new Error(`No team matched "${filter}". Run without --team to list teams.`);
  return match;
}

// Scrape the rendered box-score page into the BoxScoreCapture shape. Selector-light
// and tolerant: it locates each team block, then its batting rows (6 trailing ints)
// and pitching rows (IP + 5 ints), plus the per-team notes (2B/3B/HR/SB/…).
async function scrapeBoxScore(page: Page, gcGameId: string): Promise<BoxScoreCapture> {
  return page.evaluate((gameId) => {
    const ROW = /^(.*?)((?:\d+\.\d|\d+)(?:\s+\d+){5})$/; // label + 6 stat cells
    const text = (el: Element) => (el as HTMLElement).innerText.replace(/\s+/g, " ").trim();

    // Each team renders a heading then a LINEUP table and a PITCHING table.
    const blocks = Array.from(document.querySelectorAll("section, [class*='team'], [class*='Team']"));
    const teams: BoxScoreCapture["teams"] = [];
    const seenNames = new Set<string>();

    const rowsFrom = (root: Element, wantPitching: boolean) => {
      const out: { label: string; values: string[] }[] = [];
      for (const el of Array.from(root.querySelectorAll("tr, li, div"))) {
        const t = text(el);
        const m = t.match(ROW);
        if (!m || t.length > 90) continue;
        const label = m[1].trim();
        const values = m[2].trim().split(/\s+/);
        const looksPitch = /\d+\.\d/.test(values[0]); // IP has a decimal
        if (wantPitching !== looksPitch) continue;
        if (!out.some((r) => r.label === label)) out.push({ label, values });
      }
      return out;
    };

    for (const b of blocks) {
      const heading = b.querySelector("h1,h2,h3,[class*='name'],[class*='Name']");
      const name = heading ? text(heading) : "";
      if (!name || seenNames.has(name) || name.length > 60) continue;
      const batting = rowsFrom(b, false);
      const pitching = rowsFrom(b, true);
      if (!batting.length && !pitching.length) continue;
      seenNames.add(name);
      const notes: Record<string, string> = {};
      for (const key of ["2B", "3B", "HR", "SB", "TB"]) {
        const re = new RegExp(`${key}:\\s*([^\\n]+?)(?:\\s{2,}|$)`);
        const mm = (b as HTMLElement).innerText.match(re);
        if (mm) notes[key] = mm[1].trim();
      }
      teams.push({ side: teams.length === 0 ? "away" : "home", name, batting, pitching, notes });
    }
    return { gc_game_id: gameId, teams: teams.slice(0, 2) };
  }, gcGameId);
}

async function main() {
  mkdirSync(cacheDir, { recursive: true });
  const filter = arg("team");

  // Persistent context keeps the login across runs. If the cached browser
  // revision doesn't match, run `npx playwright install chromium` once.
  const context: BrowserContext = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  captureHeaders(page);

  try {
    await waitForLogin(page);
    const req = context.request;
    const team = await pickTeam(req, filter);
    const gcTeamId = team.id;
    const publicId = team.public_team_profile_id ?? gcTeamId;
    log(`Capturing "${team.name}" (${gcTeamId})`);

    const cacheFile = join(cacheDir, `${gcTeamId}.json`);
    const prior: Partial<Cache> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};

    const rosterRaw = await apiGet<unknown>(req, `/teams/${gcTeamId}/players`);
    const roster = parseRoster(rosterRaw);
    const scheduleRaw = await apiGet<unknown>(req, `/teams/${gcTeamId}/schedule?fetch_place_details=true`);
    const schedule = parseSchedule(scheduleRaw);
    const summariesRaw = await apiGet<unknown>(req, `/teams/${gcTeamId}/game-summaries`);
    const summaries = parseGameSummaries(summariesRaw);
    const seasonRaw = await apiGet<unknown>(req, `/teams/${gcTeamId}/season-stats`);
    const seasonStats = parseSeasonStats(seasonRaw);
    log(`roster ${roster.length} · games ${summaries.length} · season-stat players ${seasonStats.length}`);

    const games = summaries.map((g: GameSummary) => {
      const extra = schedule.get(g.gc_game_id);
      return { ...g, played_on: extra?.played_on ?? null, opponent_name: extra?.opponent_name ?? null };
    });

    const gameStats: Cache["gameStats"] = { ...(prior.gameStats ?? {}) };
    const completed = summaries.filter((g) => g.status === "completed");
    for (const g of completed) {
      if (gameStats[g.gc_game_id]?.linked?.length) {
        log(`  game ${g.gc_game_id} already captured — skipping`);
        continue;
      }
      // Find the team-season slug from a team page URL is unnecessary: the box-score
      // route accepts the public id + any slug; GameChanger redirects to canonical.
      await page.goto(`${WEB}/teams/${publicId}/x/schedule/${g.gc_game_id}/box-score`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500); // let the stat engine compute
      const box = await scrapeBoxScore(page, g.gc_game_id);
      // Match our side by team name first (DOM block order isn't guaranteed),
      // falling back to the home/away flag.
      const ourPlayers = parseBoxScore(box, { name: team.name ?? undefined, side: g.home_away ?? undefined });
      const { linked, unmatched } = linkBoxScoreToRoster(ourPlayers, roster);
      if (unmatched.length) log(`  ⚠ game ${g.gc_game_id}: ${unmatched.length} box rows unmatched to roster (${unmatched.map((u) => u.name || u.jersey).join(", ")})`);
      const eventsRaw = await apiGet<unknown>(req, `/game-streams/gamestream-viewer-payload-lite/${g.gc_game_id}?include_stat_edits=true`);
      gameStats[g.gc_game_id] = { linked, events: parseEvents(eventsRaw) };
      log(`  game ${g.gc_game_id}: ${linked.length} player lines`);
    }

    const out: Cache = {
      team: {
        gc_team_id: gcTeamId,
        gc_public_id: publicId,
        name: team.name ?? "Unknown Team",
        season_name: team.season ?? null,
        season_year: team.season_year ?? null,
        level: null,
        org_name: null,
      },
      roster,
      games,
      seasonStats,
      gameStats,
    };
    writeFileSync(cacheFile, JSON.stringify(out, null, 2));
    log(`Wrote ${cacheFile}`);
    log("Next: confirm identities, then `npm run baseball:generate`.");
  } finally {
    await context.close();
  }
}

main().catch((e) => {
  console.error(`[capture] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
