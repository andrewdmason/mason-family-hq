import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MemberRole } from "@/lib/types";

type Member = { email: string; name: string | null; role: MemberRole };

/**
 * Dev-only sign-in helper: pick an existing family member from the dropdown, or
 * type any email to provision a fresh one, then dev-login as them.
 *
 * Server-rendered with native GET forms (no client JS): the member list and the
 * default email are filled in on the server, and submitting navigates straight
 * to /auth/dev-login?email=…. This works in any browser — including embedded /
 * built-in ones where the client-side fetch or button handlers don't run.
 * Renders nothing in production.
 */
export async function DevLoginSwitcher() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.NEXT_PUBLIC_SUPABASE_ENV === "production"
  ) {
    return null;
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("family_members")
    .select("email, name, role")
    .order("created_at", { ascending: true });

  // Owner first, then creation order (text role doesn't sort owner-first in SQL).
  const members = ((data ?? []) as Member[]).sort(
    (a, b) => Number(b.role === "owner") - Number(a.role === "owner")
  );
  const defaultEmail =
    members[0]?.email ?? process.env.AUTHORIZED_EMAIL?.toLowerCase().trim() ?? "";

  return (
    <>
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">dev</span>
        </div>
      </div>

      <div className="space-y-2">
        {members.length > 0 && (
          <form method="get" action="/auth/dev-login" className="flex gap-2">
            <select
              name="email"
              defaultValue={defaultEmail}
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
            >
              {members.map((m) => (
                <option key={m.email} value={m.email}>
                  {(m.name ? `${m.name} — ${m.email}` : m.email) + ` (${m.role})`}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline">
              Dev login
            </Button>
          </form>
        )}

        <form method="get" action="/auth/dev-login" className="flex gap-2">
          <Input
            type="email"
            name="email"
            placeholder="or type an email to provision"
            defaultValue={members.length === 0 ? defaultEmail : ""}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="outline">
            {members.length === 0 ? "Dev login" : "Provision"}
          </Button>
        </form>
      </div>
    </>
  );
}
