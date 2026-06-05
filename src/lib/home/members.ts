import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import type { MemberRole } from "@/lib/types";

export type CurrentMember = {
  email: string | null;
  name: string | null;
  role: MemberRole | null;
};

/** The signed-in user's family_members row (email, display name, role). */
export async function getCurrentMember(): Promise<CurrentMember> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const { data } = await supabase
    .from("family_members")
    .select("email, name, role")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    email: (data?.email as string | null) ?? null,
    name: (data?.name as string | null) ?? null,
    role: (data?.role as MemberRole | null) ?? null,
  };
}

/** Just the first name, for greetings. Falls back to "there". */
export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "there";
}
