"use client";

import { Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemberAvatar } from "@/components/journal/member-avatar";
import type { TodoMember } from "@/lib/todos/types";
import { firstNameOf } from "@/components/todos/member-name";
import { cn } from "@/lib/utils";

/**
 * Who owns this task. Every task has exactly one assignee; handing it to
 * someone else drops it in their Inbox with a "from you" chip.
 */
export function AssigneePicker({
  members,
  assigneeEmail,
  onReassign,
  triggerClassName,
  open,
  onOpenChange,
}: {
  members: TodoMember[];
  assigneeEmail: string;
  onReassign: (email: string) => void;
  triggerClassName?: string;
  /** Controlled open (the keyboard `a` summons it); omit for internal state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const assignee = members.find((m) => m.email === assigneeEmail);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}
    >
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              triggerClassName
            )}
          />
        }
      >
        <MemberAvatar name={assignee?.name} size="xs" />
        {firstNameOf(assignee)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {members.map((member) => (
          <DropdownMenuItem
            key={member.email}
            onClick={() => {
              if (member.email !== assigneeEmail) onReassign(member.email);
            }}
            className="gap-2"
          >
            <MemberAvatar name={member.name} size="xs" />
            <span className="flex-1 truncate">{member.name ?? member.email}</span>
            {member.email === assigneeEmail && (
              <Check className="size-4 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
