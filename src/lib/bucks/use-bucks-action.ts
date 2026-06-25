"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Shared client helper for Mason Bucks mutations: run a server action inside a
 * transition, refresh on success, and surface its error message. Used by the
 * wallet and the admin console.
 */
export function useBucksAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  };
  return { pending, error, run };
}
