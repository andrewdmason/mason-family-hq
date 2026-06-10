import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  getSelfEmail,
  getViewTasks,
  sweepElapsedSnoozes,
} from "@/lib/todos/queries";
import type { TodoTask } from "@/lib/todos/types";

export type HomeTodos = {
  selfEmail: string;
  todayTasks: TodoTask[];
  inboxTasks: TodoTask[];
};

/**
 * The home dashboard's window into Todos: your Today list and the Inbox
 * tasks awaiting triage. Runs the snooze wake sweep first so a task snoozed
 * until this morning is already in Today by the time the dashboard renders.
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
  const [todayTasks, inboxTasks] = await Promise.all([
    getViewTasks(supabase, selfEmail, "today"),
    getViewTasks(supabase, selfEmail, "inbox"),
  ]);

  return { selfEmail, todayTasks, inboxTasks };
}
