import { NextResponse } from "next/server";
import { NO_STORE, vocabPlayer } from "@/lib/tuttles/vocab";
import { startOrResume } from "@/lib/words/session";

export const runtime = "nodejs";

/**
 * Today's session: the one under way, or a new one.
 *
 *   POST → SessionState (src/lib/words/types.ts): the question on screen
 *          without its answer, or the summary if there was nothing left to ask.
 */
export async function POST(request: Request) {
  const player = await vocabPlayer(request);
  if (player instanceof NextResponse) return player;
  return NextResponse.json(await startOrResume(player.profile, { key: true }), NO_STORE);
}
