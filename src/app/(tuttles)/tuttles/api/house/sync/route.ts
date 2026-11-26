import { NextResponse } from "next/server";
import { parseHouseSync } from "@/lib/tuttles/house";
import { keepHouse, loadHouseSync } from "@/lib/tuttles/house-db";
import { jsonBody, NO_STORE, vocabCaller } from "@/lib/tuttles/vocab";

export const runtime = "nodejs";

/**
 * The house in the Tuttles app: the phone hands over the purse and the house
 * as they stand, and takes back the street (src/lib/tuttles/house.ts).
 *
 *   POST   Authorization: Bearer …   (X-Tuttles-Kid: a parent's phone used as a kid)
 *     { state }
 *     state     { rev, json } or null: the phone's own, kept here only if it's the newest
 *   → { state, street: [{ kid, name, me, state, look }], dropped }
 *     state     what's kept here, only when it's newer than what was sent
 *     street    every kid's house as last sent, and how they look (from Math)
 *     dropped   a house was sent and couldn't be kept
 *
 * The caller is whoever Vocab would be playing as: a kid, or the kid a
 * parent's phone is being used as. A parent in the parents' own view sends
 * nothing and is shown the street: anything they send is ignored.
 */
export async function POST(request: Request) {
  const caller = await vocabCaller(request);
  if ("error" in caller) return NextResponse.json({ error: caller.error }, { status: caller.status });
  if (caller.parentView) return NextResponse.json(await loadHouseSync(null, { phoneRev: null, dropped: false }), NO_STORE);
  if (!caller.profile) return NextResponse.json({ error: "The house isn't set up for you yet." }, { status: 403 });
  const input = parseHouseSync(await jsonBody(request));
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: input.status });

  if (input.state) await keepHouse(caller.userId, input.state);
  return NextResponse.json(await loadHouseSync(caller.userId, input), NO_STORE);
}
