"use client";

import { useRefreshOnReturn } from "@/components/refresh-on-return";
import { useTodosRefresh } from "@/lib/todos/shell-refresh";

/**
 * Todos' version of RefreshOnReturn: same trigger (you came back to the
 * window), but the data is re-read into the mounted shell rather than by
 * re-running the route. Coming back to a window with a half-written to-do in it
 * must not cost you the to-do — and after any instant view switch, a route
 * refresh would remount the whole screen (see shell-refresh.ts).
 */
export function TodosRefreshOnReturn() {
  useRefreshOnReturn(useTodosRefresh());
  return null;
}
