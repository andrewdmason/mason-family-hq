import { NextResponse } from "next/server";
import { jsonBody, NO_STORE, vocabCaller, vocabPlayer } from "@/lib/tuttles/vocab";
import { loadList, loadStudents, setItemRemoved } from "@/lib/words/session";

export const runtime = "nodejs";

/**
 * Every word and word part with where someone stands on it.
 *
 *   GET          → { words, parts, canEdit }   a kid's own (or the kid a phone is used as)
 *   GET ?kid=…   → the same for one of the kids, read-only, from the parents' view
 *
 * Rows are the website's ListRow (src/lib/words/session.ts).
 */
export async function GET(request: Request) {
  const caller = await vocabCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });

  let profile = caller.parentView ? null : caller.profile;
  if (caller.parentView) {
    const kid = new URL(request.url).searchParams.get("kid")?.toLowerCase();
    profile = (await loadStudents()).find((s) => s.userId === kid)?.profile ?? null;
  }
  if (!profile) return NextResponse.json({ error: "Vocab isn't set up for them yet." }, { status: 404 });
  const [words, parts] = await Promise.all([loadList(profile, "words"), loadList(profile, "parts")]);
  return NextResponse.json({ words, parts, canEdit: !caller.parentView }, NO_STORE);
}

/**
 * Remove one of your own words (too easy), or bring a removed one back.
 *
 *   POST { item, removed } → { ok: true }
 */
export async function POST(request: Request) {
  const player = await vocabPlayer(request);
  if (player instanceof NextResponse) return player;
  const body = await jsonBody(request);
  const item = typeof body?.item === "string" ? body.item : "";
  if (!item || typeof body?.removed !== "boolean") return NextResponse.json({ error: "bad request" }, { status: 400 });
  await setItemRemoved(player.profile, item, body.removed);
  return NextResponse.json({ ok: true }, NO_STORE);
}
