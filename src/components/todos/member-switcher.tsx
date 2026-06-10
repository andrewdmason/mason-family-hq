"use client";

import { usePathname, useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { firstNameOf } from "@/components/todos/member-name";
import type { TodoMember } from "@/lib/todos/types";

/**
 * The person switcher: swaps the whole app to another member's perspective
 * (their views, their projects, fully interactive). Rides on ?as=, so a plain
 * visit to /todos always resets to you.
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
  const viewed = members.find((m) => m.email === viewedEmail);

  const switchTo = (email: string) => {
    if (email === viewedEmail) return;
    // Views carry over between people; a project page may not exist for the
    // other person's sidebar, so land them on Today instead.
    const path = pathname.startsWith("/todos/project/") ? "/todos/today" : pathname;
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
            aria-label="Switch person"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pr-2 pl-1 text-sm text-muted-foreground hover:text-foreground"
          />
        }
      >
        <MemberAvatar name={viewed?.name} size="sm" />
        {firstNameOf(viewed)}
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
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
