import { createClient } from "@/lib/supabase/server";
import { getSelfEmail, getTodoMembers } from "@/lib/todos/queries";
import { QuickAddHost } from "@/components/todos/quick-add";

/**
 * Server side of the global quick-add (mounted in the root layout): resolves
 * the member list + signed-in member and renders the modal host. Renders
 * nothing for unauthenticated pages (/login, /auth) or non-members.
 */
export async function GlobalQuickAdd() {
  try {
    const supabase = await createClient();
    const [selfEmail, members] = await Promise.all([
      getSelfEmail(supabase),
      getTodoMembers(),
    ]);
    return <QuickAddHost members={members} selfEmail={selfEmail} />;
  } catch {
    return null;
  }
}
