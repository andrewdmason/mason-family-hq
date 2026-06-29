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
import { autoResolve, type Registry } from "./identity";
import type { Cache } from "./sql";

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, ".cache");
const profileDir = join(cacheDir, ".chrome-profile");
const peopleFile = join(here, "people.json");
const API = "https://api.team-manager.gc.com";
const WEB = "https://web.gc.com";

function loadRegistry(): Registry {
  const raw = JSON.parse(readFileSync(peopleFile, "utf8"));
  return { people: raw.people, aliases: raw.aliases };
}
function saveRegistry(reg: Registry) {
  const raw = JSON.parse(readFileSync(peopleFile, "utf8"));
  raw.people = reg.people;
  raw.aliases = reg.aliases;
  writeFileSync(peopleFile, JSON.stringify(raw, null, 2) + "\n");
}

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

async function listTeams(req: APIRequestContext): Promise<MeTeam[]> {
  const teams = await apiGet<MeTeam[] | { teams: MeTeam[] }>(req, "/me/teams?include=user_team_associations,team_public_profile_id");
  return Array.isArray(teams) ? teams : teams.teams;
}

async function pickTeam(req: APIRequestContext, filter: string | undefined) {
  const list = await listTeams(req);
  if (!filter) {
    log("Teams on this account (re-run with --team <name or public id>, or --all):");
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

// Scrape the rendered box-score page into the BoxScoreCapture shape. The page is
// an AG-Grid: each side has BoxScore__{away,home}TeamName / {away,home}Lineup
// (batting) / {away,home}Pitching grids, with per-player .ag-row text like
// "Parker #14 (SS, P) 2 0 0 1 1 0", plus a boxScoreExtraStats notes block.
async function scrapeBoxScore(page: Page, gcGameId: string): Promise<BoxScoreCapture> {
  return page.evaluate((gameId) => {
    const ROW = /^(.*?)((?:\d+\.\d|\d+)(?:\s+\d+){5})$/; // label + 6 stat cells
    const txt = (el: Element | null) => (el ? (el as HTMLElement).innerText.replace(/\s+/g, " ").trim() : "");

    const rowsIn = (sel: string) => {
      const c = document.querySelector(sel);
      const out: { label: string; values: string[] }[] = [];
      if (!c) return out;
      const seen = new Set<string>();
      for (const r of Array.from(c.querySelectorAll(".ag-row"))) {
        const m = (r as HTMLElement).innerText.replace(/\s+/g, " ").trim().match(ROW);
        if (!m) continue;
        const label = m[1].trim();
        if (!label || seen.has(label)) continue;
        seen.add(label);
        out.push({ label, values: m[2].trim().split(/\s+/) });
      }
      return out;
    };

    // The notes block (2B/3B/HR/SB/TB/E/…) for a side; we only consume the
    // extra-base/steal keys downstream, but capture the line as rendered.
    const notesFor = (marker: string) => {
      const notes: Record<string, string> = {};
      for (const el of Array.from(document.querySelectorAll("[class*='boxScoreExtraStats']"))) {
        if (!(el.className || "").toString().includes(marker)) continue;
        for (const line of (el as HTMLElement).innerText.split("\n")) {
          const i = line.indexOf(":");
          if (i > 0) {
            const k = line.slice(0, i).trim();
            const v = line.slice(i + 1).trim();
            if (v) notes[k] = v;
          }
        }
      }
      return notes;
    };

    const teams: { side: "home" | "away"; name: string; batting: { label: string; values: string[] }[]; pitching: { label: string; values: string[] }[]; notes: Record<string, string> }[] = [];
    for (const side of ["away", "home"] as const) {
      const name = txt(document.querySelector(`[class*='${side}TeamName']`));
      const batting = rowsIn(`[class*='${side}Lineup']`);
      const pitching = rowsIn(`[class*='${side}Pitching']`);
      if (!name && !batting.length) continue;
      teams.push({ side, name, batting, pitching, notes: notesFor(side) });
    }
    return { gc_game_id: gameId, teams };
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
  // tsx/esbuild transpiles page.evaluate callbacks with a `__name` helper
  // (keepNames) that doesn't exist in the browser; shim it as a no-op. Passed as
  // a raw string so esbuild doesn't re-inject __name into the shim itself.
  await context.addInitScript({ content: "window.__name = window.__name || function (f) { return f; };" });
  const page = context.pages()[0] ?? (await context.newPage());
  captureHeaders(page);

  try {
    await waitForLogin(page);
    const req = context.request;
    const teams = filter === "all" || process.argv.includes("--all")
      ? await listTeams(req)
      : [await pickTeam(req, filter)];
    if (teams.length > 1) log(`Capturing ${teams.length} teams…`);

    let ok = 0;
    for (const team of teams) {
      try {
        await captureTeam(req, page, team);
        ok++;
      } catch (e) {
        log(`✗ ${team.name ?? team.id}: ${e instanceof Error ? e.message : e}`);
      }
    }
    log(`Done: ${ok}/${teams.length} captured. Review the people.json diff, then \`npm run baseball:generate\`.`);
  } finally {
    await context.close();
  }
}

async function captureTeam(req: APIRequestContext, page: Page, team: MeTeam) {
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
  log(`  roster ${roster.length} · games ${summaries.length} · season-stat players ${seasonStats.length}`);

  const games = summaries.map((g: GameSummary) => {
    const extra = schedule.get(g.gc_game_id);
    return { ...g, played_on: extra?.played_on ?? null, opponent_name: extra?.opponent_name ?? null };
  });

  const gameStats: Cache["gameStats"] = { ...(prior.gameStats ?? {}) };
  const completed = summaries.filter((g) => g.status === "completed");
  for (const g of completed) {
    if (gameStats[g.gc_game_id]?.linked?.length) continue; // resumable
    // The box-score route accepts the public id + any slug; GameChanger redirects.
    await page.goto(`${WEB}/teams/${publicId}/x/schedule/${g.gc_game_id}/box-score`, { waitUntil: "networkidle" }).catch(() => {});
    // Wait for the AG-Grid lineup to render (the stat engine computes client-side).
    await page.waitForSelector("[class*='Lineup'] .ag-row", { timeout: 20000 }).catch(() => {});
    const box = await scrapeBoxScore(page, g.gc_game_id);
    // Match our side by team name first (DOM block order isn't guaranteed),
    // falling back to the home/away flag.
    const ourPlayers = parseBoxScore(box, { name: team.name ?? undefined, side: g.home_away ?? undefined });
    const { linked, unmatched } = linkBoxScoreToRoster(ourPlayers, roster);
    if (unmatched.length) log(`  ⚠ game ${g.gc_game_id}: ${unmatched.length} box rows unmatched (${unmatched.map((u) => u.name || u.jersey).join(", ")})`);
    const eventsRaw = await apiGet<unknown>(req, `/game-streams/gamestream-viewer-payload-lite/${g.gc_game_id}?include_stat_edits=true`);
    gameStats[g.gc_game_id] = { linked, events: parseEvents(eventsRaw) };
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

  // Resolve identities into the committed registry: the boys auto-link at
  // full-name confidence (and are never cross-merged); previously-unseen
  // teammates are registered as new people, accumulating across teams. Manual
  // edits to people.json are preserved. Review the diff before generating.
  const { registry, autoLinked, created } = autoResolve(roster, loadRegistry());
  saveRegistry(registry);
  log(`  ${Object.keys(gameStats).length} games · identities: ${autoLinked.length} linked, ${created.length} new`);
}

main().catch((e) => {
  console.error(`[capture] ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
