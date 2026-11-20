import { NextResponse } from "next/server";
import { jsonBody, NO_STORE, vocabPlayer } from "@/lib/tuttles/vocab";
import { answerQuestion } from "@/lib/words/session";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An answer to the question on screen.
 *
 *   POST { sessionId, position, choice, ms }   (choice null: "Don't know")
 *   → { feedback, state }
 *   → 409 when the session has moved on without this phone (another device,
 *     or a second tap): start again from /vocab/session.
 */
export async function POST(request: Request) {
  const player = await vocabPlayer(request);
  if (player instanceof NextResponse) return player;
  const body = await jsonBody(request);
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.toLowerCase() : "";
  const position = typeof body?.position === "number" ? body.position : NaN;
  // null is "Don't know"; anything else has to be one of the choices.
  if (body?.choice !== null && !(typeof body?.choice === "number" && Number.isInteger(body.choice))) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const choice = body.choice as number | null;
  const ms = typeof body?.ms === "number" ? body.ms : 0;
  if (!UUID.test(sessionId) || !Number.isInteger(position)) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const result = await answerQuestion(player.userId, sessionId, position, choice, ms, { key: true });
  if (!result) return NextResponse.json({ error: "moved on" }, { status: 409 });
  return NextResponse.json(result, NO_STORE);
}
