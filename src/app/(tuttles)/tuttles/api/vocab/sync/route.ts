import { NextResponse } from "next/server";
import { jsonBody, NO_STORE, vocabCaller } from "@/lib/tuttles/vocab";
import { applyOffline, loadPack, type OfflineAnswer, type OfflineSession } from "@/lib/words/offline";
import type { Result } from "@/lib/words/types";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RESULTS = ["correct", "wrong", "dontknow"];

const text = (v: unknown, max = 200): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const whole = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const when = (v: unknown): v is string => text(v, 40) && Number.isFinite(Date.parse(v));

function session(v: unknown): OfflineSession | null {
  const s = v as Record<string, unknown> | null;
  if (!s || typeof s !== "object") return null;
  if (!text(s.id) || !UUID.test(s.id) || !text(s.day) || !DAY.test(s.day)) return null;
  if (!whole(s.total, 1, 60) || !whole(s.limitMs, 1, 3_600_000) || !when(s.startedAt)) return null;
  if (s.finishedAt != null && !when(s.finishedAt)) return null;
  return {
    id: s.id.toLowerCase(),
    day: s.day,
    total: s.total,
    limitMs: s.limitMs,
    noDontKnow: s.noDontKnow === true,
    startedAt: s.startedAt,
    finishedAt: (s.finishedAt as string | null | undefined) ?? null,
    boss: whole(s.boss, 1, 100) ? s.boss : null,
  };
}

function answer(v: unknown): OfflineAnswer | null {
  const a = v as Record<string, unknown> | null;
  if (!a || typeof a !== "object") return null;
  if (!text(a.session) || !UUID.test(a.session) || !whole(a.position, 1, 60)) return null;
  if (!text(a.item) || !text(a.form) || !when(a.at)) return null;
  if (a.chosen != null && !text(a.chosen, 500)) return null;
  if (!RESULTS.includes(a.result as string)) return null;
  return {
    session: a.session.toLowerCase(),
    position: a.position,
    item: a.item,
    form: a.form,
    chosen: (a.chosen as string | null | undefined) ?? null,
    result: a.result as Result,
    ms: typeof a.ms === "number" && Number.isFinite(a.ms) ? a.ms : 0,
    at: a.at,
  };
}

/**
 * Vocab played on the phone, with or without a connection: the phone hands
 * over what's been answered since it last got through, and takes back
 * everything it needs to carry on by itself (src/lib/words/offline.ts).
 *
 *   POST { content, sessions, answers }
 *     content    the version of the words the phone holds, or null
 *     sessions   [{ id, day, total, limitMs, noDontKnow, startedAt, finishedAt, boss }]
 *     answers    [{ session, position, item, form, chosen, result, ms, at }]
 *   → Pack: the words (when the phone's aren't these), the schedule's numbers,
 *     the kid's progress and their sessions.
 *
 * Sending the same answers again is harmless, so the phone keeps them until
 * this comes back.
 */
export async function POST(request: Request) {
  const caller = await vocabCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  if (caller.parentView || !caller.profile) return NextResponse.json({ error: "Vocab isn't set up for you yet." }, { status: 403 });
  const body = await jsonBody(request);
  if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  if (list(body.sessions).length > 500 || list(body.answers).length > 10_000) return NextResponse.json({ error: "too much at once" }, { status: 413 });
  // Anything malformed is dropped rather than holding up the rest.
  const sessions = list(body.sessions).flatMap((s) => session(s) ?? []);
  const answers = list(body.answers).flatMap((a) => answer(a) ?? []);

  await applyOffline(caller.profile, sessions, answers);
  const have = typeof body.content === "string" ? body.content : null;
  return NextResponse.json(await loadPack(caller.profile, caller.name, have), NO_STORE);
}
