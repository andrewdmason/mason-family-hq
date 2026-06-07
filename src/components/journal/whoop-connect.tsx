"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  connectWhoop,
  completeWhoopMfa,
  disconnectWhoop,
  type ConnectResult,
} from "@/app/(journal)/settings/whoop/actions";
import type { MfaChallenge } from "@/lib/whoop/cognito";

const CHALLENGE_LABEL: Record<MfaChallenge, string> = {
  SMS_MFA: "the code WHOOP just texted you",
  SOFTWARE_TOKEN_MFA: "your authenticator app code",
  EMAIL_OTP: "the code WHOOP just emailed you",
};

export function WhoopConnect({
  connected,
  connectedAt,
}: {
  connected: boolean;
  connectedAt: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mfa, setMfa] = useState<{ challenge: MfaChallenge; session: string } | null>(null);
  const [code, setCode] = useState("");

  function handleResult(res: ConnectResult) {
    if (res.status === "error") {
      setError(res.message);
      return;
    }
    if (res.status === "mfa_required") {
      setMfa({ challenge: res.challenge, session: res.session });
      setError(null);
      return;
    }
    // connected — clear the form; the page revalidates to the connected state.
    setEmail("");
    setPassword("");
    setCode("");
    setMfa(null);
    setError(null);
  }

  if (connected) {
    return (
      <div className="rounded-lg border border-border p-5">
        <p className="font-serif text-sm text-foreground">
          WHOOP is connected.
          {connectedAt && (
            <span className="text-muted-foreground"> Since {connectedAt.slice(0, 10)}.</span>
          )}
        </p>
        <p className="mt-1 font-serif text-xs italic text-muted-foreground">
          Open a workout and press “Send to WHOOP” to push its strength work over.
        </p>
        <div className="mt-4">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => startTransition(async () => void (await disconnectWhoop()))}
          >
            Disconnect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border p-5">
      {!mfa ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => handleResult(await connectWhoop(email, password)));
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="whoop-email">WHOOP email</Label>
            <Input
              id="whoop-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="whoop-password">WHOOP password</Label>
            <Input
              id="whoop-password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <p className="font-serif text-xs italic text-muted-foreground">
            Your password is used once to sign in and is never stored — we keep only a
            refresh token.
          </p>
          {error && <p className="font-serif text-xs text-red-600">{error}</p>}
          <Button type="submit" disabled={pending || !email || !password}>
            {pending ? "Connecting…" : "Connect WHOOP"}
          </Button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () =>
              handleResult(
                await completeWhoopMfa({ email, session: mfa.session, challenge: mfa.challenge, code }),
              ),
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="whoop-code">Verification code</Label>
            <Input
              id="whoop-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <p className="font-serif text-xs italic text-muted-foreground">
              Enter {CHALLENGE_LABEL[mfa.challenge]}.
            </p>
          </div>
          {error && <p className="font-serif text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || !code}>
              {pending ? "Verifying…" : "Verify & connect"}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setMfa(null)}>
              Back
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
