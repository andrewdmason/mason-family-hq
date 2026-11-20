import { NextResponse } from "next/server";
import { jsonBody, NO_STORE, vocabPlayer } from "@/lib/tuttles/vocab";
import { loadSortPage, saveSort } from "@/lib/words/session";

export const runtime = "nodejs";

/**
 * Sorting out the words a kid knows already, a page at a time, commonest first.
 *
 *   GET            → { page }   the next page from where they'd got to
 *   GET ?after=…   → { page }   the page after that place in the list (to have it ready)
 *
 * `page` is the website's SortPage (null when there's nothing left): each word
 * comes with a question and its answer, for the spot check the app gives on
 * the words they say they know.
 */
export async function GET(request: Request) {
  const player = await vocabPlayer(request);
  if (player instanceof NextResponse) return player;
  const after = Number(new URL(request.url).searchParams.get("after") ?? NaN);
  return NextResponse.json({ page: await loadSortPage(player.profile, Number.isFinite(after) ? after : null) }, NO_STORE);
}

/**
 * A page is done: skip the words they know and remember how far they've looked.
 *
 *   POST { through, skip: [item], done } → { ok: true }
 */
export async function POST(request: Request) {
  const player = await vocabPlayer(request);
  if (player instanceof NextResponse) return player;
  const body = await jsonBody(request);
  const through = typeof body?.through === "number" && Number.isFinite(body.through) ? body.through : null;
  const skip = Array.isArray(body?.skip) ? body.skip.filter((id): id is string => typeof id === "string").slice(0, 100) : null;
  if (through === null || !skip) return NextResponse.json({ error: "bad request" }, { status: 400 });
  await saveSort(player.profile, through, skip, body?.done === true);
  return NextResponse.json({ ok: true }, NO_STORE);
}
