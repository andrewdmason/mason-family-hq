"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

// One Google consent grants both sign-in and Calendar read/write. access_type
// offline makes Google return a provider refresh token on the first consent,
// which /auth/callback stores for the calendar sync. Returning users skip the
// consent screen (no prompt param), so no refresh token comes back — that's
// fine, the callback keeps the stored one.
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

/** The Google sign-in button. The only part of the login page that needs the
 * client (it calls supabase.auth.signInWithOAuth and redirects to Google).
 *
 * forceConsent (via /login?consent=1) re-shows Google's consent screen to mint
 * a fresh refresh token — the escape hatch if a member's stored token ever dies
 * without them revoking access (revocation alone self-heals: Google clears the
 * grant, so the next sign-in re-consents automatically). */
export function GoogleSignIn({ forceConsent = false }: { forceConsent?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: CALENDAR_SCOPE,
        queryParams: {
          access_type: "offline",
          ...(forceConsent ? { prompt: "consent" } : {}),
        },
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
    // On success the browser is redirected to Google, so no further state change.
  }

  return (
    <>
      <Button
        type="button"
        className="w-full"
        onClick={signInWithGoogle}
        disabled={loading}
      >
        {loading ? "Redirecting…" : "Sign in with Google"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </>
  );
}
