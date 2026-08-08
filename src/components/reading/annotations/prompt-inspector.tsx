"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * What this chat is actually sent, for reading.
 *
 * A debugging surface, and deliberately a plain one: the whole prompt in the
 * order the model receives it, grouped by its four layers, with the novel itself
 * replaced by its size. The reader's own transcript is already on screen behind
 * this, so what it adds is the half of the conversation nobody can otherwise
 * see — who the model was told it is, what this turn was supposed to be, what it
 * was forbidden from saying, and which pieces carry a cache breakpoint.
 *
 * Fetched from the route that shares its builder with the chat itself, so this
 * cannot quietly disagree with what was really sent. See chat-context.ts.
 */

type PromptLayer = "agent" | "brief" | "constraints" | "context";

type PromptSection = {
  layer: PromptLayer;
  title: string;
  text: string;
  cached: boolean;
  chars: number;
  elidedChars: number;
};

type PromptPayload = {
  depth: "fast" | "deep";
  template: string | null;
  /** Which persona this book got — "Literature professor", "Subject teacher". */
  agent: string;
  scoped: boolean;
  model: string;
  openingMessage: string | null;
  sections: PromptSection[];
};

/**
 * What each layer is for, in a line.
 *
 * The layers are the point of this view. Reading a prompt as one wall of text is
 * how it grew four restatements of the same rule in the first place — so the
 * inspector shows the seams, and says what each seam is holding apart.
 */
const LAYERS: { key: PromptLayer; label: string; blurb: string }[] = [
  { key: "agent", label: "Agent", blurb: "Who is talking. Varies by the kind of book." },
  { key: "brief", label: "Brief", blurb: "What this turn is. Varies by surface." },
  {
    key: "constraints",
    label: "Constraints",
    blurb: "What may be said. Spoilers, position, the web, citations.",
  },
  { key: "context", label: "Context", blurb: "What is known. Data rather than instruction." },
];

export function PromptInspector({
  chatId,
  memberEmail,
  open,
  onOpenChange,
}: {
  /**
   * The chat to describe. Never a stand-in id: the link that opens this is
   * hidden until the row exists, because there is nothing on the server to
   * describe until then.
   */
  chatId: string;
  memberEmail: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<PromptPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetched per opening rather than cached: the prompt moves as the reader
  // reads, marks things and has more of these conversations, so a view that
  // answered from a previous opening would be a debugging tool that lies.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    void (async () => {
      try {
        const res = await fetch("/reader/api/chat/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId, memberEmail }),
        });
        if (!res.ok) throw new Error((await res.text()) || "Couldn't load the prompt.");
        const payload = (await res.json()) as PromptPayload;
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load the prompt.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, chatId, memberEmail]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>What this chat is sent</DialogTitle>
          <DialogDescription>
            {/* The agent goes FIRST and in bold: it is the most consequential
                thing about this prompt and the one you cannot check by
                skimming, since the two personas are four sentences each and
                read alike at a glance. */}
            {data ? (
              <>
                <span className="font-medium text-foreground">{data.agent}</span>
                {" · "}
                {[
                  data.template
                    ? data.template === "check_in"
                      ? "Check in"
                      : "How should I read this?"
                    : "Anchored chat",
                  data.model,
                  data.scoped ? "spoiler-scoped" : "whole book",
                ].join(" · ")}
              </>
            ) : (
              "The whole prompt, in the order the model receives it."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {loading && (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Rebuilding the prompt…
            </p>
          )}
          {error && <p className="py-8 text-sm text-destructive">{error}</p>}

          {data?.openingMessage && (
            <section>
              <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Opening message — sent as the reader
              </h3>
              <p className="rounded-md bg-muted px-3 py-2 font-mono text-xs">
                {data.openingMessage}
              </p>
            </section>
          )}

          {data &&
            LAYERS.map(({ key, label, blurb }) => {
              const sections = data.sections.filter((s) => s.layer === key);
              if (sections.length === 0) return null;
              return (
                <section key={key} className="border-t border-border pt-3">
                  <h3 className="text-xs font-semibold text-foreground">{label}</h3>
                  <p className="mb-2 text-[11px] text-muted-foreground">{blurb}</p>
                  <div className="space-y-2">
                    {sections.map((section, i) => (
                      <div key={i}>
                        <p className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{section.title}</span>
                          <span className="opacity-70">
                            {section.chars.toLocaleString("en-US")} chars
                          </span>
                          {/* Which pieces carry a breakpoint decides whether the
                              novel is re-billed on every turn. */}
                          {section.cached && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                              cache breakpoint
                            </span>
                          )}
                        </p>
                        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                          {section.text}
                        </pre>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}

          {data && (
            <p className="pb-2 text-[11px] text-muted-foreground">
              The book text is elided above and sent in full. The model shown is
              what the Fast/Deep pick implies — a book too long for Fast is
              promoted at send time, which is decided per turn.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
