import "server-only";

import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { allParts, findItem, wordsFor } from "@/lib/words/content";
import { WORDS_TZ, wordsToday } from "@/lib/words/day";
import { applyAnswer, QUESTION_MAX_MS, RULES, type Rules } from "@/lib/words/schedule";
import { loadProgress, loadSessions, loadSorted, SESSION_LIMIT_MS, type Admin, type Profile, type SessionRow } from "@/lib/words/session";
import { packItem, type PackContent } from "@/lib/words/pack";
import type { Form, Item, Level, Progress, Result } from "@/lib/words/types";

// Words with no connection. The Tuttles app keeps the words, the schedule's
// numbers and what the kid has done on the phone, and plays sessions there by
// the same rules (ios/Tuttles/Shared/VocabEngine.swift). When it can reach the
// website it sends the answers given since, which are gone through here one at
// a time exactly as if they'd been given on the website, and takes back where
// everything now stands. What's here is still what counts: the phone's own
// reckoning only lasts until the next time it's told.

// MARK: What the phone keeps

const CONTENT = new Map<Level, PackContent>();

/** A level's words and the word parts, made once per server. `version` changes when any of it does. */
export function packContent(level: Level): PackContent {
  const made = CONTENT.get(level);
  if (made) return made;
  const words = wordsFor(level).map(packItem);
  const parts = allParts().map(packItem);
  const version = createHash("sha1").update(JSON.stringify({ format: 1, words, parts })).digest("hex").slice(0, 16);
  const content = { version, level, words, parts };
  CONTENT.set(level, content);
  return content;
}

/** A session as the phone keeps it. `asked` and `missed` are only filled in while it's unfinished. */
export type PackSession = {
  id: string;
  day: string;
  total: number;
  answered: number;
  correct: number;
  wrong: number;
  dontknow: number;
  elapsedMs: number;
  limitMs: number;
  noDontKnow: boolean;
  newItems: number;
  masteredGained: number;
  startedAt: string;
  finishedAt: string | null;
  requeue: { item: string; at: number }[];
  /** The items asked so far, in order. */
  asked: string[];
  /** The ones missed, for the end screen. */
  missed: string[];
  /** The stage whose boss round this was; null for an ordinary session. */
  boss: number | null;
};

export type Pack = {
  /** Sent when the phone's words aren't these (`have` is another version, or nothing). */
  content?: PackContent;
  contentVersion: string;
  rules: Rules;
  /** The time zone a day is reckoned in. */
  tz: string;
  name: string;
  level: Level;
  /** Questions in a session, and its clock. */
  questions: number;
  limitMs: number;
  progress: Progress[];
  /** The newest first. */
  sessions: PackSession[];
  sort: { done: boolean; through: number };
};

const iso = (at: string) => new Date(at).toISOString();

/** Everything the phone needs to carry on by itself. */
export async function loadPack(profile: Profile, name: string, have: string | null): Promise<Pack> {
  const admin = createAdminClient();
  const [progress, sorted, sessions] = await Promise.all([
    loadProgress(profile.userId, profile.level, admin),
    loadSorted(admin, profile.userId),
    loadSessions(admin, profile),
  ]);
  // A session left unfinished can be picked up on the phone: what it's asked so far goes with it.
  const open = sessions.filter((s) => !s.finished_at).slice(0, 20);
  const answers = await sessionAnswers(admin, open.map((s) => s.id));
  const content = packContent(profile.level);
  return {
    ...(have === content.version ? {} : { content }),
    contentVersion: content.version,
    rules: RULES,
    tz: WORDS_TZ,
    name,
    level: profile.level,
    questions: profile.questions,
    limitMs: SESSION_LIMIT_MS,
    progress: [...progress.values()],
    sessions: sessions.map((s) => {
      const mine = answers.get(s.id) ?? [];
      return {
        id: s.id,
        day: s.day,
        total: s.total,
        answered: s.answered,
        correct: s.correct,
        wrong: s.wrong,
        dontknow: s.dontknow,
        elapsedMs: s.elapsed_ms,
        limitMs: s.limit_ms,
        noDontKnow: s.no_dont_know,
        newItems: s.new_items,
        masteredGained: s.mastered_gained,
        startedAt: iso(s.started_at),
        finishedAt: s.finished_at ? iso(s.finished_at) : null,
        requeue: s.finished_at ? [] : s.requeue,
        asked: mine.map((a) => a.item),
        missed: [...new Set(mine.filter((a) => a.result !== "correct").map((a) => a.item))],
        boss: s.boss ?? null,
      };
    }),
    sort: sorted,
  };
}

type AnswerRow = { session_id: string; item: string; position: number; result: Result; ms: number };

/** The answers given in some sessions, each session's in the order they were given. */
async function sessionAnswers(admin: Admin, ids: string[]): Promise<Map<string, AnswerRow[]>> {
  const out = new Map<string, AnswerRow[]>();
  // A session is 25 answers: a few sessions at a time stays inside one page.
  for (let i = 0; i < ids.length; i += 20) {
    const { data, error } = await admin
      .from("words_answers")
      .select("session_id, item, position, result, ms")
      .in("session_id", ids.slice(i, i + 20))
      .order("position");
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as AnswerRow[]) out.set(row.session_id, [...(out.get(row.session_id) ?? []), row]);
  }
  return out;
}

// MARK: What the phone sends

/** A session begun on the phone. Its id is the phone's, so sending it twice makes one. */
export type OfflineSession = {
  id: string;
  day: string;
  total: number;
  limitMs: number;
  noDontKnow: boolean;
  startedAt: string;
  finishedAt: string | null;
  /** The stage whose boss round this is. The phone sends a boss round only once it's over. */
  boss?: number | null;
};

/** An answer given on the phone: which question it was, what they picked in words (null: "Don't know"), and when. */
export type OfflineAnswer = {
  session: string;
  position: number;
  item: string;
  form: string;
  chosen: string | null;
  /** How the phone graded it, for when the words have changed since and the choice can't be found. */
  result: Result;
  ms: number;
  at: string;
};

/** What a pick comes to. The words here decide; the phone's grade stands in when the choice isn't among them any more. */
function grade(form: Form, answer: OfflineAnswer): { result: Result; trap: string | null } {
  if (answer.chosen === null) return { result: "dontknow", trap: null };
  if (answer.chosen === form.answer) return { result: "correct", trap: null };
  const trap = [...form.traps, ...(form.decoys ?? [])].find((t) => t.text === answer.chosen);
  if (trap) return { result: "wrong", trap: trap.trap ?? null };
  return { result: answer.result === "correct" ? "correct" : "wrong", trap: null };
}

/** The words still waiting to come round again in a session, from its answers in order. */
function requeueAfter(answers: { item: string; position: number; result: Result }[]): { item: string; at: number }[] {
  let waiting: { item: string; at: number }[] = [];
  const asked = new Set<string>();
  for (const a of answers) {
    waiting = waiting.filter((r) => r.item !== a.item);
    // A miss comes round once more; a miss on that second go waits for tomorrow.
    if (a.result !== "correct" && !asked.has(a.item)) waiting.push({ item: a.item, at: a.position });
    asked.add(a.item);
  }
  return waiting;
}

/**
 * Take in what was done on the phone. Each answer is gone through as it would
 * have been on the website, in the order they were given, on the day its
 * session was started. One that's here already (sent before, or the same
 * question answered on the website meanwhile) is left as it is, so the phone
 * can send the same things again until it hears they arrived.
 */
export async function applyOffline(profile: Profile, sessionsIn: OfflineSession[], answersIn: OfflineAnswer[]): Promise<void> {
  if (sessionsIn.length === 0) return;
  const admin = createAdminClient();
  const today = wordsToday();
  const now = Date.now();
  // The phone's clock, held to ours: nothing happened later than now.
  const stamp = (at: string | null) => {
    const t = at ? Date.parse(at) : NaN;
    return new Date(Number.isFinite(t) ? Math.min(t, now) : now).toISOString();
  };

  // The sessions these belong to: the ones here already, and the ones begun on the phone.
  const ids = [...new Set(sessionsIn.map((s) => s.id))];
  const sessions = new Map<string, SessionRow>();
  const taken = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin.from("words_sessions").select("*").in("id", ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as SessionRow[]) {
      // Someone else's, or from before a change of level: not this person's to add to.
      if (row.user_id === profile.userId && row.level === profile.level) sessions.set(row.id, row);
      else taken.add(row.id);
    }
  }
  const sent = new Map(sessionsIn.map((s) => [s.id, s]));
  const begun = sessionsIn.filter((s) => !sessions.has(s.id) && !taken.has(s.id) && answersIn.some((a) => a.session === s.id));
  if (begun.length > 0) {
    const { data, error } = await admin
      .from("words_sessions")
      .insert(
        begun.map((s) => ({
          id: s.id,
          user_id: profile.userId,
          level: profile.level,
          // A phone with its clock ahead doesn't get to practise tomorrow.
          day: s.day > today ? today : s.day,
          total: s.total,
          limit_ms: s.limitMs,
          no_dont_know: s.noDontKnow,
          started_at: stamp(s.startedAt),
          // Only named when there is one, so an ordinary session doesn't depend on the column.
          ...(s.boss ? { boss: s.boss } : {}),
        })),
      )
      .select("*");
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as SessionRow[]) sessions.set(row.id, row);
  }
  if (sessions.size === 0) return;

  // What's new: an answer to a question of a session that hasn't one yet.
  const had = await sessionAnswers(admin, [...sessions.keys()]);
  const filled = new Set<string>();
  for (const [id, rows] of had) for (const r of rows) filled.add(`${id}:${r.position}`);
  const fresh: { answer: OfflineAnswer; session: SessionRow; item: Item; result: Result; trap: string | null; ms: number; at: string }[] = [];
  const inOrder = answersIn
    .map((a) => ({ a, at: stamp(a.at) }))
    .sort((x, y) => x.at.localeCompare(y.at) || x.a.position - y.a.position);
  for (const { a, at } of inOrder) {
    const session = sessions.get(a.session);
    const item = session ? findItem(session.level, a.item) : undefined;
    const form = item?.forms[a.form];
    const key = `${a.session}:${a.position}`;
    if (!session || !item || !form || filled.has(key)) continue;
    filled.add(key);
    const ms = Math.max(0, Math.min(Math.round(a.ms) || 0, QUESTION_MAX_MS));
    fresh.push({ answer: a, session, item, ...grade(form, a), ms, at });
  }

  // The answers go in first, as on the website: one that's there is never counted twice.
  let landed = fresh;
  if (fresh.length > 0) {
    const kept = new Set<string>();
    for (let i = 0; i < fresh.length; i += 500) {
      const { data, error } = await admin
        .from("words_answers")
        .upsert(
          fresh.slice(i, i + 500).map((f) => ({
            session_id: f.session.id,
            user_id: profile.userId,
            level: f.session.level,
            item: f.item.id,
            form: f.answer.form,
            position: f.answer.position,
            result: f.result,
            chosen: f.answer.chosen,
            trap: f.trap,
            ms: f.ms,
            created_at: f.at,
          })),
          { onConflict: "session_id,position", ignoreDuplicates: true },
        )
        .select("session_id, position");
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as { session_id: string; position: number }[]) kept.add(`${row.session_id}:${row.position}`);
    }
    // Beaten to it between the look and the write (the same question answered on the website just then).
    landed = fresh.filter((f) => kept.has(`${f.session.id}:${f.answer.position}`));
  }

  // Their progress, an answer at a time.
  const progress = landed.length > 0 ? await loadProgress(profile.userId, profile.level, admin) : new Map<string, Progress>();
  const changed = new Map<string, Progress>();
  const gained = new Map<string, { newItems: number; mastered: number }>();
  for (const f of landed) {
    const before = progress.get(f.item.id) ?? null;
    const after = applyAnswer(before, f.item.id, f.answer.form, f.result, f.session.day, f.at);
    progress.set(f.item.id, after);
    changed.set(f.item.id, after);
    const g = gained.get(f.session.id) ?? { newItems: 0, mastered: 0 };
    g.newItems += before ? 0 : 1;
    // A word known at first sight is done with, but it wasn't learned here: nothing to count.
    g.mastered += before && after.stage >= 3 && before.stage < 3 ? 1 : 0;
    gained.set(f.session.id, g);
    had.set(f.session.id, [
      ...(had.get(f.session.id) ?? []),
      { session_id: f.session.id, item: f.item.id, position: f.answer.position, result: f.result, ms: f.ms },
    ]);
  }
  const rows = [...changed.values()].map((p) => ({ user_id: profile.userId, level: profile.level, ...p, updated_at: new Date(now).toISOString() }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("words_progress").upsert(rows.slice(i, i + 500), { onConflict: "user_id,level,item" });
    if (error) throw new Error(error.message);
  }

  // Each session's score is counted again from its answers, so it's right however many times this runs.
  await Promise.all(
    [...sessions.values()].map(async (session) => {
      const answers = (had.get(session.id) ?? []).slice().sort((a, b) => a.position - b.position);
      const g = gained.get(session.id);
      const from = sent.get(session.id);
      const answered = answers.reduce((n, a) => Math.max(n, a.position), 0);
      const finished = session.finished_at ?? (from?.finishedAt ? stamp(from.finishedAt) : answered >= session.total ? stamp(null) : null);
      if (!g && finished === session.finished_at) return;
      const count = (r: Result) => answers.filter((a) => a.result === r).length;
      const { error } = await admin
        .from("words_sessions")
        .update({
          answered,
          correct: count("correct"),
          wrong: count("wrong"),
          dontknow: count("dontknow"),
          // (Time on the website can be more than its answers': a word taken out mid-question.)
          elapsed_ms: Math.max(session.elapsed_ms, answers.reduce((n, a) => n + a.ms, 0)),
          requeue: finished ? [] : requeueAfter(answers),
          new_items: session.new_items + (g?.newItems ?? 0),
          mastered_gained: session.mastered_gained + (g?.mastered ?? 0),
          // Whatever question the website had lined up is behind the times now.
          current: null,
          finished_at: finished,
        })
        .eq("id", session.id);
      if (error) throw new Error(error.message);
    }),
  );
}
