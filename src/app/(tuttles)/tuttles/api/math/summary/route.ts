import { NextResponse } from "next/server";
import { loadMathSummary } from "@/lib/tuttles/math-db";
import { NO_STORE, vocabCaller } from "@/lib/tuttles/vocab";
import { loadStudents } from "@/lib/words/session";

export const runtime = "nodejs";

/**
 * Math for the parents in the Tuttles app: how each kid's days, topics and
 * runs have gone (summarize in src/lib/tuttles/math.ts).
 *
 *   GET   Authorization: Bearer …
 *   → { kids: [{ kid, name, level, today, days, streak, topics, misses, best, runs, answeredTotal, correctTotal }] }
 *
 * Parents only, in the parents' own view, as with Vocab's: a kid, or a phone
 * being used as one, is refused.
 */
export async function GET(request: Request) {
  const caller = await vocabCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  if (!caller.parentView) return NextResponse.json({ error: "parents only" }, { status: 403 });
  const students = (await loadStudents()).filter((s) => s.userId !== caller.userId);
  return NextResponse.json({ kids: await loadMathSummary(students) }, NO_STORE);
}
