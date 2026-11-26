import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { houseForPhone, street, type HouseState, type HouseSyncInput, type Neighbour } from "@/lib/tuttles/house";
import type { MathState } from "@/lib/tuttles/math";
import { loadStudents, type Admin } from "@/lib/words/session";

// The house in the Tuttles app, kept: taking in what the phone sends and
// reading back the street. What's allowed in is src/lib/tuttles/house.ts; the
// table is supabase/migrations/00229_tuttles_house.sql.

/** What sync answers with. */
export type HouseSync = {
  /** The house kept here, only when it's newer than the phone's. */
  state: HouseState | null;
  street: Neighbour[];
  /** A house was sent and couldn't be kept. */
  dropped: boolean;
};

/** Keep the phone's house if it's newer than what's here. The check is the write's own, so two phones at once can't put an older one on top. */
export async function keepHouse(userId: string, state: HouseState): Promise<void> {
  const admin = createAdminClient();
  const row = { user_id: userId, rev: state.rev, json: state.json, updated_at: new Date().toISOString() };
  // The first there's ever been goes in; if there's one already this does nothing…
  const first = await admin.from("tuttles_house_state").upsert(row, { onConflict: "user_id", ignoreDuplicates: true });
  if (first.error) throw new Error(first.error.message);
  // …and this replaces it, only if it's older.
  const newer = await admin.from("tuttles_house_state").update(row).eq("user_id", userId).lt("rev", state.rev);
  if (newer.error) throw new Error(newer.error.message);
}

async function loadStates(admin: Admin, table: "tuttles_house_state" | "tuttles_math_state", userIds: string[]): Promise<Map<string, MathState>> {
  const out = new Map<string, MathState>();
  if (userIds.length === 0) return out;
  const { data, error } = await admin.from(table).select("user_id, rev, json").in("user_id", userIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as { user_id: string; rev: number; json: Record<string, unknown> }[]) {
    out.set(row.user_id, { rev: row.rev, json: row.json });
  }
  return out;
}

/**
 * What the phone is told after a sync: the street, and its own house back
 * when the one kept here is newer than the one it holds. `me` is the kid the
 * phone is being used as; null for the parents, who are only looking.
 */
export async function loadHouseSync(me: string | null, input: Pick<HouseSyncInput, "phoneRev" | "dropped">): Promise<HouseSync> {
  const admin = createAdminClient();
  const kids = await loadStudents();
  // (Someone with a house who isn't one of the kids on the street still gets their own back.)
  const ids = [...new Set([...kids.map((k) => k.userId), ...(me ? [me] : [])])];
  const [houses, maths] = await Promise.all([loadStates(admin, "tuttles_house_state", ids), loadStates(admin, "tuttles_math_state", ids)]);
  return {
    state: me ? houseForPhone(houses.get(me) ?? null, input.phoneRev) : null,
    street: street(
      kids.map((k) => ({ kid: k.userId, name: k.name })),
      me,
      houses,
      maths,
    ),
    dropped: input.dropped,
  };
}
