import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DevLoginSwitcher } from "@/components/dev-login-switcher";
import { GoogleSignIn } from "@/components/google-sign-in";

export const metadata = {
  title: "Sign In",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; consent?: string }>;
}) {
  // ?consent=1 forces Google's consent screen to mint a fresh calendar refresh
  // token — see GoogleSignIn for when that's needed.
  const { error: authError, consent } = await searchParams;

  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-4">
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
              Sign in with your family Google account — journal, reading,
              calendar, and everything else under one roof.
            </p>
            <GoogleSignIn forceConsent={consent === "1"} />
          </div>

          <DevLoginSwitcher />
        </CardContent>
      </Card>
    </div>
  );
}
