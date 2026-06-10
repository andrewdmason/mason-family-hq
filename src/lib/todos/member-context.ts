import type { TodoMember } from "@/lib/todos/types";

/**
 * The person switcher rides on a `?as=<email>` query param: every page reads
 * it, every internal todos link re-appends it (withAs), and a plain entry to
 * /todos (PWA start_url, bookmark, app switcher) naturally resets to yourself.
 *
 * This is *impersonation for convenience, not identity*: server actions still
 * resolve the real signed-in user for creator_email, so attribution and the
 * notification bell stay truthful.
 */

/** Resolve the viewed member: a valid ?as= email, else the signed-in self. */
export function resolveViewedMember(
  asParam: string | string[] | undefined,
  selfEmail: string,
  members: TodoMember[]
): TodoMember {
  const requested = typeof asParam === "string" ? asParam.toLowerCase() : null;
  const member =
    (requested && members.find((m) => m.email === requested)) ||
    members.find((m) => m.email === selfEmail);
  if (!member) throw new Error("Signed-in user is not a family member");
  return member;
}

/** Append the ?as= param to an internal href when viewing someone else. */
export function withAs(href: string, viewedEmail: string, selfEmail: string): string {
  if (viewedEmail === selfEmail) return href;
  const sep = href.includes("?") ? "&" : "?";
  return `${href}${sep}as=${encodeURIComponent(viewedEmail)}`;
}
