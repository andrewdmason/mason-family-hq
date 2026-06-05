"use server";

import { requireUserId } from "@/lib/members/auth";
import { createClient } from "@/lib/supabase/server";
import { hasAnyConnection, syncAllAssignments } from "@/lib/assignments/sync";
import { DEFAULT_SCHOOL_HOST } from "@/lib/assignments/myschoolapp";

/** Resolve the caller's family_members row, or null if not provisioned. */
async function currentMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ email: string; role: string } | null> {
  const userId = await requireUserId(supabase);
  const { data } = await supabase
    .from("family_members")
    .select("email, role")
    .eq("user_id", userId)
    .maybeSingle();
  return data ? { email: data.email as string, role: data.role as string } : null;
}

export type ConnectResult = { ok: boolean; error?: string; synced?: number };

/**
 * Store a parent's myBENTLEY session cookie and immediately validate it by
 * syncing. The cookie is the full `Cookie:` request header from a logged-in
 * portal session (Blackbaud ID is SSO — there's no API key or refresh token).
 * Parents only. The row is written under the caller's own-connection RLS policy.
 */
export async function connectBentley(rawCookie: string): Promise<ConnectResult> {
  try {
    const supabase = await createClient();
    const me = await currentMember(supabase);
    if (!me || (me.role !== "owner" && me.role !== "parent")) {
      return { ok: false, error: "Only a parent can connect Bentley." };
    }
    // Strip CR/LF (a Cookie HTTP header can't contain them — a stray newline
    // from copy/paste would otherwise crash the outbound fetch) and outer space.
    const cookie = rawCookie.replace(/[\r\n]+/g, " ").trim();
    if (cookie.length < 20) {
      return {
        ok: false,
        error: "That doesn't look like a session cookie. Paste the full Cookie header.",
      };
    }

    const { error: upErr } = await supabase.from("blackbaud_connections").upsert(
      {
        member_email: me.email,
        session_cookie: cookie,
        school_host: DEFAULT_SCHOOL_HOST,
        cookie_expires_at: null,
        sync_error: null,
      },
      { onConflict: "member_email" },
    );
    if (upErr) return { ok: false, error: upErr.message };

    // Validate by syncing now. If every student errors, the cookie is bad — drop
    // it back out so the UI returns to a clean "not connected" state.
    const results = await syncAllAssignments();
    const errored = results.filter((r) => r.error);
    const synced = results.reduce((n, r) => n + r.synced, 0);
    if (results.length > 0 && errored.length === results.length) {
      await supabase
        .from("blackbaud_connections")
        .delete()
        .eq("member_email", me.email);
      return {
        ok: false,
        error: errored[0].error ?? "Could not reach Bentley with that cookie.",
      };
    }
    return { ok: true, synced };
  } catch (err) {
    // A server action that does network I/O must never throw uncaught (that
    // surfaces as an opaque "unexpected response" page crash). Report instead.
    const message = err instanceof Error ? err.message : String(err);
    console.error("connectBentley failed:", err);
    return { ok: false, error: message };
  }
}

/** Remove the caller's stored Bentley session. */
export async function disconnectBentley(): Promise<void> {
  const supabase = await createClient();
  const me = await currentMember(supabase);
  if (!me?.email) return;
  await supabase
    .from("blackbaud_connections")
    .delete()
    .eq("member_email", me.email);
}

/**
 * One-shot assignment sync, fired on mount by the page (like the calendar's
 * SyncTrigger). A no-op until a parent has connected a portal session, so it's
 * safe to call on every visit. Only provisioned members may trigger it.
 */
export async function triggerAssignmentSync(): Promise<void> {
  try {
    const supabase = await createClient();
    const userId = await requireUserId(supabase);

    const { data: me } = await supabase
      .from("family_members")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    if (!me) return; // not a provisioned member

    if (!(await hasAnyConnection())) return;
    await syncAllAssignments();
  } catch (err) {
    // Best-effort background sync — never let it bubble into a page crash.
    console.error("triggerAssignmentSync failed:", err);
  }
}
