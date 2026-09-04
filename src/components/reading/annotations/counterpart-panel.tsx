"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { BookBlock } from "@/lib/reading/block-stream";
import type { PlainBlock } from "@/lib/reading/plain/types";

/**
 * The passage you selected, in the other face.
 *
 * Reading in the original and want to know what a paragraph is saying? This
 * shows its plain English. Reading in plain and want the author's words? This
 * shows them. Always whole paragraphs — the ones the selection touched — with
 * the header saying which face this is.
 *
 * A peek, not a mark: nothing is written to the margin. In a book with no
 * translation the plain paragraphs are made on demand and kept, so the next
 * peek at them is instant and a later whole-book run skips them.
 */
export type CounterpartRequest = {
  /** Half-open block range the selection touched. */
  from: number;
  to: number;
  /** The face to SHOW — the opposite of the one being read. */
  show: "original" | "plain";
  /** Where the selection was, for a light mark on the shown text. */
  selected: string | null;
};

export function CounterpartPanel({
  bookId,
  request,
  blocks,
  known,
  onClose,
  dockToggle,
}: {
  bookId: string;
  request: CounterpartRequest;
  /** The book's original blocks. */
  blocks: BookBlock[];
  /** Plain paragraphs the reader already holds, by block index. */
  known: ReadonlyMap<number, PlainBlock>;
  onClose: () => void;
  dockToggle?: React.ReactNode;
}) {
  const [plain, setPlain] = useState<Map<number, PlainBlock> | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const originals = blocks.slice(request.from, request.to).filter((b) => b.tag === "p");

  // Fetch the plain face when it is the one to show and any paragraph is
  // missing from what the reader already holds.
  useEffect(() => {
    if (request.show !== "plain") return;
    const missing = originals.some((b) => !known.has(b.index));
    if (!missing) {
      setPlain(new Map(originals.map((b) => [b.index, known.get(b.index)!])));
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(null);
    const run = async () => {
      // A peek that lands on a claim another tap holds answers "preparing";
      // ask again shortly rather than paying twice.
      for (let tries = 0; tries < 40; tries++) {
        const res = await fetch(`/reader/api/plain/${bookId}/blocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: request.from, to: request.to }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          status?: string;
          blocks?: PlainBlock[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "Couldn't translate this passage.");
        if (body.status === "ready" && body.blocks) {
          setPlain(new Map(body.blocks.map((b) => [b.index, b])));
          setStatus("idle");
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      throw new Error("This passage is taking too long to translate.");
    };
    run().catch((err) => {
      if (cancelled) return;
      setStatus("failed");
      setError(err instanceof Error ? err.message : "Couldn't translate this passage.");
    });
    return () => {
      cancelled = true;
    };
    // `originals` is derived from request+blocks; keying on those keeps the
    // effect honest without a fresh array identity re-firing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, request.from, request.to, request.show, known, attempt]);

  const title = request.show === "plain" ? "In plain English" : "The author's words";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
        {dockToggle}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div
        // Same serif as the book in both faces; the header says which this is.
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4 font-serif text-[15px] leading-7 text-foreground"
      >
        {request.show === "original" &&
          originals.map((b) => (
            <p key={b.index} className="mb-4">
              <Marked text={b.text} selected={null} />
            </p>
          ))}
        {request.show === "plain" && status === "loading" && (
          <p className="flex items-center gap-2 font-sans text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Translating this passage…
          </p>
        )}
        {request.show === "plain" && status === "failed" && (
          <div className="font-sans text-sm text-muted-foreground">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-2 rounded-md border border-border px-2.5 py-1 text-foreground hover:bg-muted"
            >
              Try again
            </button>
          </div>
        )}
        {request.show === "plain" &&
          status === "idle" &&
          plain &&
          originals.map((b) => {
            const p = plain.get(b.index);
            return (
              <p key={b.index} className="mb-4">
                <Marked text={p && !p.kept && p.text ? p.text : b.text} selected={request.selected} />
              </p>
            );
          })}
      </div>
    </div>
  );
}

/** A paragraph with the reader's selection lightly marked, when it occurs in it. */
function Marked({ text, selected }: { text: string; selected: string | null }) {
  if (!selected) return <>{text}</>;
  const at = text.indexOf(selected);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-foreground/10 text-inherit">{selected}</mark>
      {text.slice(at + selected.length)}
    </>
  );
}
