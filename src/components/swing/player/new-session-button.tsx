"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createSession } from "@/app/(swing)/swing/actions";

/**
 * "New session" CTA: creates the session row immediately (filmed_on defaults
 * to today server-side, editable on the session page) and navigates straight
 * there — no intermediate form.
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
      const sessionId = await createSession(playerId);
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
