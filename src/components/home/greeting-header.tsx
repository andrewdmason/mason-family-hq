"use client";

import { useEffect, useRef, useState } from "react";
import { SkeletonLine } from "./widget-skeleton";

/**
 * The dashboard's hero line: a date, plus one warm AI line about the person's
 * day. The server passes whatever's cached for today (`initialGreeting`); when
 * that's null we lazily generate it once via /home/api/greeting, showing a
 * shimmer in the meantime. If generation yields nothing (e.g. the AI call
 * failed), we fall back to a plain welcome so the header is never blank.
 */
export function GreetingHeader({
  initialGreeting,
  name,
  dateLabel,
}: {
  initialGreeting: string | null;
  name: string;
  dateLabel: string;
}) {
  const [greeting, setGreeting] = useState<string | null>(initialGreeting);
  const [loading, setLoading] = useState(initialGreeting === null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (initialGreeting !== null || fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const res = await fetch("/home/api/greeting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tz }),
        });
        const data = (await res.json()) as { greeting: string | null };
        if (!cancelled) setGreeting(data.greeting ?? "");
      } catch {
        if (!cancelled) setGreeting("");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialGreeting]);

  const fallback = `Welcome back, ${name}.`;

  return (
    <header className="mb-8">
      <p className="font-serif text-xs uppercase tracking-[0.2em] text-muted-foreground">
        {dateLabel}
      </p>
      {loading ? (
        <SkeletonLine className="mt-3 h-7 w-2/3 max-w-md" />
      ) : (
        <h1 className="mt-2 font-serif text-2xl leading-snug text-foreground sm:text-3xl">
          {greeting && greeting.length > 0 ? greeting : fallback}
        </h1>
      )}
    </header>
  );
}
