"use client";

import { usePathname, useRouter } from "next/navigation";
import { Check, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemberAvatar } from "@/components/journal/member-avatar";
import type { TodoMember } from "@/lib/todos/types";
import { cn } from "@/lib/utils";

/**
 * The person switcher: swaps the whole app to another member's perspective
 * (their views, their projects, fully interactive). Rides on ?as=, so a plain
 * visit to /todos always resets to you. Deliberately quiet — it lives at the
 * bottom of the sidebar (and of the mobile lists screen), since peeking at
 * someone else's lists is an occasional act; the "Viewing X" banner is the
 * loud part once you're in.
 */
export function MemberSwitcher({
  members,
  viewedEmail,
  selfEmail,
}: {
  members: TodoMember[];
  viewedEmail: string;
  selfEmail: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const viewingOther = viewedEmail !== selfEmail;

  const switchTo = (email: string) => {
    if (email === viewedEmail) return;
    // Views carry over between people; a project page may not exist for the
    // other person's sidebar, so land them on Today instead.
    const path = pathname.startsWith("/todos/project/")
      ? "/todos/today"
      : pathname;
    router.push(
      email === selfEmail ? path : `${path}?as=${encodeURIComponent(email)}`
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="View another family member's lists"
            className={cn(
              "flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground/70 hover:bg-accent/40 hover:text-foreground",
              viewingOther && "text-primary"
            )}
          />
        }
      >
        <Users className="size-4" />
        Family
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-48">
        {members.map((member) => (
          <DropdownMenuItem
            key={member.email}
            onClick={() => switchTo(member.email)}
            className="gap-2"
          >
            <MemberAvatar name={member.name} size="xs" />
            <span className="flex-1 truncate">
              {member.name ?? member.email}
              {member.email === selfEmail && (
                <span className="text-muted-foreground"> (you)</span>
              )}
            </span>
            {member.email === viewedEmail && (
              <Check className="size-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
