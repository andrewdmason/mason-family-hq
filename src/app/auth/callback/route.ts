import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { Session } from "@supabase/supabase-js";
import { supabaseUrl, supabaseAnonKey } from "@/lib/supabase/config";
import { ensureProvisioned } from "@/lib/journal/provisioning";
import { createAdminClient } from "@/lib/supabase/admin";

// Google access tokens last ~1h; we don't get the exact expiry in the session, so
// assume the standard hour. getValidGoogleToken refreshes within 5 min of this.
const GOOGLE_TOKEN_TTL_SECONDS = 3600;

// Persist the Google provider tokens captured at sign-in so the calendar sync and
// write-back can act as the member. Supabase doesn't refresh provider tokens — the
// refresh token is what lets us. Google only returns one when the consent screen
// is shown (first sign-in, after revocation, or /login?consent=1) — routine
// re-logins skip consent and return null, so never clobber a stored refresh token.
async function storeGoogleConnection(
  email: string,
  session: Session | null,
): Promise<void> {
  const accessToken = session?.provider_token;
  if (!accessToken) return; // nothing to store (e.g. non-Google sign-in)

  const refreshToken = session?.provider_refresh_token ?? null;
  const row: Record<string, unknown> = {
    member_email: email,
    access_token: accessToken,
    google_email: email,
    scopes: "https://www.googleapis.com/auth/calendar",
    token_expires_at: new Date(
      Date.now() + GOOGLE_TOKEN_TTL_SECONDS * 1000,
    ).toISOString(),
  };
  // Only include refresh_token when present so an upsert can't wipe the stored one.
  if (refreshToken) row.refresh_token = refreshToken;

  const admin = createAdminClient();
  await admin
    .from("google_connections")
    .upsert(row, { onConflict: "member_email" });
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Ignored — cookie writes may fail in certain contexts
            }
          },
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Family allowlist: only emails the owner has added may sign in. First
      // sign-in also seeds the member's per-user journal.
      const membership = user
        ? await ensureProvisioned(user)
        : { allowed: false as const };
      if (!membership.allowed) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=unauthorized`);
      }

      // Capture the Google calendar grant from this sign-in for the now-allowed
      // member. Best-effort: never block login on a token-storage hiccup.
      const email = user?.email?.toLowerCase().trim();
      if (email) {
        try {
          await storeGoogleConnection(email, data.session);
        } catch (err) {
          console.error("Failed to store Google connection:", err);
        }
      }

      return NextResponse.redirect(origin);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
