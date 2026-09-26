"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** While any at-bat on screen is still being prepared, re-fetch every few seconds. */
export function ProcessingRefresher({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}
