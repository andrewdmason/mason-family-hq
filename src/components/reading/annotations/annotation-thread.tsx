"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownLeft, Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AnnotationDetail,
  ReaderChatMessage,
  ReaderChatModelPreference,
} from "@/lib/reading/annotation-types";
import { useIsOnline } from "@/lib/reading/offline/use-is-online";
import { ChatMessageText } from "./chat-message-text";

/** The route marks a failed turn this way rather than persisting a message. */
const ERROR_MARKER = /\n\n\[error: ([\s\S]*)\]$/;

let localSeq = 0;
const localId = () => `local-${++localSeq}`;

export function AnnotationThread({
  chat,
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
}: {
  chat: AnnotationDetail;
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
  /** Fired on the first send: the chat is now real and shouldn't be discarded. */
  onTouched: () => void;
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

  // Only on a NEW chat — reopening an old one to read it shouldn't grab focus,
  // which on a phone would throw up the keyboard over the thread.
  useEffect(() => {
    if (startedEmpty) inputRef.current?.focus();
  }, [startedEmpty]);

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
    onTouched();

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

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m))
        );
      }

      // A stream that failed mid-flight carries the marker instead of ending
      // cleanly; surface it as an error rather than as something Claude "said".
      const failed = acc.match(ERROR_MARKER);
      if (failed) {
        setError(failed[1]);
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

  // The chat's boundary is frozen at its anchor, so once you've read past it the
  // assistant knows less than you do. Offer the fork exactly when that's true.
  const behind =
    chat.anchorPage != null && currentPage != null && currentPage > chat.anchorPage;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">
            {chat.anchorPage != null && hasRealPages
              ? `Page ${chat.anchorPage}`
              : chat.quotedText
                ? "On a passage"
                : "In the text"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {isArticle
              ? "Claude has read the whole article"
              : chat.spoilerFree
                ? chat.contextThroughPage != null
                  ? `Claude has read to p.${chat.contextThroughPage}`
                  : "Claude has read to here"
                : "Claude has read the whole book"}
          </p>
        </div>
        <ModelPicker value={chat.modelPreference} onChange={onModelChange} />
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete chat"
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
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
                  m.content
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
            placeholder={online ? "Ask about this part…" : "AI chat needs a connection"}
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
