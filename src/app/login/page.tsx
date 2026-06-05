"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DevLoginSwitcher } from "@/components/dev-login-switcher";

// One Google consent grants both sign-in and Calendar read/write. access_type
// offline + prompt consent are what make Supabase return a provider refresh
// token, which /auth/callback stores for the calendar sync.
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

function LoginForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const authError = searchParams.get("error");

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
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Mason Family HQ
        </h1>
        <p className="text-sm text-muted-foreground">
          The Mason family&apos;s private home base
        </p>
      </CardHeader>
      <CardContent>
        {authError === "unauthorized" && (
          <p className="mb-4 text-sm text-destructive text-center">
            This app is private. Your email is not authorized.
          </p>
        )}
        {authError === "auth" && (
          <p className="mb-4 text-sm text-destructive text-center">
            Authentication failed. Please try again.
          </p>
        )}

        <div className="space-y-4">
          <p className="text-sm text-center text-muted-foreground">
            Sign in with your family Google account — journal, reading, calendar,
            and everything else under one roof.
          </p>
          <Button
            type="button"
            className="w-full"
            onClick={signInWithGoogle}
            disabled={loading}
          >
            {loading ? "Redirecting…" : "Sign in with Google"}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {process.env.NODE_ENV === "development" && <DevLoginSwitcher />}
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
