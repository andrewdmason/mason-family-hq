"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  FileText,
  Loader2,
  MessageSquareQuote,
  PencilLine,
  Repeat,
} from "lucide-react";
import { TypingIndicator } from "@/components/journal/typing-indicator";
import {
  pickOpeningQuestion,
  saveQuoteEntry,
  saveRecapEntry,
  startFreeformEntry,
} from "@/app/(journal)/journal/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { normalizeCandidates, typeLabel } from "@/lib/journal/candidates";
import {
  MAX_UPLOAD_BYTES,
  detectMediaType,
  formatBytes,
  uploadJournalMedia,
} from "@/lib/journal/photo-upload";
import type { JournalOpeningCandidate } from "@/lib/types";

// Default recap title seeds the current month, e.g. "May Chatbot Recap". The
// user edits it if they're pasting a recap for a different month.
function defaultRecapTitle(): string {
  const month = new Date().toLocaleString("en-US", { month: "long" });
  return `${month} Chatbot Recap`;
}

export function OpeningPicker({
  entryId,
  initialCandidates,
  initialRerollCount,
  questionTypeNames = [],
  recurringTypeNames = [],
  initialMode,
  forcedType,
}: {
  entryId: string;
  initialCandidates: JournalOpeningCandidate[] | null;
  initialRerollCount: number;
  questionTypeNames?: string[];
  /** The user's recurring-post types, surfaced as their own one-tap triggers so
   * a recurring post can be started here on demand (not only when it's due). */
  recurringTypeNames?: string[];
  /** Deep-link the picker straight into one way to start (from the header's
   * "New ▾" menu). "freeform" auto-starts a blog entry on mount; "quote" and
   * "recap" open their compose form directly. */
  initialMode?: "freeform" | "quote" | "recap";
  /** Deep-link from a recurring post's "due" notification: generate the opening
   * questions in this one type on mount, instead of the usual varied set. */
  forcedType?: string;
}) {
  const [candidates, setCandidates] = useState<JournalOpeningCandidate[]>(() =>
    normalizeCandidates(initialCandidates)
  );
  const [rerollCount, setRerollCount] = useState(initialRerollCount);
  const [loading, setLoading] = useState(candidates.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [mode, setMode] = useState<"pick" | "quote" | "recap">(
    initialMode === "quote" || initialMode === "recap" ? initialMode : "pick"
  );
  // True while a deep-linked "write freely" start is in flight, so we show a
  // loader instead of flashing the question picker before the composer loads.
  const [autoFreeform, setAutoFreeform] = useState(initialMode === "freeform");
  const [quoteText, setQuoteText] = useState("");
  const [attribution, setAttribution] = useState("");
  const [savingQuote, setSavingQuote] = useState(false);
  const [recapTitle, setRecapTitle] = useState(defaultRecapTitle);
  const [recapBody, setRecapBody] = useState("");
  const [savingRecap, setSavingRecap] = useState(false);
  const [startingWithPhoto, setStartingWithPhoto] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const initialLoadRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // On mount, either honor a deep-linked start mode or fetch the opening
  // questions. Freeform auto-starts; quote/recap open straight into their
  // compose form (no questions needed); otherwise fetch candidates if absent.
  useEffect(() => {
    if (initialLoadRef.current) return;
    initialLoadRef.current = true;
    if (initialMode === "freeform") {
      handleWriteFreely();
      return;
    }
    if (initialMode === "quote" || initialMode === "recap") return;
    // A recurring post's notification forces the whole opening set into one type.
    if (forcedType) {
      void fetchCandidates("/journal/api/regenerate-opening", {
        categoryName: forcedType,
      });
      return;
    }
    if (candidates.length > 0) return;
    void fetchCandidates("/journal/api/opening-candidates");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stagger the cards in whenever a fresh set arrives.
  useEffect(() => {
    if (candidates.length === 0) return;
    setShown(false);
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [candidates]);

  async function fetchCandidates(url: string, extra?: { categoryName?: string }) {
    setLoading(true);
    setError(null);
    try {
      // Send the browser's timezone so date reasoning doesn't depend on the tz
      // cookie, which the provider only writes after mount (and child effects
      // run first) — on a fresh session it'd otherwise fall back to UTC and
      // mislabel this evening's events as "yesterday".
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, tz, ...extra }),
      });
      if (!res.ok) {
        setError((await res.text().catch(() => "")) || "request failed");
        return;
      }
      const data = (await res.json()) as {
        candidates: JournalOpeningCandidate[];
        rerollCount: number;
      };
      // Hide before swapping so the new set animates in cleanly.
      setShown(false);
      setCandidates(data.candidates);
      setRerollCount(data.rerollCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleReroll() {
    if (loading || picked) return;
    void fetchCandidates("/journal/api/regenerate-opening");
  }

  function handleAskSpecific(categoryName: string) {
    if (loading || picked) return;
    void fetchCandidates("/journal/api/regenerate-opening", { categoryName });
  }

  function handlePick(question: string) {
    if (loading || picked) return;
    setPicked(question);
    setError(null);
    startTransition(async () => {
      try {
        await pickOpeningQuestion(entryId, question);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPicked(null);
      }
    });
  }

  function handleWriteFreely() {
    if (picked) return;
    setError(null);
    startTransition(async () => {
      try {
        await startFreeformEntry(entryId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        // Drop back to the picker so the error (and the other options) show.
        setAutoFreeform(false);
      }
    });
  }

  async function handlePhotoFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file || picked || startingWithPhoto) return;
    const mediaType = detectMediaType(file);
    if (!mediaType) {
      setError("Choose a photo or video file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `“${file.name}” is ${formatBytes(file.size)} — files must be under ${formatBytes(
          MAX_UPLOAD_BYTES
        )}.`
      );
      return;
    }

    setStartingWithPhoto(true);
    setError(null);
    try {
      await uploadJournalMedia(entryId, file);
      await startFreeformEntry(entryId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStartingWithPhoto(false);
    }
  }

  function handleSaveQuote() {
    const quote = quoteText.trim();
    if (!quote || savingQuote) return;
    setSavingQuote(true);
    setError(null);
    startTransition(async () => {
      try {
        await saveQuoteEntry(entryId, quote, attribution);
        router.push(`/journal/${entryId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSavingQuote(false);
      }
    });
  }

  function handleSaveRecap() {
    const body = recapBody.trim();
    if (!body || savingRecap) return;
    setSavingRecap(true);
    setError(null);
    startTransition(async () => {
      try {
        await saveRecapEntry(entryId, recapTitle, body);
        router.push(`/journal/${entryId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSavingRecap(false);
      }
    });
  }

  // Deep-linked "write freely": hold a quiet loader until the freeform start
  // lands and the page swaps in the composer (or an error drops us back).
  if (autoFreeform && !error) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 items-center justify-center px-6 pb-24 pt-12 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-label="Starting…" />
      </div>
    );
  }

  // Recap-compose mode: paste a monthly chatbot recap (markdown) with an
  // editable title. No question, no follow-ups, no wrap pass.
  if (mode === "recap") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-24 pt-12">
        <p className="font-serif text-sm uppercase tracking-[0.2em] text-muted-foreground">
          paste a chatbot recap
        </p>

        <div className="mt-8 flex-1">
          <input
            type="text"
            value={recapTitle}
            onChange={(e) => setRecapTitle(e.target.value)}
            placeholder="title"
            disabled={savingRecap}
            className="w-full rounded-lg border border-muted bg-transparent px-5 py-3 font-serif text-lg leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-foreground/40 focus:outline-none disabled:opacity-50"
          />
          <textarea
            autoFocus
            value={recapBody}
            onChange={(e) => setRecapBody(e.target.value)}
            placeholder="paste your monthly recap…"
            rows={14}
            disabled={savingRecap}
            className="mt-4 w-full resize-none rounded-lg border border-muted bg-transparent px-5 py-4 font-serif text-base leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-foreground/40 focus:outline-none disabled:opacity-50"
          />
        </div>

        {error && (
          <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="mt-10 flex items-center gap-x-5">
          <button
            type="button"
            onClick={handleSaveRecap}
            disabled={!recapBody.trim() || savingRecap}
            className="font-serif text-sm text-foreground underline-offset-4 hover:underline disabled:opacity-40 disabled:hover:no-underline"
          >
            {savingRecap ? "saving…" : "save recap"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (savingRecap) return;
              setMode("pick");
              setError(null);
            }}
            disabled={savingRecap}
            className="font-serif text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40"
          >
            cancel
          </button>
        </div>
      </div>
    );
  }

  // Quote-compose mode: a frictionless capture with no question, no follow-ups.
  if (mode === "quote") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-24 pt-12">
        <p className="font-serif text-sm uppercase tracking-[0.2em] text-muted-foreground">
          save a quote
        </p>

        <div className="mt-8 flex-1">
          <textarea
            autoFocus
            value={quoteText}
            onChange={(e) => setQuoteText(e.target.value)}
            placeholder="the quote…"
            rows={4}
            disabled={savingQuote}
            className="w-full resize-none rounded-lg border border-muted bg-transparent px-5 py-4 font-serif text-lg leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-foreground/40 focus:outline-none disabled:opacity-50"
          />
          <input
            type="text"
            value={attribution}
            onChange={(e) => setAttribution(e.target.value)}
            placeholder="— who / context (optional)"
            disabled={savingQuote}
            className="mt-4 w-full rounded-lg border border-muted bg-transparent px-5 py-3 font-serif text-base leading-relaxed text-muted-foreground placeholder:text-muted-foreground/60 focus:border-foreground/40 focus:outline-none disabled:opacity-50"
          />
        </div>

        {error && (
          <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="mt-10 flex items-center gap-x-5">
          <button
            type="button"
            onClick={handleSaveQuote}
            disabled={!quoteText.trim() || savingQuote}
            className="font-serif text-sm text-foreground underline-offset-4 hover:underline disabled:opacity-40 disabled:hover:no-underline"
          >
            {savingQuote ? "saving…" : "save quote"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (savingQuote) return;
              setMode("pick");
              setError(null);
            }}
            disabled={savingQuote}
            className="font-serif text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40"
          >
            cancel
          </button>
        </div>
      </div>
    );
  }

  if (picked) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-24 pt-12">
        <p className="font-serif text-lg leading-relaxed text-foreground">
          {picked}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-24 pt-12">
      <p className="font-serif text-sm uppercase tracking-[0.2em] text-muted-foreground">
        pick a question
      </p>

      <div className="mt-8 flex-1">
        {loading && candidates.length === 0 ? (
          <TypingIndicator />
        ) : (
          <ul className="space-y-4">
            {candidates.map((c, i) => {
              const label = typeLabel(c.type);
              return (
                <li key={`${rerollCount}-${i}`}>
                  <button
                    type="button"
                    onClick={() => handlePick(c.text)}
                    disabled={loading}
                    style={{ transitionDelay: `${i * 90}ms` }}
                    className={
                      "w-full rounded-lg border border-muted px-5 py-4 text-left transition-all duration-500 hover:border-foreground/40 hover:bg-muted/40 disabled:opacity-50 " +
                      (shown
                        ? "translate-y-0 opacity-100"
                        : "translate-y-1 opacity-0")
                    }
                  >
                    {label && (
                      <span className="mb-1.5 block font-serif text-[0.7rem] uppercase tracking-[0.15em] text-muted-foreground">
                        {label}
                      </span>
                    )}
                    <span className="font-serif text-lg leading-relaxed text-foreground">
                      {c.text}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
          {candidates.length === 0 && !loading && error ? (
            <button
              type="button"
              onClick={() => void fetchCandidates("/journal/api/opening-candidates")}
              className="font-serif text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              try again
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleReroll}
                disabled={loading}
                className="font-serif text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40 disabled:hover:no-underline"
              >
                {loading
                  ? "thinking…"
                  : candidates.length === 1
                    ? "show me a different question"
                    : "show me a different set"}
              </button>
              {questionTypeNames.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        disabled={loading}
                        className="font-serif text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-40 disabled:hover:no-underline"
                      />
                    }
                  >
                    ask me about something else
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="bottom"
                    align="start"
                    className="max-h-72 w-56 overflow-y-auto"
                  >
                    {questionTypeNames.map((name) => (
                      <DropdownMenuItem
                        key={name}
                        onClick={() => handleAskSpecific(name)}
                        className="font-serif"
                      >
                        {typeLabel(name)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </>
          )}
        </div>
        {recurringTypeNames.length > 0 && (
          <div className="mt-10">
            <p className="font-serif text-sm uppercase tracking-[0.2em] text-muted-foreground">
              recurring posts
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {recurringTypeNames.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => handleAskSpecific(name)}
                  disabled={loading || !!picked}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-muted px-4 py-2.5 text-left font-serif text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
                >
                  <Repeat className="size-4 shrink-0" aria-hidden />
                  <span className="leading-snug">{typeLabel(name)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="mt-10 font-serif text-sm uppercase tracking-[0.2em] text-muted-foreground">
          start another way
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleWriteFreely}
            disabled={!!picked}
            className="flex min-h-16 items-center gap-3 rounded-lg border border-dashed border-muted px-4 py-3 text-left font-serif text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
          >
            <PencilLine className="size-4 shrink-0" aria-hidden />
            <span className="text-lg leading-snug">Start with your own words</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => {
              void handlePhotoFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!!picked || startingWithPhoto}
            className="flex min-h-16 items-center gap-3 rounded-lg border border-dashed border-muted px-4 py-3 text-left font-serif text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
          >
            {startingWithPhoto ? (
              <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
            ) : (
              <Camera className="size-4 shrink-0" aria-hidden />
            )}
            <span className="text-lg leading-snug">Start with a photo</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (picked) return;
              setError(null);
              setMode("quote");
            }}
            disabled={!!picked}
            className="flex min-h-16 items-center gap-3 rounded-lg border border-dashed border-muted px-4 py-3 text-left font-serif text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
          >
            <MessageSquareQuote className="size-4 shrink-0" aria-hidden />
            <span className="text-lg leading-snug">Save a quote</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (picked) return;
              setError(null);
              setMode("recap");
            }}
            disabled={!!picked}
            className="flex min-h-16 items-center gap-3 rounded-lg border border-dashed border-muted px-4 py-3 text-left font-serif text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-50"
          >
            <FileText className="size-4 shrink-0" aria-hidden />
            <span className="text-lg leading-snug">Paste a chatbot recap</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}
