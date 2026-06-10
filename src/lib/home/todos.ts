import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  getInboxCount,
  getSelfEmail,
  getViewTasks,
  sweepElapsedSnoozes,
} from "@/lib/todos/queries";
import type { TodoTask } from "@/lib/todos/types";

export type HomeTodos = {
  selfEmail: string;
  todayTasks: TodoTask[];
  inboxCount: number;
};

/**
 * The home dashboard's window into Todos: your Today list and the Inbox
 * count. Runs the snooze wake sweep first so a task snoozed until this
 * morning is already in Today by the time the dashboard renders.
 */
export async function getHomeTodos(): Promise<HomeTodos | null> {
  const supabase = await createClient();
  let selfEmail: string;
  try {
    selfEmail = await getSelfEmail(supabase);
  } catch {
    return null;
  }

  await sweepElapsedSnoozes(supabase);
  const [todayTasks, inboxCount] = await Promise.all([
    getViewTasks(supabase, selfEmail, "today"),
    getInboxCount(supabase, selfEmail),
  ]);

  return { selfEmail, todayTasks, inboxCount };
}
