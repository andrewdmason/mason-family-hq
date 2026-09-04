"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  CornerDownLeft,
  CornerUpLeft,
  Loader2,
  RotateCcw,
  Check,
  Link2,
  LogOut,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AnnotationDetail,
  ReaderChatMessage,
  ReaderChatModelPreference,
  ReaderChatTemplate,
} from "@/lib/reading/annotation-types";
import { READER_CHAT_TEMPLATE_OPENERS } from "@/lib/reading/annotation-types";
import {
  startsWithHumanMention,
  type MentionTarget,
} from "@/lib/reading/mentions";
import { getAnnotation } from "@/app/(reading)/reader/annotation-actions";
import { markThreadRead } from "@/app/(reading)/reader/thread-actions";
import { MentionText } from "./mention-text";
import { sharedMarkHref } from "@/lib/reading/links";
import {
  MentionTypeahead,
  matchTargets,
  mentionQueryAt,
} from "./mention-typeahead";
import { streamReply } from "@/lib/reading/chat-stream";
import { chapterSummaryQuestion } from "@/lib/reading/chapter-summary";
import { chapterName } from "@/lib/reading/chapter-target";
import { useIsOnline } from "@/lib/reading/offline/use-is-online";
import { ChatMessageText } from "./chat-message-text";
import { PromptInspector } from "./prompt-inspector";
import { useAutosizeTextarea } from "./use-autosize-textarea";

/**
 * What Enter does here is a property of the THREAD, not of the line.
 *
 * An Ask thread has Nor in it and Enter asks him; a Note thread doesn't and
 * Enter keeps the line. The toolbar decided which when the mark was made, and
 * nothing typed changes it — briefly there was an `@nor` handle that did, and
 * addressing the assistant by name every turn was worse than choosing once.
 * Two escape hatches, both inside an Ask thread: ⌘↵ keeps a line without a
 * reply, and opening with a person's name addresses them rather than him.
 */

let localSeq = 0;
const localId = () => `local-${++localSeq}`;

/**
 * What the blank state offers, in the order it offers it.
 *
 * The wording matters more here than anywhere else in the feature — see the
 * comment at the render site. "Interpretive check-in" would never be clicked by
 * anybody; "Check in" is the thing you would actually say.
 */
const TEMPLATE_PILLS: { template: ReaderChatTemplate; label: string }[] = [
  { template: "reading_key", label: "How should I read this?" },
  { template: "check_in", label: "Check in" },
];

export function AnnotationThread({
  chat,
  chapterTitle = null,
  memberEmail,
  isArticle,
  mentionTargets,
  onAddNote,
  hasRealPages,
  labelForPage,
  onJumpToPage,
  onJumpToAnchor,
  onDelete,
  onBack,
  onClose,
  onTouched,
  onExchangeComplete,
  onSpoilerFreeChange,
  onModelChange,
  onPickTemplate,
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
   * Everyone who can be named here. Passed in rather than fetched: the same
   * list has to reach the server that decides what a name grants, and two
   * lists is two answers to who @jenny is.
   */
  mentionTargets: MentionTarget[];
  /**
   * Append a note to the thread. Gets no reply, but does have to reach the
   * server — it rejects if the write fails so the thread can hand the words back
   * rather than showing them saved when they aren't.
   */
  onAddNote: (text: string) => Promise<void>;
  hasRealPages: boolean;
  labelForPage: (page: number) => string | null;
  onJumpToPage: (page: number) => void;
  /**
   * Scroll the book to where this conversation is anchored.
   *
   * Absent on an article, whose anchors are DOM-text offsets rather than
   * positions in the conversion character space — the jump would land somewhere
   * arbitrary, and a link that goes to the wrong place is worse than no link.
   * Absent on the document threads too, which have no spot in the text at all.
   */
  onJumpToAnchor?: () => void;
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
   * Turn this blank chat into one of the two mid-book conversations.
   *
   * Must not resolve until the row actually carries the template, because the
   * opening question is sent the moment it does — see pickTemplate. Absent on
   * the document threads, which offer none of this.
   */
  onPickTemplate?: (template: ReaderChatTemplate) => Promise<void>;
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
  /** The prompt inspector — see the "prompt" link in the header. */
  const [promptOpen, setPromptOpen] = useState(false);
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
  /**
   * True from the moment a question is sent until its answer has finished
   * arriving. `sending` goes false as soon as the request is in flight, so it is
   * not enough on its own to keep a poll off the placeholder being streamed into.
   */
  const streamingRef = useRef(false);
  const [copied, setCopied] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<{
    query: string;
    start: number;
  } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const isSummary = chat.chapterAnchorId != null;
  const isShared = chat.participants.length > 1;
  const sharedBy = chat.participants.find((p) => p.userId === chat.sharedFromUserId);
  const confirmLeave = sharedBy
    ? `Take this out of your margin? ${sharedBy.name} keeps the conversation.`
    : "Take this out of your margin? The conversation stays with the others in it.";

  /**
   * Whether Enter sends this line to Nor.
   *
   * The thread decides, and the one thing typed that overrides it is opening
   * with a person's name — that addresses them, and he sits the turn out.
   * Recomputed per keystroke only for the placeholder's sake.
   */
  const willAskNor =
    chat.aiParticipant && !startsWithHumanMention(draft, mentionTargets);
  // Asking needs a model, so it is the one thing here that genuinely cannot work
  // without a connection. Writing to the other person does not, so offline never
  // disables the composer — it just holds Nor back and keeps the line instead.
  const norOn = willAskNor && online;

  const mentionCandidates = mentionQuery
    ? matchTargets(mentionTargets, mentionQuery.query)
    : [];

  /** Replace the half-typed handle with the real one, and keep the caret. */
  const pickMention = useCallback(
    (target: MentionTarget) => {
      if (!mentionQuery) return;
      const el = inputRef.current;
      const caret = el?.selectionStart ?? draft.length;
      const next =
        draft.slice(0, mentionQuery.start) +
        `@${target.handle} ` +
        draft.slice(caret);
      setDraft(next);
      setMentionQuery(null);
      setMentionIndex(0);
      const at = mentionQuery.start + target.handle.length + 2;
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(at, at);
      });
    },
    [draft, mentionQuery]
  );
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
  // Opening a shared conversation is reading it — the badge clears here rather
  // than on the next fetch, so the dot goes away when you look at the thing it
  // was pointing at. Fire-and-forget: a missed stamp costs one stale dot.
  useEffect(() => {
    if (!isShared) return;
    void markThreadRead(chat.threadId).catch(() => {});
  }, [chat.threadId, isShared]);

  /**
   * Pick up what the other person said, without ever stepping on a reply that
   * is still arriving.
   *
   * Polling rather than a live socket: this app has no realtime anywhere, and
   * the reader — offline-capable, sometimes on an e-ink screen — is the wrong
   * route on which to open the first one. Only while the panel is open, only
   * while the tab is visible, and only when somebody else is actually in the
   * conversation.
   *
   * The pause while sending or streaming is the important part. A poll landing
   * mid-stream would replace the placeholder the answer is being written into,
   * and the reader would watch a reply disappear as it was being typed.
   *
   * The merge keeps anything local that the server has not confirmed yet, and
   * appends whatever is new. The thread deliberately does NOT sync from props
   * for the same reason this is careful — see the note on `messages` above.
   */
  useEffect(() => {
    if (!isShared) return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled || sending || streamingRef.current) return;
      if (document.visibilityState !== "visible") return;
      try {
        const fresh = await getAnnotation(chat.id, memberEmail);
        if (cancelled || !fresh || sending || streamingRef.current) return;
        setMessages((prev) => {
          const local = prev.filter((m) => m.id.startsWith("local-"));
          const serverIds = new Set(fresh.messages.map((m) => m.id));
          const kept = local.filter((m) => !serverIds.has(m.id));
          if (
            kept.length === 0 &&
            prev.length === fresh.messages.length &&
            prev.every((m, i) => m.id === fresh.messages[i]?.id)
          ) {
            return prev;
          }
          return [...fresh.messages, ...kept];
        });
      } catch {
        // A failed poll is a poll that didn't happen. The next one is in 8s.
      }
    };

    const timer = setInterval(poll, 8000);
    const onVisible = () => void poll();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [chat.id, isShared, memberEmail, sending]);

  useEffect(() => {
    if (!startedEmpty || isSummary) return;
    inputRef.current?.focus();
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


  const keepMessage = useCallback(async () => {
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
      {
        id: noteId,
        authorUserId: null,
        mentions: [],
        role: "note",
        content: text,
        model: null,
        createdAt: "",
      },
    ]);

    try {
      await onAddNote(text);
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

  /**
   * Ask, and stream the answer back.
   *
   * Takes the text explicitly so a template can open its own conversation
   * without the reader typing — see the effect below. The composer reaches this
   * through submit(), which decides between the two paths.
   */
  const send = useCallback(async (override?: string) => {
    const text = (override ?? draft).trim();
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
    // Held for the whole life of the answer, so a poll can't replace the bubble
    // it is being written into.
    streamingRef.current = true;

    const userId = localId();
    const assistantId = localId();
    setMessages((prev) => [
      ...prev,
      {
        id: userId,
        authorUserId: null,
        mentions: [],
        role: "user",
        content: text,
        model: null,
        createdAt: "",
      },
      {
        id: assistantId,
        authorUserId: null,
        mentions: [],
        role: "assistant",
        content: "",
        model: null,
        createdAt: "",
      },
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
            authorUserId: null,
            mentions: [],
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
      streamingRef.current = false;
      // Whatever happened to the reply, the route persisted the user's turn
      // before streaming — so this annotation is a chat now, and the list that
      // decides its colour and its margin icon needs to hear about it.
      onExchangeComplete();
    }
  }, [draft, sending, chat.id, memberEmail, onTouched, onExchangeComplete, resolveChatId]);

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
  /**
   * What Enter does.
   *
   * Two paths underneath, and deliberately so: asking commits the question
   * server-side before it streams, so a reply that dies leaves a thread you can
   * carry on from, while keeping a line has to be able to hand the words back
   * if the write fails. Those are genuinely different failure stories and
   * flattening them would lose the better half of each.
   *
   * `asNote` is ⌘↵: keep the line even in a thread Nor is in. A thought you
   * want on the record next to the passage without an answer under it.
   */
  const submit = useCallback(
    async (asNote = false) => {
      if (willAskNor && online && !asNote) await send();
      else await keepMessage();
    },
    [keepMessage, online, send, willAskNor]
  );

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
      {
        id: userId,
        authorUserId: null,
        mentions: [],
        role: "user",
        content: question,
        model: null,
        createdAt: "",
      },
      {
        id: assistantId,
        authorUserId: null,
        mentions: [],
        role: "assistant",
        content: "",
        model: null,
        createdAt: "",
      },
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
   * Take one of the two mid-book conversations offered in the blank state.
   *
   * The settings write has to LAND BEFORE the send, and that ordering is the
   * whole of this function. The route rebuilds the system prompt from the row on
   * every turn, so a question that overtakes the update gets answered with no
   * register at all — and the failure is invisible, because a plain Deep answer
   * about the book is perfectly plausible. It is just not the one asked for.
   *
   * What actually gets sent is the short human line. The long instruction it
   * stands for lives in the prompt and is never shown, so the transcript reads
   * like a conversation the reader had rather than one that was staged — which
   * matters beyond taste, because these threads are part of what the afterword
   * is built from at the end of the book.
   */
  const pickTemplate = useCallback(
    async (template: ReaderChatTemplate) => {
      if (sending || !onPickTemplate) return;
      setError(null);
      try {
        await onPickTemplate(template);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't start that conversation."
        );
        return;
      }
      void send(READER_CHAT_TEMPLATE_OPENERS[template]);
    },
    [onPickTemplate, send, sending]
  );

  /**
   * Whether to offer them at all.
   *
   * A genuinely blank thread only. Not a recap, which asks its own question the
   * moment it opens; not a thread with anything in it; and not an article, which
   * has no middle to be in the middle of.
   *
   * AND NOTHING ATTACHED TO A PASSAGE. A highlight and a note both open a thread
   * with an empty transcript, so an emptiness check alone offered a book-wide
   * conversation at the bottom of a sentence somebody had underlined weeks ago.
   * These were briefly shown on passage chats on purpose, reasoning that
   * selecting a sentence is not a commitment to asking about that sentence —
   * true of a selection you just made, and plainly wrong for a highlight you are
   * coming back to, which is a thing you already made rather than a blank page.
   * The distinction is not worth chasing: whole-book conversations belong to
   * chats about a place in the book, not to marks on a passage.
   *
   * The note check is belt and braces — a note is a message, so a thread holding
   * one is not empty anyway — but it says the rule out loud rather than leaving
   * it to be re-derived.
   */
  const offerTemplates =
    !!onPickTemplate &&
    chat.aiParticipant &&
    !isArticle &&
    !isSummary &&
    !chat.template &&
    !chat.quotedText &&
    chat.noteCount === 0 &&
    messages.length === 0;

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

  /**
   * Copy a link to this mark.
   *
   * Addressed by the CONVERSATION rather than by this book, because the person
   * you send it to opens their own copy — see sharedMarkHref. It does not grant
   * anything: someone who was never mentioned here lands on their shelf instead.
   * Sharing is still an act of saying somebody's name.
   */
  const copyLink = useCallback(async () => {
    const url = `${window.location.origin}${sharedMarkHref(chat.threadId)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // The clipboard API is refused outside a secure context — which includes
      // reading over the LAN from another device, exactly when you are most
      // likely to want to send somebody a link. The old selection trick still
      // works there.
      const el = document.createElement("textarea");
      el.value = url;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.append(el);
      el.select();
      try {
        document.execCommand("copy");
      } finally {
        el.remove();
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [chat.threadId]);

  /** Where this conversation lives, in the reader's own terms. */
  const locationLabel = isSummary
    ? chapterTitle
      ? chapterName(chapterTitle)
      : "Chapter summary"
    : chat.anchorPage != null && hasRealPages
      ? `Page ${chat.anchorPage}`
      : chat.quotedText
        ? "On a passage"
        : "In the text";

  const modelLabel = chat.modelPreference === "deep" ? "Deep" : "Fast";
  // What the chat can see, in the reader's terms. Doubles as live feedback while
  // the boundary is still a control: ticking the box rewrites this line.
  const scope = !chat.aiParticipant
    ? "Notes — Nor isn't in this one"
    : isSummary
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
          {/* The title already names where this conversation lives, so it is
              also the way back to it — a chat opened from the marks list is
              otherwise stranded, since opening one deliberately does not move
              the book out from under you.

              Not a link on an article, whose anchors are measured in a different
              space and would land somewhere arbitrary. */}
          {onJumpToAnchor ? (
            <button
              type="button"
              onClick={onJumpToAnchor}
              title="Go to this spot in the book"
              className="flex w-full min-w-0 items-center gap-1 text-left text-xs font-medium text-foreground transition-colors hover:text-foreground/70"
            >
              <span className="truncate">{locationLabel}</span>
              <CornerUpLeft className="h-3 w-3 shrink-0 opacity-50" />
            </button>
          ) : (
            <p className="truncate text-xs font-medium text-foreground">
              {locationLabel}
            </p>
          )}
          {/* Once settled this line IS the chat's settings, stated rather than
              offered — which is why the picker and the checkbox that used to
              live in this header and under the composer are gone from a chat
              that has been asked something. Before then it describes only what
              the controls down by the composer are currently set to. */}
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className="truncate">
              {settled && chat.aiParticipant
                ? `${modelLabel} · ${scope}`
                : scope}
            </span>
            {/* The way in to what the model was actually told. Hung off the line
                that already describes this chat's settings, because that is the
                same question asked in less detail — and kept to a small text
                link rather than another icon, since it is a debugging affordance
                rather than a reading one.

                Hidden until the row exists: the id is a client-side stand-in
                until the insert lands, and there is nothing on the server to
                describe under that id. And never on a Note thread, where no
                prompt is ever built. */}
            {chat.aiParticipant && !chat.id.startsWith("pending:") && (
              <>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={() => setPromptOpen(true)}
                  className="shrink-0 underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
                >
                  prompt
                </button>
              </>
            )}
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
        {/* Hidden until the row exists: a mark created a moment ago has no
            conversation id yet, and a link to nothing is worse than no link. */}
        {chat.threadId ? (
          <button
            type="button"
            onClick={() => void copyLink()}
            aria-label="Copy link to this mark"
            title={
              copied
                ? "Copied"
                : "Copy link — opens this passage in their own copy"
            }
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-foreground" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
        {/* On your own mark this is a delete and always has been. On one
            somebody left you it is a LEAVE — it takes the mark out of your
            margin and leaves them everything the two of you wrote, which is the
            only defensible reading of a bin on another person's passage. And it
            asks first, because once there is a second person in a thread an
            unconfirmed tap can destroy something that was not only yours. */}
        <button
          type="button"
          onClick={() => {
            if (isShared && !window.confirm(confirmLeave)) return;
            onDelete();
          }}
          aria-label={isShared ? "Leave this conversation" : "Delete chat"}
          title={isShared ? "Leave — the conversation stays with them" : undefined}
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
        >
          {isShared ? (
            <LogOut className="h-3.5 w-3.5" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
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
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3"
      >
        {chat.quotedText && (
          <blockquote className="mb-3 shrink-0 border-l-2 border-border pl-3 font-serif text-sm leading-6 text-muted-foreground italic">
            {chat.quotedText}
          </blockquote>
        )}

        <div className="flex shrink-0 flex-col gap-3">
          {messages.map((m) =>
            m.role === "note" ? (
              // Not a bubble. A note is the reader writing in the margin, not a
              // turn in a conversation, so it reads as writing on the page —
              // full width, a rule down the side, no sender.
              <div
                key={m.id}
                className="border-l-2 border-foreground/25 py-0.5 pl-3"
              >
                <p className="text-sm leading-6 text-foreground">
                  <MentionText content={m.content} mentions={m.mentions} />
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
                  // over two lines shouldn't come back as one — with the names
                  // in it picked out and nothing else touched.
                  <MentionText content={m.content} mentions={m.mentions} />
                )}
              </div>
            )
          )}
        </div>

        {/* The two mid-book conversations, offered where an empty thread has
            nothing else in it.

            Pushed to the BOTTOM of the empty space rather than sitting under the
            header: they belong to the composer, as things you could say instead
            of typing, and floating them at the top would read as a heading for a
            conversation that hasn't started.

            These are the whole recruiting surface for the feature. Nothing in
            the app ever suggests them — no nudge on reopening a book, nothing
            firing on a page count, nothing noticing a reader is struggling — so
            whether they are ever used on the book that needs them comes down
            entirely to whether these words look like the thing you want while
            you are annoyed with a novel. */}
        {offerTemplates && (
          <div className="mt-auto flex flex-col items-start gap-1.5 pt-6">
            <span className="text-[11px] text-muted-foreground">
              Or talk about the book as a whole
            </span>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_PILLS.map(({ template, label }) => (
                <button
                  key={template}
                  type="button"
                  disabled={sending || !online}
                  onClick={() => void pickTemplate(template)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {(error || createError) && (
          <p className="mt-3 shrink-0 text-xs text-destructive">
            {error ?? createError}
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        {/* How this conversation will work: which model answers it, and how much
            of the book it reads. Properties of the THREAD, so they're gone the
            moment it has an answer in it and the header states them instead.
            A summary never shows them — it asks itself the moment it opens, so
            there's no point at which they'd be anything but decorative.

            Nor does a template, for that reason and one more. It asks itself
            too, so `settled` would go true a frame later and these would flash
            once and vanish. And the reader picked a CONVERSATION, not a set of
            settings: both templates need the whole book and the stronger model
            to be what they are, so offering to turn either off would be
            offering to break the thing they just asked for.

            Never on a Note thread. Nothing written there goes near a model,
            and the two controls would be describing a question this thread
            cannot ask. */}
        {chat.aiParticipant && !settled && !isSummary && !chat.template && (
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
        <div className="relative flex items-end gap-2">
          {mentionQuery ? (
            <MentionTypeahead
              candidates={mentionCandidates}
              activeIndex={mentionIndex}
              onPick={pickMention}
            />
          ) : null}
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const q = mentionQueryAt(
                e.target.value,
                e.target.selectionStart ?? e.target.value.length
              );
              setMentionQuery(q);
              setMentionIndex(0);
            }}
            onKeyDown={(e) => {
              // While the menu is open it owns the arrows and Enter, but only
              // then — the textarea keeps focus throughout, so there is nothing
              // to hand back and nothing for iOS to close the keyboard over.
              if (mentionQuery && mentionCandidates.length > 0) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setMentionIndex((i) => (i + 1) % mentionCandidates.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setMentionIndex(
                    (i) =>
                      (i - 1 + mentionCandidates.length) % mentionCandidates.length
                  );
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  pickMention(mentionCandidates[mentionIndex]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMentionQuery(null);
                  return;
                }
              }
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              // ⌘↵ keeps the line without a reply. A shortcut rather than a
              // control because it is rare: the thread already knows what
              // Enter does, and a permanent second button would be furniture.
              void submit(e.metaKey || e.ctrlKey);
            }}
            rows={2}
            // Never disabled. Losing the connection stops Nor answering, which
            // the placeholder says; it does not stop you writing to the person
            // you are reading with, and it never stopped you writing to yourself.
            placeholder={
              norOn
                ? isSummary
                  ? "Ask Nor about this chapter…"
                  : "Ask Nor about this part…"
                : chat.aiParticipant && !online
                  ? "Offline — write a note…"
                  : "Write a note…"
            }
            className="min-h-[3.375rem] flex-1 resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={sending || draft.trim().length === 0}
            aria-label="Send"
            title={
              chat.aiParticipant ? "Send (↵) · Keep as a note (⌘↵)" : "Send (↵)"
            }
            className="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CornerDownLeft className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <PromptInspector
        chatId={chat.id}
        memberEmail={memberEmail}
        open={promptOpen}
        onOpenChange={setPromptOpen}
      />
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
