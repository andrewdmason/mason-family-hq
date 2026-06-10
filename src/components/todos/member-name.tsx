import type { TodoMember } from "@/lib/todos/types";

/** First name for chips and pickers; falls back to the email's local part. */
export function firstNameOf(member: TodoMember | undefined | null): string {
  if (!member) return "?";
  const first = member.name?.trim().split(/\s+/)[0];
  return first || member.email.split("@")[0];
}
