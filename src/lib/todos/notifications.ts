import "server-only";

import type { createClient } from "@/lib/supabase/server";
import type { JournalNotification } from "@/lib/types";
import { getTodoMembers } from "@/lib/todos/queries";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Bell items for the Todos app: tasks someone else put on your list that you
 * haven't seen yet (assignee_seen_at is stamped when you open your Inbox).
 * Same shape as the journal's notifications so the header bell can merge them.
 */
export async function getTodoNotifications(
  supabase: Supabase,
  userId: string
): Promise<JournalNotification[]> {
  const { data: memberRow } = await supabase
    .from("family_members")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();
  const selfEmail = memberRow?.email as string | undefined;
  if (!selfEmail) return [];

  const { data } = await supabase
    .from("todo_tasks")
    .select("id, title, creator_email, created_at")
    .eq("assignee_email", selfEmail)
    .neq("creator_email", selfEmail)
    .is("assignee_seen_at", null)
    .is("completed_at", null)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(10);

  const unseen = (data ?? []) as {
    id: string;
    title: string;
    creator_email: string;
  }[];
  if (unseen.length === 0) return [];

  const members = await getTodoMembers();
  const nameOf = (email: string) =>
    members.find((m) => m.email === email)?.name?.trim().split(/\s+/)[0] ??
    email.split("@")[0];

  return unseen.map((task) => ({
    id: `todo:${task.id}`,
    title: task.title,
    reason: `To-do from ${nameOf(task.creator_email)}`,
    href: "/todos/inbox",
  }));
}
