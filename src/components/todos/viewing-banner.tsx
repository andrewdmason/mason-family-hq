"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Eye } from "lucide-react";
import { firstNameOf } from "@/components/todos/member-name";
import type { TodoMember } from "@/lib/todos/types";

/**
 * Persistent strip while the person switcher has you in someone else's lists,
 * so impersonation is never ambient. Everything stays fully interactive — you
 * can add, complete, and snooze on their behalf.
 */
export function ViewingBanner({ viewed }: { viewed: TodoMember }) {
  const pathname = usePathname();
  const backPath = pathname.startsWith("/todos/") ? pathname : "/todos/today";

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
      <span className="flex items-center gap-2 text-foreground">
        <Eye className="size-4 text-primary" />
        Viewing {firstNameOf(viewed)}’s lists
      </span>
      <Link
        href={backPath.startsWith("/todos/project/") ? "/todos/today" : backPath}
        className="shrink-0 font-medium text-primary hover:underline"
      >
        Back to mine
      </Link>
    </div>
  );
}
