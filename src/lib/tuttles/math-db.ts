import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  board,
  dayIn,
  firstName,
  stateForPhone,
  STARS_ECONOMY,
  summarize,
  topRuns,
  type Answered,
  type BoardEntry,
  type KidSummary,
  type KidTally,
  type MathState,
  type RunBests,
  type StarRun,
  type SyncInput,
  type TopRun,
} from "@/lib/tuttles/math";
import { WORDS_TZ, wordsToday } from "@/lib/words/day";
import { loadStudents, type Admin, type Profile } from "@/lib/words/session";
import type { Level } from "@/lib/words/types";

// Math in the Tuttles app, kept: taking in what the phone sends and reading
// back what it and the parents are shown. What's allowed in and what the
// numbers mean is src/lib/tuttles/math.ts; the tables are
// supabase/migrations/00228_tuttles_math.sql.
//
// A kid's test (Lower or Middle) and the time zone a day is reckoned in are
// Words' own (src/lib/words): there's one of each for the family.

/** What sync answers with. */
export type MathSync = {
  name: string;
  level: Level;
  /** The time zone a day is reckoned in. */
  tz: string;
  /** The state kept here, only when it's newer than the phone's. */
  state: MathState | null;
  today: { day: string; answered: number };
  board: BoardEntry[];
  /** The stars top 10s: the kids' runs, and the one asking's own. */
  top: { today: TopRun[]; all: TopRun[] };
  /** How much of what was sent was malformed and left out. The rest was taken. */
  dropped: { runs: number; answers: number; state: boolean };
};

/**
 * Take in what was done on the phone. A run or answer that's here already is
 * the same one sent again (the phone sends until it hears they arrived): the
 * answer is left as it is and the run is brought up to the copy just sent.
 * One whose id is someone else's here isn't this kid's to change, and is
 * passed over.
 */
export async function applyMath(profile: Profile, input: SyncInput): Promise<void> {
  const admin = createAdminClient();
  const now = Date.now();
  // The phone's clock, held to ours: nothing happened later than now.
  const stamp = (at: string) => new Date(Math.min(Date.parse(at), now)).toISOString();
  const dayOf = dayIn(WORDS_TZ);

  if (input.runs.length > 0) {
    const ids = input.runs.map((r) => r.id);
    const taken = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await admin.from("tuttles_math_runs").select("id, user_id").in("id", ids.slice(i, i + 100));
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as { id: string; user_id: string }[]) if (row.user_id !== profile.userId) taken.add(row.id);
    }
    const rows = input.runs
      .filter((r) => !taken.has(r.id))
      .map((r) => ({
        id: r.id,
        user_id: profile.userId,
        level: profile.level,
        started_at: stamp(r.startedAt),
        ended_at: stamp(r.endedAt),
        score: r.score,
        distance: r.distance,
        waves: r.waves,
        depth: r.depth,
        stars: r.stars,
        answered: r.answered,
        correct: r.correct,
        best_streak: r.bestStreak,
        economy: r.economy,
        updated_at: new Date(now).toISOString(),
      }));
    if (rows.length > 0) {
      const { error } = await admin.from("tuttles_math_runs").upsert(rows, { onConflict: "id" });
      if (error) throw new Error(error.message);
    }
  }

  for (let i = 0; i < input.answers.length; i += 500) {
    const rows = input.answers.slice(i, i + 500).map((a) => {
      const at = stamp(a.at);
      return {
        id: a.id,
        user_id: profile.userId,
        run_id: a.run,
        level: profile.level,
        question: a.question,
        topic: a.topic,
        section: a.section,
        difficulty: a.difficulty,
        chosen: a.chosen,
        correct: a.correct,
        ms: a.ms,
        answered_at: at,
        day: dayOf(at),
      };
    });
    // One that's there is never counted twice, whoever's it is.
    const { error } = await admin.from("tuttles_math_answers").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }

  if (input.state) await keepState(admin, profile.userId, input.state);
}

async function loadState(admin: Admin, userId: string): Promise<MathState | null> {
  const { data, error } = await admin.from("tuttles_math_state").select("rev, json").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { rev: data.rev as number, json: data.json as Record<string, unknown> } : null;
}

/** Keep the phone's state if it's newer than what's here. The check is the write's own, so two phones at once can't put an older one on top. */
async function keepState(admin: Admin, userId: string, state: MathState): Promise<void> {
  const row = { user_id: userId, rev: state.rev, json: state.json, updated_at: new Date().toISOString() };
  // The first there's ever been goes in; if there's one already this does nothing…
  const first = await admin.from("tuttles_math_state").upsert(row, { onConflict: "user_id", ignoreDuplicates: true });
  if (first.error) throw new Error(first.error.message);
  // …and this replaces it, only if it's older.
  const newer = await admin.from("tuttles_math_state").update(row).eq("user_id", userId).lt("rev", state.rev);
  if (newer.error) throw new Error(newer.error.message);
}

/** How many of a kid's answers there are: all of them, the right ones, or one day's. */
async function countAnswers(admin: Admin, userId: string, only: { correct?: true; day?: string } = {}): Promise<number> {
  let query = admin.from("tuttles_math_answers").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (only.correct) query = query.eq("correct", true);
  if (only.day) query = query.eq("day", only.day);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

type RunRow = { stars: number; economy: number; waves: number; depth: number; best_streak: number };

export async function loadRuns(admin: Admin, userId: string): Promise<RunBests[]> {
  const out: RunBests[] = [];
  // A page is a thousand rows, and a keen week is a lot of runs.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("tuttles_math_runs")
      .select("stars, economy, waves, depth, best_streak")
      .eq("user_id", userId)
      .order("started_at")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as RunRow[]) {
      out.push({ stars: r.stars, economy: r.economy, waves: r.waves, depth: r.depth, bestStreak: r.best_streak });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * The runs the stars top 10s can be made from: the best ten of all time of
 * those people's, and every one of theirs that ended in the last two days
 * (today, in any time zone, is in there).
 */
async function loadStarRuns(admin: Admin, userIds: string[]): Promise<StarRun[]> {
  if (userIds.length === 0) return [];
  const base = () =>
    admin.from("tuttles_math_runs").select("id, user_id, stars, ended_at").in("user_id", userIds).gte("economy", STARS_ECONOMY);
  const since = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const [best, recent] = await Promise.all([
    base().order("stars", { ascending: false }).order("ended_at").limit(10),
    base().gte("ended_at", since).order("stars", { ascending: false }).limit(500),
  ]);
  if (best.error) throw new Error(best.error.message);
  if (recent.error) throw new Error(recent.error.message);
  const out = new Map<string, StarRun>();
  for (const r of [...(best.data ?? []), ...(recent.data ?? [])] as { id: string; user_id: string; stars: number; ended_at: string }[]) {
    out.set(r.id, { id: r.id, userId: r.user_id, stars: r.stars, endedAt: r.ended_at });
  }
  return [...out.values()];
}

type AnswerRow = { question: string; topic: string; section: "qr" | "ma"; chosen: number | null; correct: boolean; ms: number; answered_at: string };

export async function loadAnswers(admin: Admin, userId: string): Promise<Answered[]> {
  const out: Answered[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("tuttles_math_answers")
      .select("question, topic, section, chosen, correct, ms, answered_at")
      .eq("user_id", userId)
      .order("answered_at")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const a of (data ?? []) as AnswerRow[]) {
      out.push({ question: a.question, topic: a.topic, section: a.section, chosen: a.chosen, correct: a.correct, ms: a.ms, at: a.answered_at });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * What the phone is told after a sync: the kid's name and test, today's count
 * and the board. `input` is what it just sent: the rev of its state decides
 * whether the one kept here goes back, and what was dropped is said.
 *
 * The counts are asked of the database rather than added up here: this runs
 * every time the phone gets through, and a kid's answers soon run to
 * thousands.
 */
export async function loadMathSync(profile: Profile, name: string, input: Pick<SyncInput, "phoneRev" | "dropped">): Promise<MathSync> {
  const admin = createAdminClient();
  const today = wordsToday();
  const [stored, kids] = await Promise.all([loadState(admin, profile.userId), loadStudents()]);
  const tallies = new Map<string, KidTally>();
  await Promise.all(
    kids.map(async (k) => {
      const [runs, answeredToday, answeredTotal, correctTotal] = await Promise.all([
        loadRuns(admin, k.userId),
        countAnswers(admin, k.userId, { day: today }),
        countAnswers(admin, k.userId),
        countAnswers(admin, k.userId, { correct: true }),
      ]);
      tallies.set(k.userId, { runs, answeredToday, answeredTotal, correctTotal });
    }),
  );
  // (Someone playing who isn't one of the kids on the board still gets their own day.)
  const mine = tallies.get(profile.userId)?.answeredToday ?? (await countAnswers(admin, profile.userId, { day: today }));
  // The top 10 is the kids', and a parent playing as themselves sees their own on it too.
  const names = new Map(kids.map((k) => [k.userId, k.name] as [string, string]));
  if (!names.has(profile.userId)) names.set(profile.userId, name);
  const starRuns = await loadStarRuns(admin, [...names.keys()]);
  return {
    name: firstName(name),
    level: profile.level,
    tz: WORDS_TZ,
    state: stateForPhone(stored, input.phoneRev),
    today: { day: today, answered: mine },
    board: board(
      kids.map((k) => ({ kid: k.userId, name: k.name })),
      profile.userId,
      tallies,
    ),
    top: topRuns(starRuns, names, profile.userId, today, WORDS_TZ),
    dropped: input.dropped,
  };
}

/** The parents' look at some kids: each one's days, topics, misses and bests, from everything they've done. */
export async function loadMathSummary(kids: { userId: string; name: string; profile: Profile }[]): Promise<KidSummary[]> {
  const admin = createAdminClient();
  const today = wordsToday();
  return Promise.all(
    kids.map(async (k) => {
      const [answers, runs] = await Promise.all([loadAnswers(admin, k.userId), loadRuns(admin, k.userId)]);
      return summarize({ kid: k.userId, name: k.name, level: k.profile.level, today, tz: WORDS_TZ, answers, runs });
    }),
  );
}
