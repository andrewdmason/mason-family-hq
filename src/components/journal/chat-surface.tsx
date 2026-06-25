"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Coins, Lock, MessageCircle, Send } from "lucide-react";
import { TypingIndicator } from "@/components/journal/typing-indicator";
import { JournalPhotoGallery } from "@/components/journal/journal-photo-gallery";
import { PostBody } from "@/components/journal/post-body";
import {
  parseMarkdownBlocks,
  type MarkdownBlock,
} from "@/lib/journal/markdown-blocks";
import {
  appendUserMessage,
  closeEntry,
  deleteLatestQuestion,
  flipQuestionModeOffOnce,
  saveEntryTitle,
  saveReplyDraft,
  setEntryQuestionMode,
  setEntryVisibility,
} from "@/app/(journal)/journal/actions";
import { useJournalTimer } from "@/components/journal/timer-context";
import type {
  JournalMediaType,
  JournalMessageRole,
  JournalPhotoSource,
  JournalVisibility,
} from "@/lib/types";

type Msg = { role: JournalMessageRole; content: string };
type GalleryMedia = {
  id: string;
  mediaType: JournalMediaType;
  source: JournalPhotoSource;
  displayUrl: string;
  videoUrl: string | null;
};

export function ChatSurface({
  entryId,
  initialStatus,
  initialVisibility = "private",
  initialMessages,
  viewMode = "today",
  timerStartedAt = null,
  initialQuestionMode = false,
  initialTimerFlippedOff = false,
  initialTitle = "",
  initialDraft = "",
  initialPhotos = [],
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
   * created_at, or when a blank post was started). Wall-clock based, so the
   * timer's progress and completion survive refreshes.
   */
  timerStartedAt?: string | null;
  /** Whether AI question mode is on: a reply also asks for a follow-up. */
  initialQuestionMode?: boolean;
  /** Whether the timer's one-time flip of question mode to off already fired. */
  initialTimerFlippedOff?: boolean;
  /** The writer's own title, shown in an editable field at the top. */
  initialTitle?: string;
  /** The unsent reply draft, restored into the reply box. */
  initialDraft?: string;
  /**
   * The entry's photos, for the in-composer gallery rendered in the today flow
   * (so the attach action and chat toggle share one hover-revealed row above the
   * title). History/read views render their own gallery, so this is unused there.
   */
  initialPhotos?: GalleryMedia[];
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
  // The manual AI-chat toggle. ON, a reply streams an interviewer follow-up;
  // OFF, the reply is just saved as a block.
  const [questionMode, setQuestionMode] = useState(initialQuestionMode);
  const [timerFlippedOff, setTimerFlippedOff] = useState(initialTimerFlippedOff);
  // Who can read the post once it's finished. Chosen inline via the lock toggle
  // in the composer header (no longer a confirm step on finish), so it's
  // persisted as it changes and read straight off when wrapping up.
  const [visibility, setVisibility] =
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
  // The /journal/new flow renders the Notion-style header here: the photo gallery
  // (with the attach action and chat toggle on one hover-revealed row) plus the
  // editable title. The read page renders its own gallery + title, so we skip it.
  const showComposerHeader = showWritingControls && viewMode === "today";
  // A finished post being read (a shared entry, or a closed entry in history)
  // is view-only: open it at the top like any article, never jump to the end.
  const isViewingOnly = readOnly || isHistoryClosed;

  // When chat is off the writing area is a blog-style continuation of the post
  // with no Send button — its text lives as an autosaved draft and is committed
  // when the post is finished. ReplyBox sets this so Finish can pull that text.
  const flushBlogDraftRef = useRef<(() => string) | null>(null);

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
      // While writing there's a tall bottom pad (pb-[25vh]) the caret scrolls
      // into, so "at the bottom" means within that pad plus a little, not
      // literally touching the document end — otherwise streamed replies would
      // stop auto-following the moment the pad pushes us off the true bottom.
      const threshold = isViewingOnly ? 120 : window.innerHeight * 0.25 + 120;
      pinnedToBottom.current = distanceFromBottom < threshold;
    };
    updatePinned();
    window.addEventListener("scroll", updatePinned, { passive: true });
    return () => window.removeEventListener("scroll", updatePinned);
  }, [isViewingOnly]);

  // Follow new content only while pinned to the bottom — and never in a
  // view-only post, which should open at the top.
  useEffect(() => {
    if (isViewingOnly || !pinnedToBottom.current) return;
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming, isViewingOnly]);

  // Anchor the zen timer to its wall-clock start. beginTimer is idempotent for
  // the same anchor, so it's safe to call on every render.
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

  // The timer's one gentle nudge: when the five minutes complete, flip question
  // mode off exactly once. After that the writer is in full manual control and
  // can turn it back on without the timer flipping it again.
  useEffect(() => {
    if (viewMode !== "today" || status !== "open") return;
    if (!timerDone || timerFlippedOff) return;
    setTimerFlippedOff(true);
    setQuestionMode(false);
    void flipQuestionModeOffOnce(entryId).catch(() => {});
  }, [timerDone, timerFlippedOff, viewMode, status, entryId]);

  // Give the caret breathing room above the bottom edge while writing. The page
  // scrolls on the document, and the browser's native caret-scroll (and our own
  // smooth scrollIntoView) honor scroll-padding on the scroll root — so the
  // active line never ends up flush against the window's bottom as the post grows
  // or a line wraps. Paired with the writing area's matching bottom padding so
  // there's room to actually scroll that far. Scoped to the editable view.
  useEffect(() => {
    if (isViewingOnly) return;
    const root = document.documentElement;
    const previous = root.style.scrollPaddingBottom;
    root.style.scrollPaddingBottom = "25vh";
    return () => {
      root.style.scrollPaddingBottom = previous;
    };
  }, [isViewingOnly]);

  function toggleQuestionMode(next: boolean) {
    if (streaming || closing) return;
    setQuestionMode(next);
    void setEntryQuestionMode(entryId, next).catch((err) => {
      setQuestionMode(!next);
      setError(err instanceof Error ? err.message : String(err));
    });
  }

  function chooseVisibility(next: JournalVisibility) {
    if (streaming || closing || next === visibility) return;
    const previous = visibility;
    setVisibility(next);
    setError(null);
    void setEntryVisibility(entryId, next).catch((err) => {
      setVisibility(previous);
      setError(err instanceof Error ? err.message : String(err));
    });
  }

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

  // Remove the trailing question entirely — for a question left unanswered
  // (e.g. the writer turned question mode off and doesn't want it hanging there).
  async function handleDeleteQuestion() {
    if (streaming || thinking || closing) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const previous = messages;

    setError(null);
    setMessages((m) => m.slice(0, -1));
    try {
      await deleteLatestQuestion(entryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages(previous);
    }
  }

  // Question mode off: the writer's words are saved, but the interviewer is not
  // asked to respond.
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
    if (questionMode) {
      void streamReply(text);
    } else {
      void appendReply(text);
    }
  }

  // Whether there's anything to finish: a committed turn, or — in blog mode —
  // unsent writing in the box (which Finish commits for you).
  const canFinish = messages.length > 0 || (!questionMode && hasUnsentReply);

  // Closing flips the entry to "closed" right away, then kicks off the wrap
  // pass (summary/pull_quote) in the background and hands off to the journal
  // list, where the entry appears with its AI fields generating.
  async function handleClose() {
    if (closing || streaming) return;
    // Blog mode has no Send button — commit whatever's in the writing box as the
    // post's closing words before we wrap.
    let pendingBlog = "";
    if (!questionMode && flushBlogDraftRef.current) {
      pendingBlog = flushBlogDraftRef.current().trim();
    }
    if (messages.length === 0 && pendingBlog.length === 0) return;
    setClosing(true);
    setError(null);
    try {
      if (pendingBlog) {
        setMessages((m) => [...m, { role: "user", content: pendingBlog }]);
        await appendUserMessage(entryId, pendingBlog);
        await saveReplyDraft(entryId, "");
      }
      await setEntryVisibility(entryId, visibility);
      await closeEntry(entryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setClosing(false);
      return;
    }
    // Fire-and-forget: the wrap writes summary to the DB on its own. We
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
    <div
      className={
        "mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 pt-12 " +
        // A tall bottom pad while writing gives the caret room to sit above the
        // window edge (the scroll-padding above scrolls into it); read views keep
        // a normal pad so a finished post doesn't trail off into empty space.
        (isViewingOnly ? "pb-24" : "pb-[25vh]")
      }
    >
      {showWritingControls && (
        <div
          className={
            "mb-6 flex items-center gap-3 " +
            (viewMode === "history" ? "justify-between" : "justify-end")
          }
        >
          {/* In history (an open draft opened from the list) the chat and lock
              toggles ride in this row; the today flow puts them up by
              "Attach a photo". */}
          {viewMode === "history" && (
            <div className="flex items-center gap-4">
              <VisibilityModeToggle
                visibility={visibility}
                disabled={streaming || closing}
                onChange={chooseVisibility}
              />
              <QuestionModeToggle
                on={questionMode}
                disabled={streaming || closing}
                onChange={toggleQuestionMode}
              />
            </div>
          )}
          <div className="flex items-center gap-3">
            <TimerGlyph
              running={timerRunning}
              done={timerDone}
              degrees={timerDegrees}
            />
            <button
              type="button"
              onClick={() => void handleClose()}
              disabled={closing || streaming || !canFinish}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-3 font-serif text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground disabled:opacity-40"
            >
              {closing ? "Wrapping..." : "Finish post"}
            </button>
          </div>
        </div>
      )}
      {showWritingControls && viewMode === "today" && status === "open" && timerStartedAt && (
        <BucksEarnNudge words={countUserWords(messages)} startedAt={timerStartedAt} />
      )}
      {showComposerHeader && (
        // Notion-style header: the attach action and the chat toggle sit on one
        // row that fades in when you hover the title region, with the editable
        // title beneath. The gallery inherits this surface's width/padding.
        <div className="group mb-8">
          <JournalPhotoGallery
            entryId={entryId}
            initialPhotos={initialPhotos}
            editable={!closing}
            showAttachAction
            actionSlot={
              <div className="flex items-center gap-4">
                <VisibilityModeToggle
                  visibility={visibility}
                  disabled={streaming || closing}
                  onChange={chooseVisibility}
                />
                <QuestionModeToggle
                  on={questionMode}
                  disabled={streaming || closing}
                  onChange={toggleQuestionMode}
                />
              </div>
            }
            containerClassName=""
            attachActionClassName="pointer-events-none opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          />
          <TitleField entryId={entryId} initialTitle={initialTitle} disabled={closing} />
        </div>
      )}
      {/* Chat mode anchors the reply box to the bottom of the page (a chat
          input); blog mode lets the writing area sit right after the post so it
          reads as continuing to write. */}
      <div
        className={
          "space-y-6 font-serif text-lg leading-relaxed" +
          (questionMode ? " flex-1" : "")
        }
      >
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          // The regenerate/delete icons act on a live follow-up question — the
          // last assistant turn, before it's answered. The opening question
          // (i=0) of a picked-question entry is excluded: it was chosen from the
          // picker, not generated here.
          const isLiveQuestion =
            isLast &&
            i > 0 &&
            m.role === "assistant" &&
            status === "open" &&
            !streaming &&
            !thinking &&
            !closing &&
            m.content.trim().length > 0;
          return (
            <div
              key={i}
              className={
                m.role === "assistant"
                  ? "group italic text-muted-foreground pl-6 border-l-2 border-muted"
                  : "text-foreground"
              }
            >
              <PostBody
                content={m.content}
                trailing={
                  isLiveQuestion ? (
                    <span className="ml-1.5 inline-flex translate-y-[0.15em] gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={handleRegenerate}
                        aria-label="Ask a different question"
                        title="Ask a different question"
                        className="inline-flex text-muted-foreground/40 transition-colors hover:text-foreground"
                      >
                        <RegenerateIcon />
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteQuestion}
                        aria-label="Delete this question"
                        title="Delete this question"
                        className="inline-flex text-muted-foreground/40 transition-colors hover:text-destructive"
                      >
                        <TrashIcon />
                      </button>
                    </span>
                  ) : null
                }
              />
            </div>
          );
        })}
        {thinking && messages.length > 0 && messages[messages.length - 1].content === "" && (
          <TypingIndicator />
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
          entryId={entryId}
          initialDraft={initialDraft}
          questionMode={questionMode}
          flushRef={flushBlogDraftRef}
          active={status === "open" && !streaming && !closing}
          disabled={streaming || closing}
          streaming={streaming}
          placeholder={
            messages.length === 0
              ? "start writing…"
              : questionMode
                ? "type a reply…"
                : "keep writing…"
          }
          onSubmit={handleSubmit}
          onDraftPresenceChange={setHasUnsentReply}
        />
      )}
    </div>
  );
}

/**
 * The editable post title. Owns its own draft state and debounced autosave so
 * keystrokes don't re-render the transcript above it. Pre-filled with a concise
 * version of the opening question for picked posts; empty for blank ones.
 */
function TitleField({
  entryId,
  initialTitle,
  disabled,
}: {
  entryId: string;
  initialTitle: string;
  disabled: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const latest = useRef(initialTitle);
  const saved = useRef(initialTitle);

  useEffect(() => {
    latest.current = title;
  }, [title]);

  function flush() {
    if (latest.current.trim() === saved.current.trim()) return;
    saved.current = latest.current;
    void saveEntryTitle(entryId, latest.current).catch(() => {});
  }

  // Debounced autosave a beat after the writer pauses.
  useEffect(() => {
    if (title.trim() === saved.current.trim()) return;
    const id = setTimeout(() => flush(), 800);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  return (
    <input
      type="text"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      placeholder="Title"
      disabled={disabled}
      className="mt-2 w-full border-0 bg-transparent font-serif text-3xl font-normal leading-tight text-foreground placeholder:text-muted-foreground/50 focus:outline-none disabled:opacity-60"
    />
  );
}

/**
 * The chat toggle — styled like the "Attach a photo" link it sits beside: a
 * muted serif control with a speech-bubble icon and a small switch (no text).
 * On, a reply also asks the interviewer a follow-up; off, you're just writing.
 */
function QuestionModeToggle({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Chat with the interviewer"
      title={
        on
          ? "Chat is on — sending also asks a follow-up question. Tap to just write."
          : "Chat is off — you're just writing. Tap to chat with the interviewer."
      }
      onClick={() => onChange(!on)}
      disabled={disabled}
      className="inline-flex items-center gap-2 font-serif text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
    >
      <MessageCircle className="size-4" aria-hidden />
      <span
        aria-hidden
        className={
          "relative h-4 w-7 rounded-full transition-colors " +
          (on ? "bg-foreground" : "bg-muted")
        }
      >
        <span
          className={
            "absolute top-0.5 size-3 rounded-full bg-background transition-[left] " +
            (on ? "left-3.5" : "left-0.5")
          }
        />
      </span>
    </button>
  );
}

/**
 * The personal ↔ family lock — styled like the chat toggle it sits beside: a
 * muted serif control with an icon and a small switch (no text). Off (locked),
 * the post stays personal; on, it's shared with the family once finished.
 * Replaces the old finish-time confirm dialog: you pick the audience inline
 * while writing.
 */
function VisibilityModeToggle({
  visibility,
  disabled,
  onChange,
}: {
  visibility: JournalVisibility;
  disabled: boolean;
  onChange: (next: JournalVisibility) => void;
}) {
  const isFamily = visibility === "family";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isFamily}
      aria-label="Share with family"
      title={
        isFamily
          ? "Shared with family — they can read it once you finish. Tap to keep it personal."
          : "Personal — only you can read it. Tap to share with the family."
      }
      onClick={() => onChange(isFamily ? "private" : "family")}
      disabled={disabled}
      className="inline-flex items-center gap-2 font-serif text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
    >
      <Lock className="size-4" aria-hidden />
      <span
        aria-hidden
        className={
          "relative h-4 w-7 rounded-full transition-colors " +
          (isFamily ? "bg-foreground" : "bg-muted")
        }
      >
        <span
          className={
            "absolute top-0.5 size-3 rounded-full bg-background transition-[left] " +
            (isFamily ? "left-3.5" : "left-0.5")
          }
        />
      </span>
    </button>
  );
}

/**
 * The time-spent-on-this-post indicator: a pie that fills over five minutes,
 * then settles into a checkmark. It no longer gates anything — it's a quiet zen
 * timer that, on completion, nudges question mode off once.
 */
function TimerGlyph({
  running,
  done,
  degrees,
}: {
  running: boolean;
  done: boolean;
  degrees: number;
}) {
  if (done) {
    return (
      <span title="Five minutes on this post." className="inline-flex">
        <CheckCircle2 aria-hidden className="size-4 text-muted-foreground" />
      </span>
    );
  }
  if (!running) return null;
  return (
    <span
      aria-hidden
      title="Time spent on this post"
      className="size-4 rounded-full shadow-[0_0_0_1px_var(--muted)]"
      style={{
        background: `conic-gradient(oklch(0.68 0.02 50) ${degrees}deg, var(--muted) 0deg)`,
      }}
    />
  );
}

/**
 * Isolated reply input. Keeps `draft` state local so keystrokes only
 * re-render this small subtree, not the message transcript above it —
 * which otherwise blocks the main thread and tanks INP. Also debounce-saves the
 * unsent draft so leaving mid-sentence loses nothing.
 */
// Mason Bucks journal gate (mirrors the server-side award in lib/bucks/earn.ts):
// a finished entry earns 5 Bucks once it has 150+ of the writer's own words and
// 5+ minutes of wall-clock. Only the writer's committed turns count — same as the
// server, which sums role='user' messages.
const BUCKS_WORDS = 150;
const BUCKS_SECONDS = 5 * 60;

function countUserWords(messages: Msg[]): number {
  const text = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join(" ")
    .trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

/** Live progress toward the journal Bucks reward, shown while writing. */
function BucksEarnNudge({ words, startedAt }: { words: number; startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  const elapsed = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const met = words >= BUCKS_WORDS && elapsed >= BUCKS_SECONDS;

  useEffect(() => {
    if (met) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [met]);

  const shown = Math.min(elapsed, BUCKS_SECONDS);
  const clock = `${Math.floor(shown / 60)}:${String(shown % 60).padStart(2, "0")}`;

  return (
    <div className="mb-6 flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
      <Coins className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      {met ? (
        <span className="text-amber-700 dark:text-amber-400">
          Nice — this entry will earn 5 Mason Bucks when you finish it.
        </span>
      ) : (
        <span className="tabular-nums">
          {Math.min(words, BUCKS_WORDS)} / {BUCKS_WORDS} words · {clock} / 5:00
          <span className="ml-1 not-italic">— keep going to earn 5 Mason Bucks</span>
        </span>
      )}
    </div>
  );
}

function ReplyBox({
  entryId,
  initialDraft,
  questionMode,
  flushRef,
  active,
  disabled,
  streaming,
  placeholder,
  onSubmit,
  onDraftPresenceChange,
}: {
  entryId: string;
  initialDraft: string;
  questionMode: boolean;
  /** Set to a getter that returns the current draft and clears the box, so
   * Finish can commit blog-mode writing that has no Send button. */
  flushRef: React.MutableRefObject<(() => string) | null>;
  active: boolean;
  disabled: boolean;
  streaming: boolean;
  placeholder: string;
  onSubmit: (text: string) => void;
  onDraftPresenceChange: (hasDraft: boolean) => void;
}) {
  // A contentEditable surface rather than a textarea: a textarea can't put space
  // between paragraphs, so the writer's hard breaks read as one tight block. Here
  // each paragraph after the first is a styled <div> (the structure the browser
  // creates on Enter, and the one we seed on mount), so pressing Enter shows a
  // real gap that matches the published post.
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [hasDraft, setHasDraft] = useState(initialDraft.trim().length > 0);

  // The latest draft and what's persisted, so autosave skips no-op writes.
  const latest = useRef(initialDraft);
  const saved = useRef(initialDraft);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed the editor's block structure once on mount, then leave it uncontrolled
  // so React never rewrites the DOM out from under the caret.
  useEffect(() => {
    seedEditor(editorRef.current, initialDraft);
    onDraftPresenceChange(initialDraft.trim().length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the editor focused on mount and after streaming ends.
  useEffect(() => {
    if (active) editorRef.current?.focus();
  }, [active]);

  // Let the parent pull (and clear) the current draft when finishing a
  // blog-mode post, where there's no Send button to commit it.
  flushRef.current = () => {
    const text = readEditor(editorRef.current);
    clearEditor(editorRef.current);
    latest.current = "";
    saved.current = "";
    setHasDraft(false);
    onDraftPresenceChange(false);
    return text;
  };

  function flushDraft() {
    if (latest.current === saved.current) return;
    saved.current = latest.current;
    void saveReplyDraft(entryId, latest.current).catch(() => {});
  }

  function handleInput() {
    const el = editorRef.current;
    if (!el) return;
    // Markdown-style autoformat: a line that's just "* " becomes a bullet list.
    maybeStartList(el);
    // Deleting everything can leave a stray <div><br></div> (textContent ""), so
    // hard-clear that the :empty placeholder shows again — but only when there's
    // truly no text and no list (a freshly-started "* " bullet is empty too), so
    // a line typed as spaces or a new empty bullet is left alone.
    if (
      el.textContent === "" &&
      el.innerHTML !== "" &&
      !el.querySelector("ul,ol,li")
    ) {
      el.innerHTML = "";
    }
    const text = readEditor(el);
    latest.current = text;
    const present = text.trim().length > 0;
    setHasDraft(present);
    onDraftPresenceChange(present);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushDraft, 800);
  }

  // Translate pasted markdown into rich text: headings, bullet lists, and
  // paragraphs become real elements. A single plain line is inserted as text so
  // pasting into the middle of a sentence stays inline; anything with structure
  // (a heading/list, or multiple lines) is inserted as HTML we build ourselves
  // (escaped — never the clipboard's own markup), which the serializer reads back.
  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const blocks = parseMarkdownBlocks(text);
    const hasStructure =
      blocks.length > 1 || blocks.some((b) => b.type !== "paragraph");
    if (hasStructure) {
      document.execCommand("insertHTML", false, blocksToHtml(blocks));
    } else {
      document.execCommand("insertText", false, text);
    }
    handleInput();
  }

  function submit() {
    const text = readEditor(editorRef.current).trim();
    if (!text || disabled) return;
    clearEditor(editorRef.current);
    latest.current = "";
    saved.current = "";
    setHasDraft(false);
    onDraftPresenceChange(false);
    void saveReplyDraft(entryId, "").catch(() => {});
    onSubmit(text);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Only chat mode submits on ⌘/Ctrl+Enter; blog mode is plain writing.
    if (questionMode && e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className={(questionMode ? "mt-12" : "mt-6") + " flex flex-col gap-3"}>
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder}
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={onKeyDown}
        onPaste={handlePaste}
        onBlur={flushDraft}
        className={
          "min-h-10 w-full whitespace-pre-wrap break-words border-0 bg-transparent py-1 font-serif text-lg leading-relaxed text-foreground focus:outline-none [&>div]:mt-4 [&>ul]:mt-4 [&>h1]:mt-4 [&>h2]:mt-4 [&>h3]:mt-4 [&_ul]:list-disc [&_ul]:pl-6 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:font-semibold empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]" +
          (disabled ? " opacity-60" : "")
        }
      />
      {/* Chat mode has a Send button; blog mode commits when you finish the
          post, so it shows no button — just keep writing. */}
      {questionMode && (
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
      )}
    </div>
  );
}

/** Build the editor's DOM for a parsed block (heading, list, or paragraph). */
function blockToNode(block: MarkdownBlock): Node {
  if (block.type === "heading") {
    const h = document.createElement(`h${block.level}`);
    h.textContent = block.text;
    return h;
  }
  if (block.type === "list") {
    const ul = document.createElement("ul");
    for (const item of block.items) {
      const li = document.createElement("li");
      li.textContent = item;
      ul.appendChild(li);
    }
    return ul;
  }
  const div = document.createElement("div");
  div.textContent = block.text;
  return div;
}

/** Escape text for the HTML we build ourselves before insertHTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Render parsed blocks to the HTML inserted on a markdown paste. */
function blocksToHtml(blocks: MarkdownBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "heading") {
        return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
      }
      if (block.type === "list") {
        return `<ul>${block.items
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join("")}</ul>`;
      }
      return `<div>${escapeHtml(block.text) || "<br>"}</div>`;
    })
    .join("");
}

/**
 * Seed a contentEditable from a stored draft. Markdown-ish lines become headings,
 * <ul> lists, and paragraphs; the first plain paragraph is a bare text node
 * (matching what the browser produces as you type, so the styled block children
 * all get the gap) and later paragraphs are <div>s.
 */
function seedEditor(el: HTMLDivElement | null, text: string) {
  if (!el) return;
  el.textContent = "";
  if (!text) return;
  const blocks = parseMarkdownBlocks(text);
  blocks.forEach((block, i) => {
    if (block.type === "paragraph" && i === 0) {
      el.appendChild(document.createTextNode(block.text));
    } else {
      el.appendChild(blockToNode(block));
    }
  });
}

const BLOCK_TAGS = new Set(["DIV", "P", "LI", "UL", "OL", "H1", "H2", "H3"]);
const HEADING_MARKER: Record<string, string> = {
  H1: "# ",
  H2: "## ",
  H3: "### ",
};

/**
 * Read a contentEditable back to text. innerText alone drops the markers, so walk
 * the tree: insert a newline at each block boundary, prefix every <li> with "* "
 * and each heading with its "#"s, so headings and lists round-trip as markdown
 * the published post can render.
 */
function readEditor(el: HTMLDivElement | null): string {
  if (!el) return "";
  let out = "";
  const newline = () => {
    if (out && !out.endsWith("\n")) out += "\n";
  };
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += (child.textContent ?? "").replace(/\u00A0/g, " ");
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = (child as Element).tagName;
        if (tag === "BR") {
          newline();
          return;
        }
        const isBlock = BLOCK_TAGS.has(tag);
        if (isBlock) newline();
        if (tag === "LI") out += "* ";
        else if (HEADING_MARKER[tag]) out += HEADING_MARKER[tag];
        walk(child);
        if (isBlock) newline();
      }
    });
  };
  walk(el);
  return out.replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
}

function clearEditor(el: HTMLDivElement | null) {
  if (el) el.innerHTML = "";
}

/**
 * Markdown-style list autoformat: when the line the caret sits on is just "* "
 * (or "- "), drop the marker and turn the line into a bullet. The browser then
 * handles Enter-to-continue and Enter-on-empty-to-exit natively. No-op unless
 * the line is exactly the marker and we're not already inside a list.
 */
function maybeStartList(el: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.anchorNode) return false;
  const node = sel.anchorNode;
  if (node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return false;
  const marker = (node.textContent ?? "").replace(/\u00A0/g, " ");
  if ((marker !== "* " && marker !== "- ") || sel.anchorOffset !== marker.length) {
    return false;
  }
  if (node.parentElement?.closest("ul,ol")) return false;
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, (node.textContent ?? "").length);
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand("delete");
  document.execCommand("insertUnorderedList");
  return true;
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
