"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, NotebookPen, Users } from "lucide-react";
import { WidgetCard } from "./widget-card";
import { SkeletonLine } from "./widget-skeleton";
import { startEntryWithQuestion } from "@/app/(journal)/journal/actions";
import { JournalNewButton } from "@/components/journal/journal-new-button";
import type {
  HomeJournalAudience,
  HomeJournalSuggestion,
} from "@/lib/home/types";

/**
 * A Home journal widget: "last posted X", then three tapped-to-start opening
 * questions. Tapping a suggestion creates today's entry seeded with that
 * question (in the audience's visibility) and routes into the journal chat; the
 * header action exposes the full new-entry menu. Cached suggestions arrive as
 * `initialSuggestions`; when absent we lazily generate them once via
 * /home/api/journal-suggestions.
 */
export function JournalSuggestionsWidget({
  audience,
  lastPostedLabel,
  initialSuggestions,
}: {
  audience: HomeJournalAudience;
  lastPostedLabel: string;
  initialSuggestions: HomeJournalSuggestion[] | null;
}) {
  const isFamily = audience === "family";
  const [suggestions, setSuggestions] = useState<HomeJournalSuggestion[]>(
    initialSuggestions ?? []
  );
  const [loading, setLoading] = useState(initialSuggestions === null);
  const [error, setError] = useState(false);
  const [startingText, setStartingText] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (initialSuggestions !== null || fetchedRef.current) return;
    fetchedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const res = await fetch("/home/api/journal-suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audience, tz }),
        });
        if (!res.ok) throw new Error("failed");
        const data = (await res.json()) as { suggestions: HomeJournalSuggestion[] };
        if (!cancelled) setSuggestions(data.suggestions ?? []);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audience, initialSuggestions]);

  function handleStart(suggestion: HomeJournalSuggestion) {
    if (startingText) return;
    setStartingText(suggestion.text);
    startTransition(async () => {
      try {
        const entryId = await startEntryWithQuestion(
          suggestion.text,
          suggestion.visibility
        );
        router.push(`/journal/new?entry=${entryId}`);
      } catch {
        setStartingText(null);
      }
    });
  }

  return (
    <WidgetCard
      title={isFamily ? "Family journal" : "Personal journal"}
      icon={isFamily ? Users : NotebookPen}
      href={isFamily ? "/family" : "/journal"}
      action={
        <JournalNewButton audience={isFamily ? "family" : "personal"} />
      }
    >
      <p className="text-xs text-muted-foreground">{lastPostedLabel}</p>

      <div className="mt-3 space-y-2">
        {loading ? (
          <>
            <SkeletonLine className="h-10 w-full" />
            <SkeletonLine className="h-10 w-full" />
            <SkeletonLine className="h-10 w-full" />
          </>
        ) : error ? (
          <p className="py-2 text-sm text-muted-foreground">
            Couldn&apos;t load suggestions right now.
          </p>
        ) : suggestions.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No suggestions right now.
          </p>
        ) : (
          suggestions.map((s, i) => {
            const starting = startingText === s.text;
            return (
              <button
                key={i}
                type="button"
                onClick={() => handleStart(s)}
                disabled={startingText !== null}
                className="flex w-full items-start gap-2 rounded-lg border border-muted px-3 py-2.5 text-left font-serif text-sm leading-snug text-foreground transition-colors hover:border-foreground/40 hover:bg-muted/40 disabled:opacity-50"
              >
                {starting && (
                  <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
                )}
                <span>{s.text}</span>
              </button>
            );
          })
        )}
      </div>
    </WidgetCard>
  );
}
