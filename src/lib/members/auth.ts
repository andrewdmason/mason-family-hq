import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Both lookups below are request-cached with React's cache(): a single page
// render asks "who is this?" from several spots (the global header, the page,
// nested helpers like getIsOwner), and each auth.getUser() is a network round
// trip to Supabase. cache() collapses them to one call per request. The
// optional `supabase` parameter is kept for callers that already hold a client,
// but the cached lookup always resolves from the request's cookies — every
// server client in a request sees the same session, so the answer is identical.
const getAuthUser = cache(async () => {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  return user;
});

const getRole = cache(async (): Promise<string | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  const client = await createClient();
  const { data } = await client
    .from("family_members")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  return data?.role ?? null;
});

/**
 * Resolve the authenticated user's id, throwing if there's no session.
 *
 * Per-user rows are scoped by RLS, whose WITH CHECK clause rejects any insert
 * that omits user_id — so every such insert must stamp it. Reads don't need an
 * explicit user filter (RLS applies one automatically).
 */
export async function requireUserId(
  supabase?: Awaited<ReturnType<typeof createClient>>
): Promise<string> {
  void supabase; // kept for call-site compatibility — see note above
  const user = await getAuthUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

/**
 * Resolve whether the current user is the owner (the practice-book + family
 * admin). Reads the caller's own membership row (RLS-scoped).
 */
export async function getIsOwner(
  supabase?: Awaited<ReturnType<typeof createClient>>
): Promise<boolean> {
  void supabase; // kept for call-site compatibility — see note above
  return (await getRole()) === "owner";
}

/** Throw unless the current user is the owner. Returns the owner's user id. */
export async function requireOwner(
  supabase?: Awaited<ReturnType<typeof createClient>>
): Promise<string> {
  void supabase; // kept for call-site compatibility — see note above
  const userId = await requireUserId();
  if (!(await getIsOwner())) throw new Error("Not authorized");
  return userId;
}
