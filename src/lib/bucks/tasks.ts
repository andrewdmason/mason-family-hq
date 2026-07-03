import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { firstNameFor } from "@/lib/bucks/members";
import type { BucksAdminClaim, BucksAdminTask, BucksEarnTask } from "@/lib/bucks/types";

type TaskRow = {
  id: string;
  title: string;
  unit_value: number;
  unit_label: string;
  is_one_time: boolean;
  audience_user_id: string | null;
  archived_at: string | null;
};

/**
 * Active earning tasks a kid can claim — shared (audience null) plus their own,
 * excluding archived — with a count of their still-pending claims. Filters by
 * userId explicitly so it's correct on the admin client (member mode) too.
 */
export async function loadEarnTasksForKid(
  client: SupabaseClient,
  userId: string
): Promise<BucksEarnTask[]> {
  const [{ data: rows }, { data: claims }] = await Promise.all([
    client
      .from("bucks_earning_tasks")
      .select("id, title, unit_value, unit_label, is_one_time, audience_user_id, archived_at")
      .is("archived_at", null)
      .or(`audience_user_id.is.null,audience_user_id.eq.${userId}`)
      .order("created_at", { ascending: true }),
    client
      .from("bucks_task_claims")
      .select("task_id")
      .eq("user_id", userId)
      .eq("status", "pending"),
  ]);

  const pendingByTask = new Map<string, number>();
  for (const c of claims ?? []) {
    const id = c.task_id as string;
    pendingByTask.set(id, (pendingByTask.get(id) ?? 0) + 1);
  }

  return ((rows ?? []) as TaskRow[]).map((t) => ({
    id: t.id,
    title: t.title,
    unitValue: t.unit_value,
    unitLabel: t.unit_label,
    isOneTime: t.is_one_time,
    audienceUserId: t.audience_user_id,
    pendingClaims: pendingByTask.get(t.id) ?? 0,
  }));
}

/** All non-archived earning tasks for the adult console. Service role. */
export async function loadTasksForAdmin(): Promise<BucksAdminTask[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("bucks_earning_tasks")
    .select("id, title, unit_value, unit_label, is_one_time, audience_user_id, archived_at")
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  return ((data ?? []) as TaskRow[]).map((t) => ({
    id: t.id,
    title: t.title,
    unitValue: t.unit_value,
    unitLabel: t.unit_label,
    isOneTime: t.is_one_time,
    audienceUserId: t.audience_user_id,
    archivedAt: t.archived_at,
  }));
}

/** Pending claims across all kids, for the adult approval queue. Service role. */
export async function loadPendingClaims(): Promise<BucksAdminClaim[]> {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("bucks_task_claims")
    .select("id, user_id, quantity, unit_value, claimed_at, note, task_id, bucks_earning_tasks(title)")
    .eq("status", "pending")
    .order("claimed_at", { ascending: true });
  if (!rows || rows.length === 0) return [];

  const names = await firstNameFor(
    admin,
    rows.map((r) => r.user_id as string)
  );

  return rows.map((r) => {
    // A to-one PostgREST embed can arrive as a single object or a one-element
    // array depending on how the relationship resolves — normalize both (the
    // codebase does the same in journal/calendar).
    const rel = r.bucks_earning_tasks as
      | { title?: string }
      | { title?: string }[]
      | null;
    const task = Array.isArray(rel) ? rel[0] : rel;
    // task_id null ⟺ an arbitrary "give me N Bucks" request; taskTitle stays null
    // so the queue renders the kid's note instead of a task label.
    const isRequest = r.task_id == null;
    return {
      id: r.id as string,
      taskTitle: isRequest ? null : task?.title ?? "Earning task",
      note: (r.note as string | null) ?? null,
      kidUserId: r.user_id as string,
      kidName: names.get(r.user_id as string) ?? "A kid",
      quantity: r.quantity as number,
      unitValue: r.unit_value as number,
      amount: (r.unit_value as number) * (r.quantity as number),
      claimedAt: r.claimed_at as string,
    };
  });
}
