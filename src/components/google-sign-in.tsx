"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

// One Google consent grants both sign-in and Calendar read/write. access_type
// offline + prompt consent are what make Supabase return a provider refresh
// token, which /auth/callback stores for the calendar sync.
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

/** The Google sign-in button. The only part of the login page that needs the
 * client (it calls supabase.auth.signInWithOAuth and redirects to Google). */
export function GoogleSignIn() {
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
        queryParams: { access_type: "offline", prompt: "consent" },
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
