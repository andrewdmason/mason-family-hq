import { NextResponse } from "next/server";
import { NO_STORE, vocabCaller } from "@/lib/tuttles/vocab";
import { wordsToday } from "@/lib/words/day";
import { daysBetween, TEST_DATE } from "@/lib/words/schedule";
import { loadOverview, loadStudents } from "@/lib/words/session";

export const runtime = "nodejs";

/**
 * Vocab's first screen in the Tuttles app.
 *
 *   GET   Authorization: Bearer …   (X-Tuttles-Kid: a parent's phone used as a kid)
 *
 * A kid, or a phone being used as one:
 *   → { view: "kid", name, daysLeft, overview }     (overview null: not set up)
 * A parent in the parents' view:
 *   → { view: "parent", daysLeft, kids: [{ id, name, overview }] }
 *
 * `overview` is the website's (loadOverview in src/lib/words/session.ts).
 */
export async function GET(request: Request) {
  const caller = await vocabCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  const daysLeft = daysBetween(wordsToday(), TEST_DATE);

  if (caller.parentView) {
    const students = (await loadStudents()).filter((s) => s.userId !== caller.userId);
    const kids = await Promise.all(
      students.map(async (s) => ({ id: s.userId, name: s.name, overview: await loadOverview(s.profile) })),
    );
    return NextResponse.json({ view: "parent", daysLeft, kids }, NO_STORE);
  }
  return NextResponse.json(
    { view: "kid", name: caller.name, daysLeft, overview: caller.profile ? await loadOverview(caller.profile) : null },
    NO_STORE,
  );
}
