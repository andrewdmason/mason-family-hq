// The house in the Tuttles app: each kid spends the coins and gems Vocab and
// Math pay on rooms and what goes in them, and the two houses stand on one
// street, each to be seen from the other's phone. The phone keeps the purse
// and the house and works with no connection; when it can reach the website
// it sends the whole of it (/tuttles/api/house/sync) and takes back the
// street.
//
// This file is what the phone may send and what's made of it: no database in
// it, so it can be run in a script (scripts/verify-tuttles-house.mts). The
// reading and writing is src/lib/tuttles/house-db.ts.

import { firstName, MAX_STATE_BYTES, stateForPhone, type MathState } from "@/lib/tuttles/math";

/** A purse and a house, as the phone keeps them. Only the phone knows what's in `json`. */
export type HouseState = MathState;

export type HouseSyncInput = {
  /** The phone's house to keep, if it sent one that can be. */
  state: HouseState | null;
  /** The rev of the house the phone holds: null when it sent none, Infinity when what it sent couldn't be read. */
  phoneRev: number | null;
  /** A house was sent and couldn't be taken. */
  dropped: boolean;
};

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2_147_483_647;

/**
 * What a call to sync carries, or why it can't be taken. Only a body that
 * isn't an object is refused. A house that can't be kept (no rev, not an
 * object, too big) is dropped and said to be, and the street still comes back.
 */
export function parseHouseSync(body: unknown): HouseSyncInput | { error: string; status: 400 } {
  if (!record(body)) return { error: "the body must be a JSON object", status: 400 };
  if (body.state == null) return { state: null, phoneRev: null, dropped: false };
  const s = body.state;
  const phoneRev = record(s) && whole(s.rev) ? s.rev : Infinity;
  if (record(s) && whole(s.rev) && record(s.json) && new TextEncoder().encode(JSON.stringify(s.json)).length <= MAX_STATE_BYTES) {
    return { state: { rev: s.rev, json: s.json }, phoneRev, dropped: false };
  }
  return { state: null, phoneRev, dropped: true };
}

/** One house on the street. */
export type Neighbour = {
  kid: string;
  name: string;
  me: boolean;
  /** Their house as their phone last sent it; null if it never has. */
  state: Record<string, unknown> | null;
  /** How they look, from what Math keeps for them; null if there's none. */
  look: Record<string, unknown> | null;
};

/** The street: every kid's house, in the order given. `me` is null for the parents, who have none. */
export function street(
  kids: { kid: string; name: string }[],
  me: string | null,
  houses: Map<string, HouseState>,
  maths: Map<string, MathState>,
): Neighbour[] {
  return kids.map(({ kid, name }) => {
    const look = maths.get(kid)?.json.look;
    return { kid, name: firstName(name), me: kid === me, state: houses.get(kid)?.json ?? null, look: record(look) ? look : null };
  });
}

/** Whether the house kept here is news to a phone that sent `sent` (null: it has none). */
export const houseForPhone = stateForPhone;
