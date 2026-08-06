"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownLeft, Loader2, RotateCcw, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AnnotationDetail,
  ReaderChatMessage,
  ReaderChatModelPreference,
} from "@/lib/reading/annotation-types";
import { chapterSummaryQuestion } from "@/lib/reading/chapter-summary";
import { chapterName } from "@/lib/reading/chapter-target";
import { useIsOnline } from "@/lib/reading/offline/use-is-online";
import { ChatMessageText } from "./chat-message-text";

/** The route marks a failed turn this way rather than persisting a message. */
const ERROR_MARKER = /\n\n\[error: ([\s\S]*)\]$/;

let localSeq = 0;
const localId = () => `local-${++localSeq}`;

/**
 * Drain a reply into the thread as it arrives, and return the error a broken
 * stream ends with — or null if it finished.
 *
 * Shared by the reader's questions and by the chapter summary, which are
 * answered by different routes but must behave identically once the bytes start
 * moving: same incremental render, same reading of the failure marker. Two
 * copies of this loop would eventually disagree about the second one.
 */
async function streamReply(
  body: ReadableStream<Uint8Array>,
  onText: (soFar: string) => void
): Promise<string | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    onText(acc);
  }
  // A stream that failed mid-flight carries the marker instead of ending
  // cleanly; the caller surfaces it as an error rather than as something Claude
  // said.
  return acc.match(ERROR_MARKER)?.[1] ?? null;
}

export function AnnotationThread({
  chat,
  chapterTitle = null,
  memberEmail,
  bookSpoilerFree,
  isArticle,
  onNoteChange,
  hasRealPages,
  currentPage,
  labelForPage,
  onJumpToPage,
  onFork,
  onDelete,
  onClose,
  onTouched,
  onExchangeComplete,
  onSpoilerFreeChange,
  onModelChange,
  resolveChatId,
  createError = null,
  dockToggle,
}: {
  chat: AnnotationDetail;
  /**
   * The chapter this thread recaps, from the book's contents. Null on every
   * annotation that isn't a chapter summary, and on a summary whose heading has
   * fallen out of the contents since — the thread still opens, it just can't
   * name the chapter in its header.
   */
  chapterTitle?: string | null;
  memberEmail: string | null;
  bookSpoilerFree: boolean;
  /** Articles have no pages, so nothing spoiler-scoped applies to them. */
  isArticle: boolean;
  onNoteChange: (note: string | null) => void;
  hasRealPages: boolean;
  currentPage: number | null;
  labelForPage: (page: number) => string | null;
  onJumpToPage: (page: number) => void;
  onFork: () => void;
  onDelete: () => void;
  onClose: () => void;
  /**
   * Fired on the first send: the chat is now real and shouldn't be discarded.
   * Carries the question, which is also what the mark in the page shows — see
   * markTouched in reader-annotation-layer.tsx.
   */
  onTouched: (question: string) => void;
  /** Fires once the row definitely has a persisted message on it. */
  onExchangeComplete: () => void;
  onSpoilerFreeChange: (next: boolean) => void;
  onModelChange: (next: ReaderChatModelPreference) => void;
  /**
   * The chat's real id, waiting for it if the annotation was opened before the
   * server had created it. Resolves immediately in every other case.
   */
  resolveChatId?: (id: string) => Promise<string>;
  /** Set when that creation failed, so this thread has nowhere to send to. */
  createError?: string | null;
  /** The float/dock control, when the panel is presented in a way that can dock. */
  dockToggle?: React.ReactNode;
}) {
  const [messages, setMessages] = useState<ReaderChatMessage[]>(chat.messages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const online = useIsOnline();
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Captured at mount (the panel remounts per chat via key): an empty transcript
  // means this chat was just started, so the reader's next move is to type.
  const [startedEmpty] = useState(() => chat.messages.length === 0);
  const isSummary = chat.chapterAnchorId != null;
  /**
   * Captured at mount, like startedEmpty. Keyed on there being no ANSWER rather
   * than no messages: the route commits the question before it streams, so a
   * recap whose reply died left a thread holding a question and nothing else.
   * Opening that should write the summary, not show the reader their own
   * app-authored question with no answer under it.
   */
  const [needsSummary] = useState(
    () => isSummary && !chat.messages.some((m) => m.role === "assistant")
  );

  // Only on a NEW chat — reopening an old one to read it shouldn't grab focus,
  // which on a phone would throw up the keyboard over the thread. A summary is
  // excluded even when it's new: the reader tapped a title to READ something,
  // and a keyboard over the recap as it arrives is the opposite of that.
  useEffect(() => {
    if (startedEmpty && !isSummary) inputRef.current?.focus();
  }, [isSummary, startedEmpty]);

  // No effect syncing `messages` back to props: the panel remounts this
  // component with key={chat.id}, so switching chats resets everything. Syncing
  // instead would risk clobbering a reply mid-stream.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setError(null);
    setSending(true);
    // Before the request, not after: the route persists the user's message as
    // its first step, so the chat is committed even if the reply fails.
    onTouched(text);

    const userId = localId();
    const assistantId = localId();
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: text, model: null, createdAt: "" },
      { id: assistantId, role: "assistant", content: "", model: null, createdAt: "" },
    ]);

    // The panel can open before the annotation row exists, so the id it was
    // rendered with may still be a stand-in. Resolved here rather than at the
    // top of send: the question and the pending reply are already on screen, so
    // if this does have to wait, it waits behind a live-looking thread.
    let chatId = chat.id;
    if (resolveChatId) {
      try {
        chatId = await resolveChatId(chat.id);
      } catch (err) {
        // The annotation never saved, so there is nowhere for this to go. Give
        // the reader their words back rather than leaving them in a dead thread.
        setError(err instanceof Error ? err.message : "Couldn't save that annotation.");
        setMessages((prev) => prev.filter((m) => m.id !== userId && m.id !== assistantId));
        setDraft(text);
        setSending(false);
        return;
      }
    }

    try {
      const res = await fetch("/reader/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, userMessage: text, memberEmail }),
      });
      if (!res.ok || !res.body) {
        throw new Error((await res.text()) || "Couldn't send that.");
      }

      if (res.headers.get("X-Reader-Chat-Promoted") === "1") {
        setMessages((prev) => {
          if (prev.some((m) => m.role === "notice")) return prev;
          const note: ReaderChatMessage = {
            id: localId(),
            role: "notice",
            content:
              "Answered with the Deep model — this book is too long for the Fast model's context window.",
            model: null,
            createdAt: "",
          };
          // Sit the note above the exchange it explains.
          const at = Math.max(0, prev.length - 2);
          return [...prev.slice(0, at), note, ...prev.slice(at)];
        });
      }

      const failed = await streamReply(res.body, (text) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m))
        )
      );
      if (failed) {
        setError(failed);
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that.");
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setSending(false);
      // Whatever happened to the reply, the route persisted the user's turn
      // before streaming — so this annotation is a chat now, and the list that
      // decides its colour and its margin icon needs to hear about it.
      onExchangeComplete();
    }
  }, [draft, sending, chat.id, memberEmail, onTouched, onExchangeComplete, resolveChatId]);

  /**
   * Write the recap — on opening a summary that doesn't have one yet, and again
   * whenever Regenerate is pressed.
   *
   * Both are the same request because the route treats them as one: a summary
   * owns its thread, so a fresh recap replaces the old one and anything asked
   * about it. That is destructive and deliberately unconfirmed, like the delete
   * control beside it — the alternative was a second recap stacked under stale
   * follow-ups, which is worse to read and worse to undo.
   */
  const summarize = useCallback(async () => {
    if (sending) return;
    setError(null);
    setSending(true);

    // Rendered here as well as persisted by the route, so the thread reads as a
    // question already asked while the answer is still coming. The wording is
    // shared with the server precisely so the two copies are the same string.
    const question = chapterSummaryQuestion(chapterTitle ?? "this chapter");
    // Before the request, like send(): the route commits the question as its
    // first step, so the summary survives a reply that fails.
    onTouched(question);

    const userId = localId();
    const assistantId = localId();
    setMessages([
      { id: userId, role: "user", content: question, model: null, createdAt: "" },
      { id: assistantId, role: "assistant", content: "", model: null, createdAt: "" },
    ]);

    // The panel can open before the annotation row exists — the reader tapped a
    // chapter title and this fired on the next frame — so the id may still be a
    // stand-in. See PendingCreate in reader-annotation-layer.tsx.
    let annotationId = chat.id;
    if (resolveChatId) {
      try {
        annotationId = await resolveChatId(chat.id);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't save that annotation."
        );
        setMessages([]);
        setSending(false);
        return;
      }
    }

    try {
      const res = await fetch("/reader/api/chapter-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotationId, memberEmail }),
      });
      if (!res.ok || !res.body) {
        throw new Error((await res.text()) || "Couldn't summarize that chapter.");
      }

      const failed = await streamReply(res.body, (text) =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m))
        )
      );
      if (failed) {
        setError(failed);
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't summarize that chapter."
      );
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setSending(false);
      onExchangeComplete();
    }
  }, [
    chapterTitle,
    chat.id,
    memberEmail,
    onExchangeComplete,
    onTouched,
    resolveChatId,
    sending,
  ]);

  /**
   * A summary with no recap in it yet writes itself rather than waiting to be
   * asked — the tap on the chapter title WAS the asking.
   *
   * Guarded by a ref rather than by the dependency list: `summarize` is rebuilt
   * whenever anything it closes over changes, and re-running this effect on that
   * would throw away the recap mid-stream and start another. It therefore runs
   * at most once per opening, so a model that keeps failing costs one attempt
   * each time the reader tries rather than a loop.
   */
  const summarizedRef = useRef(false);
  useEffect(() => {
    if (!needsSummary || summarizedRef.current) return;
    summarizedRef.current = true;
    void summarize();
  }, [needsSummary, summarize]);

  // The chat's boundary is frozen at its anchor, so once you've read past it the
  // assistant knows less than you do. Offer the fork exactly when that's true —
  // but never on a summary, which was never scoped to where you were standing
  // and so has nothing to catch up on.
  const behind =
    !isSummary &&
    chat.anchorPage != null &&
    currentPage != null &&
    currentPage > chat.anchorPage;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">
            {isSummary
              ? chapterTitle
                ? chapterName(chapterTitle)
                : "Chapter summary"
              : chat.anchorPage != null && hasRealPages
                ? `Page ${chat.anchorPage}`
                : chat.quotedText
                  ? "On a passage"
                  : "In the text"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {isSummary
              ? "A recap of this chapter alone"
              : isArticle
                ? "Claude has read the whole article"
                : chat.spoilerFree
                  ? chat.contextThroughPage != null
                    ? `Claude has read to p.${chat.contextThroughPage}`
                    : "Claude has read to here"
                  : "Claude has read the whole book"}
          </p>
        </div>
        <ModelPicker value={chat.modelPreference} onChange={onModelChange} />
        {isSummary && (
          <button
            type="button"
            onClick={() => void summarize()}
            disabled={!online || sending}
            aria-label="Write a new summary"
            title="Write a new summary"
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete chat"
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        {dockToggle}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {chat.quotedText && (
          <blockquote className="mb-3 border-l-2 border-border pl-3 font-serif text-sm leading-6 text-muted-foreground italic">
            {chat.quotedText}
          </blockquote>
        )}

        <NoteField value={chat.note} onCommit={onNoteChange} />

        <div className="flex flex-col gap-3">
          {messages.map((m) =>
            m.role === "notice" ? (
              <p
                key={m.id}
                className="mx-auto max-w-[85%] text-center text-[11px] leading-4 text-muted-foreground"
              >
                {m.content}
              </p>
            ) : (
              <div
                key={m.id}
                className={cn(
                  "max-w-[92%] rounded-lg px-3 py-2 text-sm leading-6",
                  m.role === "user"
                    ? "self-end bg-muted text-foreground"
                    : "self-start text-foreground"
                )}
              >
                {m.role === "assistant" && m.content === "" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : m.role === "assistant" ? (
                  <ChatMessageText
                    text={m.content}
                    hasRealPages={hasRealPages}
                    labelForPage={labelForPage}
                    onJumpToPage={onJumpToPage}
                  />
                ) : (
                  // The reader's own words, kept as typed — a question written
                  // over two lines shouldn't come back as one.
                  <span className="whitespace-pre-wrap">{m.content}</span>
                )}
              </div>
            )
          )}
        </div>

        {behind && (
          <div className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <p className="text-[11px] leading-4 text-muted-foreground">
              Started at p.{chat.anchorPage} · you&rsquo;ve read to p.{currentPage}.
            </p>
            <button
              type="button"
              onClick={onFork}
              className="mt-1.5 text-xs font-medium text-foreground underline underline-offset-2 hover:opacity-70"
            >
              Continue from here
            </button>
          </div>
        )}

        {(error || createError) && (
          <p className="mt-3 text-xs text-destructive">{error ?? createError}</p>
        )}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            disabled={!online}
            // Said up front rather than after a failed send: the answer has to
            // come from a model, so this is the one part of the reader that
            // genuinely cannot work offline. Queuing it would be worse — a
            // question answered hours later is one you've stopped wondering about.
            placeholder={
              !online
                ? "AI chat needs a connection"
                : isSummary
                  ? "Ask about this chapter…"
                  : "Ask about this part…"
            }
            className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!online || sending || draft.trim().length === 0}
            aria-label="Send"
            className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CornerDownLeft className="h-4 w-4" />
            )}
          </button>
        </div>
        {/* Books only. An article has no page map to scope against, and the
            server refuses to honour spoiler_free for one regardless — showing a
            control that silently does nothing is worse than showing none. */}
        {!isArticle && (
          <label className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={bookSpoilerFree}
              onChange={(e) => onSpoilerFreeChange(e.target.checked)}
              className="h-3 w-3 accent-foreground"
            />
            Spoiler-safe — applies to new chats
          </label>
        )}
      </div>
    </div>
  );
}

function ModelPicker({
  value,
  onChange,
}: {
  value: ReaderChatModelPreference;
  onChange: (next: ReaderChatModelPreference) => void;
}) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-md border border-border text-[11px]">
      {(["fast", "deep"] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "px-2 py-1 capitalize transition-colors",
            value === opt
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

/**
 * The reader's own words on this passage.
 *
 * Saved on blur rather than per keystroke: a note is a paragraph you think
 * about, not a chat message, and a write per character would be a write per
 * character. Emptying it clears the note and leaves the highlight — erasing
 * what you wrote is not a request to unmark the passage.
 */
function NoteField({
  value,
  onCommit,
}: {
  value: string | null;
  onCommit: (note: string | null) => void;
}) {
  // No effect syncing draft back to `value`: AnnotationThread is keyed by
  // annotation id, so switching annotations remounts this with fresh initial
  // state. The only other way `value` changes is our own commit, which the
  // draft already matches.
  const [draft, setDraft] = useState(value ?? "");

  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim() || null;
        if (next !== (value ?? null)) onCommit(next);
      }}
      rows={draft ? 3 : 1}
      placeholder="Add a note…"
      className="mb-3 w-full resize-none rounded-md border border-border bg-transparent px-2.5 py-2 text-sm leading-6 text-foreground placeholder:text-muted-foreground/70 focus:border-foreground/30 focus:outline-none"
    />
  );
}
