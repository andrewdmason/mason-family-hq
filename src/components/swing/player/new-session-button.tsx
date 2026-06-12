"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSession } from "@/app/(swing)/swing/actions";

/**
 * "New session" CTA: creates the session row immediately (filmed_on is the
 * client's local date — the server's CURRENT_DATE is UTC and would be
 * tomorrow for evening sessions; editable on the session page) and navigates
 * straight there — no intermediate form.
 */
export function NewSessionButton({
  playerId,
  size = "default",
  className,
}: {
  playerId: string;
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      // en-CA formats as YYYY-MM-DD in the user's local timezone.
      const sessionId = await createSession(
        playerId,
        new Date().toLocaleDateString("en-CA")
      );
      router.push(`/swing/players/${playerId}/sessions/${sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create session");
      setPending(false);
    }
  }

  return (
    <div className={className}>
      <Button size={size} onClick={start} disabled={pending}>
        {pending ? (
          <Loader2 data-icon="inline-start" className="animate-spin" />
        ) : (
          <Plus data-icon="inline-start" />
        )}
        New session
      </Button>
      {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
    </div>
  );
}
