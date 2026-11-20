import { NextResponse } from "next/server";
import { jsonBody, NO_STORE, vocabPlayer } from "@/lib/tuttles/vocab";
import { removeCurrent } from "@/lib/words/session";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Too easy": take the word on screen out for good and get another in its place.
 *
 *   POST { sessionId, position, ms } → SessionState
 *   → 409 when the session has moved on without this phone.
 */
export async function POST(request: Request) {
  const player = await vocabPlayer(request);
  if (player instanceof NextResponse) return player;
  const body = await jsonBody(request);
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.toLowerCase() : "";
  const position = typeof body?.position === "number" ? body.position : NaN;
  const ms = typeof body?.ms === "number" ? body.ms : 0;
  if (!UUID.test(sessionId) || !Number.isInteger(position)) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const state = await removeCurrent(player.userId, sessionId, position, ms);
  if (!state) return NextResponse.json({ error: "moved on" }, { status: 409 });
  return NextResponse.json(state, NO_STORE);
}
