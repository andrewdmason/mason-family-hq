import { NextResponse } from "next/server";
import { parseSync } from "@/lib/tuttles/math";
import { applyMath, loadMathSync } from "@/lib/tuttles/math-db";
import { jsonBody, NO_STORE, vocabCaller } from "@/lib/tuttles/vocab";

export const runtime = "nodejs";

/**
 * Math played on the phone, with or without a connection: the phone hands
 * over the runs and answers since it last got through, and takes back the
 * day's count and the board (src/lib/tuttles/math.ts).
 *
 *   POST   Authorization: Bearer …   (X-Tuttles-Kid: a parent's phone used as a kid)
 *     { runs, answers, state }
 *     runs      [{ id, startedAt, endedAt, score, distance, waves, depth, stars, answered, correct, bestStreak }]
 *     answers   [{ id, run, question, topic, section, difficulty, chosen, correct, ms, at }]
 *     state     { rev, json } or null: the phone's own, kept here only if it's the newest
 *   → { name, level, tz, state, today: { day, answered }, board: [...], dropped: { runs, answers, state } }
 *     state     what's kept here, only when it's newer than what was sent
 *     dropped   how many of the runs and answers were malformed and left out, and whether the state was
 *
 * The caller is whoever Vocab would be playing as: a kid, or the kid a
 * parent's phone is being used as. A parent in the parents' own view has no
 * game to send.
 *
 * Sending the same things again is harmless, so the phone keeps them until
 * this comes back. A malformed run or answer is dropped rather than holding
 * up the rest, as Vocab's are: refusing it would have the phone send it, and
 * everything behind it, for ever. Only a body that isn't an object (400) or
 * more than a call may carry (413) is refused.
 */
export async function POST(request: Request) {
  const caller = await vocabCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  if (caller.parentView || !caller.profile) return NextResponse.json({ error: "Math isn't set up for you yet." }, { status: 403 });
  const input = parseSync(await jsonBody(request));
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: input.status });

  await applyMath(caller.profile, input);
  return NextResponse.json(await loadMathSync(caller.profile, caller.name, input), NO_STORE);
}
