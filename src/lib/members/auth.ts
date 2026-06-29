import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Both lookups below are request-cached with React's cache(): a single page
// render asks "who is this?" from several spots (the global header, the page,
// nested helpers like getIsOwner). cache() collapses them to one call per
// request. The optional `supabase` parameter is kept for callers that already
// hold a client, but the cached lookup always resolves from the request's
// cookies — every server client in a request sees the same session.
//
// We resolve identity with getClaims() (local JWT verification via Web Crypto +
// a cached JWKS), exactly like the auth gate in src/lib/supabase/middleware.ts.
// getUser() instead makes a network round-trip AND, when the access token has
// expired, tries to refresh the session by writing cookies — which a server
// component cannot do (only middleware / route handlers can). So getUser() would
// return null even though the middleware just refreshed the session, surfacing
// as a spurious "Not authenticated" on render (the dev-server wedge after the
// access token rotates). getClaims() reads the middleware-refreshed cookie and
// verifies it locally, so the gate and the page always agree — and there's no
// per-render network call.
const getAuthUser = cache(async (): Promise<{ id: string; email?: string } | null> => {
  const client = await createClient();
  const { data } = await client.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) return null;
  const email = data?.claims?.email;
  return { id: sub, email: typeof email === "string" ? email : undefined };
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

/**
 * Resolve whether the current user is an adult (owner or parent) — the people who
 * approve kids' claims and fulfill redemptions. Reads the caller's own membership
 * row (RLS-scoped).
 */
export async function getIsAdult(
  supabase?: Awaited<ReturnType<typeof createClient>>
): Promise<boolean> {
  void supabase; // kept for call-site compatibility — see note above
  const role = await getRole();
  return role === "owner" || role === "parent";
}

/** Throw unless the current user is an adult (owner or parent). Returns their id. */
export async function requireAdult(
  supabase?: Awaited<ReturnType<typeof createClient>>
): Promise<string> {
  void supabase; // kept for call-site compatibility — see note above
  const userId = await requireUserId();
  if (!(await getIsAdult())) throw new Error("Not authorized");
  return userId;
}
