"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  CornerDownLeft,
  Loader2,
  RotateCcw,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AnnotationDetail,
  ReaderChatMessage,
  ReaderChatModelPreference,
} from "@/lib/reading/annotation-types";
import { streamReply } from "@/lib/reading/chat-stream";
import { chapterSummaryQuestion } from "@/lib/reading/chapter-summary";
import { chapterName } from "@/lib/reading/chapter-target";
import { useIsOnline } from "@/lib/reading/offline/use-is-online";
import { ChatMessageText } from "./chat-message-text";
import { useAutosizeTextarea } from "./use-autosize-textarea";

/**
 * What the one composer does with what you type: ask Claude, or keep it.
 *
 * Two intents, one text field. They were two fields — a note box wedged above
 * the transcript and a question box below it — which read as two identical
 * inputs with nothing on screen to say that one is private and the other is not.
 *
 * There is deliberately no control for this. Notes are a small fraction of what
 * gets written here, and a permanent switch in the composer cost more attention
 * every day than the feature is worth: ⌘↵ writes one from the keyboard, and the
 * toolbar's "Note" opens the box already set to write one. The placeholder is
 * the only thing that ever says which mode you're in, and after the first line
 * lands the box goes back to asking.
 */
export type ComposeMode = "chat" | "note";

let localSeq = 0;
const localId = () => `local-${++localSeq}`;

export function AnnotationThread({
  chat,
  chapterTitle = null,
  memberEmail,
  isArticle,
  initialMode = "chat",
  onAddNote,
  hasRealPages,
  labelForPage,
  onJumpToPage,
  onDelete,
  onBack,
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
  /** Articles have no pages, so nothing spoiler-scoped applies to them. */
  isArticle: boolean;
  /**
   * Which way the composer starts. "note" when the reader chose Note in the
   * selection toolbar — that choice is the whole reason the toolbar asks, so
   * arriving in a panel set to Chat would throw it away and make them say it
   * twice.
   */
  initialMode?: ComposeMode;
  /**
   * Append a note to the thread. Gets no reply, but does have to reach the
   * server — it rejects if the write fails so the thread can hand the words back
   * rather than showing them saved when they aren't.
   */
  onAddNote: (text: string) => Promise<void>;
  hasRealPages: boolean;
  labelForPage: (page: number) => string | null;
  onJumpToPage: (page: number) => void;
  onDelete: () => void;
  /** Leave this chat for the index of everything marked in the book. */
  onBack: () => void;
  onClose: () => void;
  /**
   * Fired the first time anything is committed here: the annotation is now real
   * and shouldn't be discarded. Carries the text, which is also what the mark in
   * the page shows, and which KIND of thing it was — a note and a question make
   * a passage look different, so the two can't be reported as one. See
   * markTouched in reader-annotation-layer.tsx.
   */
  onTouched: (text: string, kind: "question" | "note") => void;
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
  /**
   * What the model is doing while it has nothing to say — currently only ever
   * "Searching the web…". Lives for the length of one reply and is cleared
   * however that reply ends, so a failed turn can't strand it on screen.
   */
  const [status, setStatus] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Same composer, same growth — a note written on a passage is as likely to
  // run long as an answer in an interview.
  useAutosizeTextarea(inputRef, draft);
  // Scrolling up mid-reply is deliberate — back to the question, or up into an
  // earlier turn — so the next streamed token mustn't yank the reader back down.
  // Streamed text appending never fires a scroll event, and the follow below only
  // ever moves toward the bottom, so the one thing that un-pins is the reader
  // scrolling up themselves. Scrolling back down re-pins.
  const pinnedToBottom = useRef(true);
  // Captured at mount (the panel remounts per chat via key): an empty transcript
  // means this chat was just started, so the reader's next move is to type.
  const [startedEmpty] = useState(() => chat.messages.length === 0);
  const [mode, setMode] = useState<ComposeMode>(initialMode);
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

  // Follow new content only while pinned. Moving the panel's own scrollTop rather
  // than scrollIntoView keeps this inside the thread: the page behind it stays
  // exactly where the reader left it.
  useEffect(() => {
    if (!pinnedToBottom.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /**
   * Keep what's in the box as a note.
   *
   * Optimistic: a note is short, it is the reader's own words, and there is
   * nothing to stream back, so it appears the instant they commit it rather than
   * after a round trip. The write is queued behind the annotation's insert by
   * the layer (see onceCreated), so this is safe on a passage the server has not
   * heard about yet.
   *
   * A failure takes the line back out and returns the text to the box, the same
   * way a failed question does. Silently leaving it on screen would be the worst
   * outcome available here — this is the one part of the panel that is the
   * reader's own writing, and showing it as kept when it wasn't is how you lose
   * a thought without ever being told.
   */
  const keepNote = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setError(null);
    setSending(true);
    // Before the write, like send(): a note makes this annotation the reader's
    // writing rather than a draft to be swept up when the panel closes.
    onTouched(text, "note");
    pinnedToBottom.current = true;

    const noteId = localId();
    setMessages((prev) => [
      ...prev,
      { id: noteId, role: "note", content: text, model: null, createdAt: "" },
    ]);

    try {
      await onAddNote(text);
      // Back to asking. Arriving via the toolbar's "Note" sets the box up to
      // write one, but it is a starting position rather than a state the thread
      // is stuck in — the next thing you type in a passage you've written on is
      // usually a question about it.
      setMode("chat");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that note.");
      setMessages((prev) => prev.filter((m) => m.id !== noteId));
      setDraft(text);
      return;
    } finally {
      setSending(false);
    }
    onExchangeComplete();
  }, [draft, onAddNote, onExchangeComplete, onTouched, sending]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setError(null);
    setSending(true);
    // Before the request, not after: the route persists the user's message as
    // its first step, so the chat is committed even if the reply fails.
    onTouched(text, "question");

    // Asking something is asking to see the answer, so a send re-pins even if you
    // were reading back through the thread when you typed it.
    pinnedToBottom.current = true;

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

      const failed = await streamReply(
        res.body,
        (text) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: text } : m))
          ),
        setStatus
      );
      if (failed) {
        setError(failed);
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that.");
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setStatus(null);
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
    onTouched(question, "question");

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

  /**
   * How much this chat can see and how hard it thinks are decisions you make
   * WITH the first question, and they stop being decisions once you've asked it.
   *
   * Read live from the transcript rather than captured at mount, so sending
   * settles them under your hand rather than at some later reopening — by the
   * time the first answer is streaming, the settings it was answered under are
   * no longer up for debate. A summary asks itself the moment it opens, so it
   * is never anything but settled.
   *
   * Notes don't count. Nothing was answered, so there is no reply above the
   * controls that these settings produced — writing a thought and then asking
   * about it is one continuous act, and the model is still yours to pick when
   * you get to the question.
   *
   * Deliberately not keyed on a SUCCESSFUL exchange: the route commits the
   * question before it streams, so a reply that fails still leaves a question
   * that was answered — or refused — under these settings.
   */
  const settled = messages.some(
    (m) => m.role === "user" || m.role === "assistant"
  );

  const modelLabel = chat.modelPreference === "deep" ? "Deep" : "Fast";
  // What the chat can see, in the reader's terms. Doubles as live feedback while
  // the boundary is still a control: ticking the box rewrites this line.
  const scope = isSummary
    ? "A recap of this chapter alone"
    : isArticle
      ? "Claude has read the whole article"
      : chat.spoilerFree
        ? chat.contextThroughPage != null
          ? `Claude has read to p.${chat.contextThroughPage}`
          : "Claude has read to here"
        : "Claude has read the whole book";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        {/* The way out of a chat and back to everything marked in the book.
            Without it the only exit was closing the panel outright, so getting
            from one conversation to another meant leaving the panel and
            reopening it from the margin — a chat was a dead end. Leftmost and a
            chevron, so it reads as "back" rather than as one more action on this
            chat, which is what the icons on the right all are. */}
        <button
          type="button"
          onClick={onBack}
          aria-label="All marks"
          title="All marks"
          className="-ml-1.5 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
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
          {/* Once settled this line IS the chat's settings, stated rather than
              offered — which is why the picker and the checkbox that used to
              live in this header and under the composer are gone from a chat
              that has been asked something. Before then it describes only what
              the controls down by the composer are currently set to. */}
          <p className="truncate text-[11px] text-muted-foreground">
            {settled ? `${modelLabel} · ${scope}` : scope}
          </p>
        </div>
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

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          // A little slack rather than an exact match: sub-pixel line heights and
          // a phone's rubber-banding leave you a hair off the true bottom even
          // when you're plainly sitting at it.
          pinnedToBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop < 32;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {chat.quotedText && (
          <blockquote className="mb-3 border-l-2 border-border pl-3 font-serif text-sm leading-6 text-muted-foreground italic">
            {chat.quotedText}
          </blockquote>
        )}

        <div className="flex flex-col gap-3">
          {messages.map((m) =>
            m.role === "note" ? (
              // Not a bubble. A note is the reader writing in the margin, not a
              // turn in a conversation, so it reads as writing on the page —
              // full width, a rule down the side, no sender.
              <div
                key={m.id}
                className="border-l-2 border-foreground/25 py-0.5 pl-3"
              >
                <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
                  {m.content}
                </p>
              </div>
            ) : m.role === "notice" ? (
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
                  // Same spinner either way; the difference is whether there is
                  // anything worth saying about the wait. A search is long
                  // enough that silence reads as a hang.
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {status && <span className="text-xs">{status}</span>}
                  </span>
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

        {(error || createError) && (
          <p className="mt-3 text-xs text-destructive">{error ?? createError}</p>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        {/* How this conversation will work: which model answers it, and how much
            of the book it reads. Properties of the THREAD, so they're gone the
            moment it has an answer in it and the header states them instead.
            A summary never shows them — it asks itself the moment it opens, so
            there's no point at which they'd be anything but decorative.

            Shown while the box is set to write a note too, even though a note
            goes nowhere near a model: they describe the question you'll
            eventually ask, not the line you're typing now. */}
        {!settled && !isSummary && (
          <div className="mb-2 flex items-center gap-3">
            <ModelPicker value={chat.modelPreference} onChange={onModelChange} />
            {/* Stated as what it DOES rather than as what it protects you from.
                A chat reads the book up to where you are no matter what; the
                only question this answers is whether the rest of it comes too,
                so that's what it's named after. "Spoiler-safe" described the
                consequence of leaving it alone, which meant reading the label
                backwards to work out what ticking it would do.

                Books only. An article has no page map to scope against, and the
                server refuses to honour spoiler_free for one regardless —
                showing a control that silently does nothing is worse than
                showing none. */}
            {!isArticle && (
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={!chat.spoilerFree}
                  onChange={(e) => onSpoilerFreeChange(!e.target.checked)}
                  className="h-3 w-3 accent-foreground"
                />
                Include full book in context
              </label>
            )}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              // The note path is a keyboard shortcut rather than a control,
              // because writing one is rare enough that a permanent switch in
              // the composer was more noise than the feature is worth. ⌘↵ works
              // whatever the box is currently set to do, so it's one thing to
              // remember rather than a thing you have to check first.
              if (e.metaKey || e.ctrlKey || mode === "note") void keepNote();
              else void send();
            }}
            rows={2}
            // A note needs the server, not a model — so it survives a flaky
            // connection the way any other write does, and only the asking is
            // blocked. Said up front rather than after a failed send: the answer
            // has to come from a model, so that is the one part of the reader
            // that genuinely cannot work offline. Queuing it would be worse — a
            // question answered hours later is one you've stopped wondering about.
            disabled={!online && mode === "chat"}
            // The only thing on screen that says what Enter will do. That is the
            // whole visible surface of note mode now: no toggle, no second
            // button, just the box telling you what it is.
            placeholder={
              mode === "note"
                ? "Write a note…"
                : !online
                  ? "AI chat needs a connection"
                  : isSummary
                    ? "Ask about this chapter…"
                    : "Ask about this part…"
            }
            className="min-h-[3.375rem] flex-1 resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void (mode === "note" ? keepNote() : send())}
            disabled={
              (!online && mode === "chat") || sending || draft.trim().length === 0
            }
            aria-label={mode === "note" ? "Keep note" : "Send"}
            // Where the shortcut is advertised. A tooltip is the right weight
            // for it: findable by anyone wondering how to write a note, invisible
            // to everyone else.
            title={
              mode === "note"
                ? "Keep note (↵)"
                : "Send (↵) · hold ⌘ to keep as a note"
            }
            className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : mode === "note" ? (
              <StickyNote className="h-4 w-4" />
            ) : (
              <CornerDownLeft className="h-4 w-4" />
            )}
          </button>
        </div>
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
