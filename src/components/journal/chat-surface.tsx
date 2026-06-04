"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Send } from "lucide-react";
import { TypingIndicator } from "@/components/journal/typing-indicator";
import { FinishPostDialog } from "@/components/journal/finish-post-dialog";
import {
  appendUserMessage,
  closeEntry,
  deleteLatestQuestion,
  setEntryVisibility,
} from "@/app/(journal)/journal/actions";
import {
  TIMER_DONE_COLOR,
  useJournalTimer,
} from "@/components/journal/timer-context";
import type { JournalMessageRole, JournalVisibility } from "@/lib/types";

type Msg = { role: JournalMessageRole; content: string };

export function ChatSurface({
  entryId,
  initialStatus,
  initialVisibility = "private",
  initialMessages,
  viewMode = "today",
  timerStartedAt = null,
  readOnly = false,
}: {
  entryId: string;
  initialStatus: "open" | "closed";
  /** The entry's current visibility, used to seed the finish-post choice. */
  initialVisibility?: JournalVisibility;
  initialMessages: Msg[];
  /**
   * "today" — the in-progress entry flow at /journal/new.
   * "history" — a past entry; closed state shows the full transcript only
   * (editing happens through the post's "Edit" menu). Open state behaves the
   * same in both.
   */
  viewMode?: "today" | "history";
  /**
   * ISO timestamp the zen timer is anchored to (the opening question's
   * created_at). Wall-clock based, so the timer's progress and completion
   * survive refreshes.
   */
  timerStartedAt?: string | null;
  /**
   * A family member reading another member's shared entry: show the transcript
   * only — no reply box, no edit controls (writes are theirs alone).
   */
  readOnly?: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [closing, setClosing] = useState(false);
  const [status] = useState<"open" | "closed">(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [hasUnsentReply, setHasUnsentReply] = useState(false);
  // After the five-minute mark, the writer can ask for one more question at a
  // time. This is true while that single extra question is awaiting an answer:
  // the end glyph steps aside, and once the writer replies it's saved without
  // a follow-up — the glyph returns, so each additional question is a fresh,
  // deliberate ask rather than an open-ended back-and-forth.
  const [pendingFollowup, setPendingFollowup] = useState(false);
  const [finishDialogOpen, setFinishDialogOpen] = useState(false);
  const [selectedVisibility, setSelectedVisibility] =
    useState<JournalVisibility>(initialVisibility);

  const router = useRouter();
  const {
    begin: beginTimer,
    stop: stopTimer,
    done: timerDone,
    running: timerRunning,
    degrees: timerDegrees,
  } = useJournalTimer();
  const isHistoryClosed = status === "closed" && viewMode === "history";
  const showWritingControls = !readOnly && !isHistoryClosed;
  // A finished post being read (a shared entry, or a closed entry in history)
  // is view-only: open it at the top like any article, never jump to the end.
  const isViewingOnly = readOnly || isHistoryClosed;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Whether the reader is sitting at the bottom of the page. We only follow new
  // content when they already are — otherwise scrolling up to re-read an earlier
  // turn gets yanked back down by the next streamed token. Appending content
  // never fires a scroll event and the programmatic scroll below only moves
  // toward the bottom, so the only thing that un-pins is the user scrolling up.
  const pinnedToBottom = useRef(true);

  useEffect(() => {
    const updatePinned = () => {
      const distanceFromBottom =
        document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      pinnedToBottom.current = distanceFromBottom < 120;
    };
    updatePinned();
    window.addEventListener("scroll", updatePinned, { passive: true });
    return () => window.removeEventListener("scroll", updatePinned);
  }, []);

  // Follow new content only while pinned to the bottom — and never in a
  // view-only post, which should open at the top.
  useEffect(() => {
    if (isViewingOnly || !pinnedToBottom.current) return;
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming, isViewingOnly]);

  // Anchor the zen timer to the opening question's timestamp. beginTimer is
  // idempotent for the same anchor, so it's safe to call on every render.
  useEffect(() => {
    if (viewMode !== "today" || status !== "open") return;
    if (!timerStartedAt) return;
    beginTimer(Date.parse(timerStartedAt));
  }, [viewMode, status, timerStartedAt, beginTimer]);

  // The timer belongs to an in-progress today entry only. Clear it when the
  // entry closes or this surface unmounts (e.g. navigating to history).
  useEffect(() => {
    if (status === "closed") stopTimer();
    return () => stopTimer();
  }, [status, stopTimer]);

  // Read a streamed text response, appending each chunk to the trailing
  // (empty) assistant slot reserved by the caller.
  async function pumpStream(res: Response) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let firstChunk = true;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (firstChunk) {
        setThinking(false);
        firstChunk = false;
      }
      setMessages((m) => {
        const next = [...m];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = { role: "assistant", content: last.content + chunk };
        }
        return next;
      });
    }
  }

  async function streamReply(userMessage: string) {
    setError(null);
    setThinking(true);
    setStreaming(true);
    // Reserve an empty assistant slot we'll fill as the stream arrives
    setMessages((m) => [...m, { role: "assistant", content: "" }]);
    try {
      const res = await fetch("/journal/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, userMessage }),
      });
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "request failed");
        setError(txt);
        // Remove the empty assistant slot we reserved
        setMessages((m) => {
          const next = [...m];
          if (next.length > 0 && next[next.length - 1].role === "assistant" && next[next.length - 1].content === "") {
            next.pop();
          }
          return next;
        });
        return;
      }
      await pumpStream(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming(false);
      setThinking(false);
    }
  }

  // Swap the latest question for a fresh one. Clears the question text in
  // place, streams a replacement, and restores the original if it fails.
  async function handleRegenerate() {
    if (streaming || thinking || closing) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const rejected = last.content;

    setError(null);
    setThinking(true);
    setStreaming(true);
    setMessages((m) => {
      const next = [...m];
      next[next.length - 1] = { role: "assistant", content: "" };
      return next;
    });
    try {
      const res = await fetch("/journal/api/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "request failed");
        setError(txt);
        setMessages((m) => {
          const next = [...m];
          next[next.length - 1] = { role: "assistant", content: rejected };
          return next;
        });
        return;
      }
      await pumpStream(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages((m) => {
        const next = [...m];
        const lastM = next[next.length - 1];
        if (lastM && lastM.role === "assistant" && lastM.content === "") {
          next[next.length - 1] = { role: "assistant", content: rejected };
        }
        return next;
      });
    } finally {
      setStreaming(false);
      setThinking(false);
    }
  }

  // Remove the trailing question entirely — for questions left unanswered
  // (e.g. the timer ran out before the user replied).
  async function handleDeleteQuestion() {
    if (streaming || thinking || closing) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const previous = messages;

    setError(null);
    setMessages((m) => m.slice(0, -1));
    // Dismissing the one-more question returns the surface to rest.
    setPendingFollowup(false);
    try {
      await deleteLatestQuestion(entryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages(previous);
    }
  }

  // Past the five-minute mark, ask the interviewer for exactly one more
  // question off the thread as it stands. The answer to it is saved without a
  // follow-up (see handleSubmit), so the conversation returns to rest until
  // the writer asks again.
  async function streamContinue() {
    if (streaming || thinking || closing) return;
    setPendingFollowup(true);
    setError(null);
    setThinking(true);
    setStreaming(true);
    // If the conversation ended on an unanswered question, the server replaces
    // it; reuse that slot. Otherwise reserve a fresh assistant slot to fill.
    const last = messages[messages.length - 1];
    const replaceLast = last && last.role === "assistant" && last.content.trim().length > 0;
    const restore = messages;
    setMessages((m) => {
      if (replaceLast) {
        const next = [...m];
        next[next.length - 1] = { role: "assistant", content: "" };
        return next;
      }
      return [...m, { role: "assistant", content: "" }];
    });
    try {
      const res = await fetch("/journal/api/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId }),
      });
      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => "request failed");
        setError(txt);
        setMessages(restore);
        setPendingFollowup(false);
        return;
      }
      await pumpStream(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages(restore);
      setPendingFollowup(false);
    } finally {
      setStreaming(false);
      setThinking(false);
    }
  }

  // Once the timer is done the conversation is over: the user's words are
  // still saved, but the interviewer is no longer asked to respond.
  async function appendReply(text: string) {
    try {
      await appendUserMessage(entryId, text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleSubmit(text: string) {
    if (!text || streaming || closing) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    if (timerDone) {
      // Past the timer the interviewer never volunteers a follow-up: the reply
      // is saved, and answering the one-more question (if any) returns the
      // surface to rest so the glyph reappears.
      void appendReply(text);
      setPendingFollowup(false);
    } else {
      void streamReply(text);
    }
  }

  // Closing flips the entry to "closed" right away, then kicks off the wrap
  // pass (summary/title/pull_quote) in the background and hands off to the
  // journal list, where the entry appears with its AI fields generating.
  async function handleClose(visibility: JournalVisibility) {
    if (closing || streaming || messages.length === 0) return;
    setClosing(true);
    setError(null);
    try {
      await setEntryVisibility(entryId, visibility);
      await closeEntry(entryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setClosing(false);
      return;
    }
    setFinishDialogOpen(false);
    // Fire-and-forget: the wrap writes summary/title to the DB on its own. We
    // navigate away without waiting; the list polls until the fields land.
    void fetch("/journal/api/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId }),
    }).catch((err) => console.error("[journal] wrap request failed:", err));
    router.push("/journal");
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pb-24 pt-12">
      {showWritingControls && (
        <div className="mb-8 flex justify-end">
          <button
            type="button"
            onClick={() => setFinishDialogOpen(true)}
            disabled={closing || streaming || messages.length === 0}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-3 font-serif text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground disabled:opacity-40"
          >
            {timerRunning && !timerDone ? (
              <span
                aria-hidden
                className="h-4 w-4 rounded-full shadow-[0_0_0_1px_var(--muted)]"
                style={{
                  background: `conic-gradient(oklch(0.68 0.02 50) ${timerDegrees}deg, var(--muted) 0deg)`,
                }}
              />
            ) : (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            )}
            {closing ? "Wrapping..." : "Finish post"}
          </button>
          <FinishPostDialog
            open={finishDialogOpen}
            onOpenChange={(open) => {
              if (!closing) setFinishDialogOpen(open);
            }}
            selectedVisibility={selectedVisibility}
            onSelectedVisibilityChange={setSelectedVisibility}
            hasUnsentReply={hasUnsentReply}
            closing={closing}
            onFinish={() => void handleClose(selectedVisibility)}
          />
        </div>
      )}
      <div className="flex-1 space-y-6 font-serif text-lg leading-relaxed">
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          // The regenerate icon swaps the current question for a different
          // one. It's offered only on a live follow-up question — the last
          // assistant turn, before it's answered. The opening question (i=0)
          // is excluded since it was already chosen from the picker, and it's
          // hidden once the timer elapses and the agent stops asking.
          // Delete removes the trailing question — useful when the timer ran
          // out before the user answered. Available whenever regenerate is,
          // plus after the timer (when the agent has stopped asking).
          const isLiveQuestion =
            isLast &&
            i > 0 &&
            m.role === "assistant" &&
            status === "open" &&
            !streaming &&
            !thinking &&
            !closing &&
            m.content.trim().length > 0;
          const canRegenerate = isLiveQuestion && (!timerDone || pendingFollowup);
          const canDelete = isLiveQuestion;
          return (
            <div
              key={i}
              className={
                m.role === "assistant"
                  ? "group italic text-muted-foreground pl-6 border-l-2 border-muted"
                  : "text-foreground"
              }
            >
              <p className="whitespace-pre-wrap">
                {m.content}
                {(canRegenerate || canDelete) && (
                  <span className="ml-1.5 inline-flex translate-y-[0.15em] gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    {canRegenerate && (
                      <button
                        type="button"
                        onClick={handleRegenerate}
                        aria-label="Ask a different question"
                        title="Ask a different question"
                        className="inline-flex text-muted-foreground/40 transition-colors hover:text-foreground"
                      >
                        <RegenerateIcon />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={handleDeleteQuestion}
                        aria-label="Delete this question"
                        title="Delete this question"
                        className="inline-flex text-muted-foreground/40 transition-colors hover:text-destructive"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </span>
                )}
              </p>
            </div>
          );
        })}
        {thinking && messages.length > 0 && messages[messages.length - 1].content === "" && (
          <TypingIndicator />
        )}
        {timerDone && !isHistoryClosed && !pendingFollowup && (
          <div className="flex justify-center pt-2">
            {showWritingControls ? (
              <KeepGoingGlyph
                onClick={() => void streamContinue()}
                disabled={streaming || thinking || closing}
              />
            ) : (
              <ConversationEndGlyph />
            )}
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {error && (
        <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
          {error}
        </div>
      )}

      {/* A closed history entry shows just the transcript — editing the title
          or any message happens through the post's overflow menu ("Edit"). */}
      {readOnly || isHistoryClosed ? null : (
        <ReplyBox
          active={status === "open" && !streaming && !closing}
          disabled={streaming || closing}
          streaming={streaming}
          placeholder={
            messages.length === 0
              ? "start writing…"
              : timerDone && !pendingFollowup
                ? "keep writing if you like…"
                : "type a reply…"
          }
          onSubmit={handleSubmit}
          onDraftPresenceChange={setHasUnsentReply}
        />
      )}
    </div>
  );
}

/**
 * Isolated reply input. Keeps `draft` state local so keystrokes only
 * re-render this small subtree, not the message transcript above it —
 * which otherwise blocks the main thread and tanks INP.
 */
function ReplyBox({
  active,
  disabled,
  streaming,
  placeholder,
  onSubmit,
  onDraftPresenceChange,
}: {
  active: boolean;
  disabled: boolean;
  streaming: boolean;
  placeholder: string;
  onSubmit: (text: string) => void;
  onDraftPresenceChange: (hasDraft: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasDraft = draft.trim().length > 0;

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  // Keep the reply box focused on mount and after streaming ends.
  useEffect(() => {
    if (active) textareaRef.current?.focus();
  }, [active]);

  function submit() {
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft("");
    onDraftPresenceChange(false);
    onSubmit(text);
  }

  function updateDraft(next: string) {
    setDraft(next);
    onDraftPresenceChange(next.trim().length > 0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="mt-12 flex flex-col gap-3">
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => updateDraft(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        rows={1}
        placeholder={placeholder}
        className="min-h-10 w-full resize-none overflow-hidden border-0 bg-transparent py-1 font-serif text-lg leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
      />
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !hasDraft}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-foreground px-4 font-serif text-sm text-background transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-30"
        >
          <Send className="h-4 w-4" aria-hidden />
          Send
        </button>
        <span className="text-xs text-muted-foreground">
          {streaming ? "" : hasDraft ? "⌘+enter to send · enter for newline" : ""}
        </span>
      </div>
    </div>
  );
}

// The interactive end mark on the writer's own in-progress entry. At rest
// it's the same quiet green dot that closes the transcript; on hover or focus
// it morphs into a pill inviting one more question. Clicking it asks the
// interviewer to pick the conversation back up.
function KeepGoingGlyph({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Ask one more question"
      title="Ask one more question"
      className="group inline-flex items-center rounded-full border border-transparent py-1 pl-1 pr-1 font-serif text-sm italic text-muted-foreground transition-[background-color,border-color,padding] duration-300 ease-out hover:border-border hover:bg-muted/40 hover:pr-3 focus-visible:border-border focus-visible:bg-muted/40 focus-visible:pr-3 focus-visible:outline-none disabled:opacity-40"
    >
      <span
        aria-hidden
        className="h-[10px] w-[10px] shrink-0 rounded-full transition-transform duration-300 group-hover:scale-110"
        style={{ background: TIMER_DONE_COLOR }}
      />
      <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-300 ease-out group-hover:grid-cols-[1fr] group-focus-visible:grid-cols-[1fr]">
        <span className="overflow-hidden whitespace-nowrap pl-0 opacity-0 transition-[padding,opacity] duration-300 group-hover:pl-2 group-hover:opacity-100 group-focus-visible:pl-2 group-focus-visible:opacity-100">
          Ask one more question
        </span>
      </span>
    </button>
  );
}

// A small filled mark that echoes the completed zen timer — it stands at the
// end of the transcript once the five minutes are up to show the
// conversation is over and the interviewer has signed off.
function ConversationEndGlyph() {
  return (
    <div
      aria-hidden
      title="Five minutes done — the conversation is complete."
      className="h-[10px] w-[10px] rounded-full"
      style={{ background: TIMER_DONE_COLOR }}
    />
  );
}

function RegenerateIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}
