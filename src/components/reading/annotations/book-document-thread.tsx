"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CornerDownLeft, Loader2, Trash2, X } from "lucide-react";
import {
  BOOK_DOCUMENT_INTERVIEW_HINT,
  BOOK_DOCUMENT_LABEL,
  BOOK_DOCUMENT_NOUN,
  documentHeading,
  writeDocumentLabel,
  type BookScope,
} from "@/lib/reading/book-documents";
import type {
  AnnotationDetail,
  ReaderChatMessage,
} from "@/lib/reading/annotation-types";
import { streamReply } from "@/lib/reading/chat-stream";
import { useIsOnline } from "@/lib/reading/offline/use-is-online";
import { cn } from "@/lib/utils";
import { ChatMessageText } from "./chat-message-text";
import { useAutosizeTextarea } from "./use-autosize-textarea";

/**
 * The reader's preface or afterword, in the panel beside the book.
 *
 * It lived on a page of its own for a while — full width, the book's typeface —
 * which read better and cost the one thing that turned out to matter more. A
 * document cites pages, and in the panel following a citation moves the BOOK,
 * behind a conversation that stays open. On a page that covered the book, the
 * same tap could only take you away from what you were reading. Being able to
 * walk your own afterword back through the passages it is about, without
 * losing it, is worth more than the extra column.
 *
 * What you arrive on is the document. The conversation that produced it is
 * folded away beneath, because opening this should feel like opening the thing
 * rather than reviewing how it was made — but it is one tap away, and after
 * that the panel is an ordinary thread you can keep talking to.
 *
 * There is exactly one document and one way to change it: delete it and start
 * over. No regenerate, no resumable interview, no versions stacked under each
 * other — all of which existed briefly and were more to explain than they were
 * worth.
 */

let localSeq = 0;
const localId = () => `local-${++localSeq}`;

export function BookDocumentThread({
  chat,
  scope,
  memberEmail,
  hasRealPages,
  labelForPage,
  onJumpToPage,
  onDelete,
  onBack,
  onClose,
  onTouched,
  onExchangeComplete,
  dockToggle,
}: {
  chat: AnnotationDetail;
  scope: BookScope;
  memberEmail: string | null;
  hasRealPages: boolean;
  labelForPage: (page: number) => string | null;
  /** Moves the book behind the panel. The panel stays exactly where it is. */
  onJumpToPage: (page: number) => void;
  onDelete: () => void;
  onBack: () => void;
  onClose: () => void;
  /** Fired the first time anything is committed here. */
  onTouched: () => void;
  onExchangeComplete: () => void;
  dockToggle?: React.ReactNode;
}) {
  const [messages, setMessages] = useState<ReaderChatMessage[]>(chat.messages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * What the interview is doing while it has nothing to say — currently only
   * ever "Searching the web…". Cleared however the turn ends, so a failed one
   * can't strand it on screen.
   */
  const [status, setStatus] = useState<string | null>(null);
  const online = useIsOnline();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pinnedToBottom = useRef(true);
  // An interview answer runs to a paragraph; two rows is a slot you can only
  // see the end of what you wrote in.
  useAutosizeTextarea(inputRef, draft);

  const documents = messages.filter((m) => m.role === "document");
  const latest = documents.at(-1) ?? null;
  const rest = messages.filter((m) => m !== latest);

  /**
   * Whether the making-of is showing.
   *
   * Closed on arrival when there is already a document, which is the whole
   * point: opening your afterword should put the afterword in front of you, not
   * the eight questions that produced it. Open when there isn't one, because
   * then the conversation IS the thing.
   */
  const [showConversation, setShowConversation] = useState(() => latest == null);

  // Follow new content only while pinned, and only inside the panel — the page
  // behind it stays where the reader left it.
  useEffect(() => {
    if (!pinnedToBottom.current || !showConversation) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, showConversation]);

  /**
   * One turn: the next interview question, a reply to something typed, or the
   * document itself. All three go to the same route, which differs only in what
   * it persists — so they differ here only in what appears while it streams.
   */
  const run = useCallback(
    async (phase: "converse" | "document", text: string | null) => {
      if (sending) return;
      setError(null);
      setSending(true);
      onTouched();
      pinnedToBottom.current = true;
      // A document is read from the top; a turn of the interview lands at the
      // bottom of a conversation that therefore has to be open to see.
      if (phase === "document") {
        setShowConversation(false);
        scrollRef.current?.scrollTo({ top: 0 });
      } else {
        setShowConversation(true);
      }

      const userId = localId();
      const replyId = localId();
      setMessages((prev) => [
        ...prev,
        ...(text
          ? [
              {
                id: userId,
                role: "user" as const,
                content: text,
                model: null,
                createdAt: "",
              },
            ]
          : []),
        {
          id: replyId,
          role: phase === "document" ? ("document" as const) : ("assistant" as const),
          content: "",
          model: null,
          createdAt: new Date().toISOString(),
        },
      ]);

      try {
        const res = await fetch("/reader/api/book-document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            annotationId: chat.id,
            phase,
            userMessage: text,
            memberEmail,
          }),
        });
        if (!res.ok || !res.body) {
          throw new Error((await res.text()) || "Couldn't do that.");
        }
        const failed = await streamReply(
          res.body,
          (streamed) =>
            setMessages((prev) =>
              prev.map((m) => (m.id === replyId ? { ...m, content: streamed } : m))
            ),
          setStatus
        );
        if (failed) {
          setError(failed);
          setMessages((prev) => prev.filter((m) => m.id !== replyId));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't do that.");
        setMessages((prev) => prev.filter((m) => m.id !== replyId));
        if (text) setDraft(text);
      } finally {
        setStatus(null);
        setSending(false);
        onExchangeComplete();
      }
    },
    [chat.id, memberEmail, onExchangeComplete, onTouched, sending]
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    await run("converse", text);
  }, [draft, run, sending]);

  /**
   * Both of these ask their first question the moment they open. Navigating
   * here WAS the asking, and a panel that waits to be told to start makes you
   * say the same thing twice.
   *
   * Guarded by a ref rather than by the dependency list: `run` is rebuilt
   * whenever anything it closes over changes, and re-running this would throw
   * away a question mid-stream and ask another.
   */
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current || chat.messages.length > 0) return;
    openedRef.current = true;
    void run("converse", null);
  }, [chat.messages.length, run]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
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
            {BOOK_DOCUMENT_LABEL[scope]}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {scope === "preface" ? "Before you read it" : "Everything you marked in it"}
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete your ${BOOK_DOCUMENT_NOUN[scope]}`}
          title={`Delete your ${BOOK_DOCUMENT_NOUN[scope]} and start over`}
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        {dockToggle}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedToBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop < 32;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {latest && (
          <article>
            <p className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {documentHeading(scope, latest.createdAt || null)}
            </p>
            {latest.content === "" ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              // Set in the book's face rather than the chat's: this is the part
              // you come back to, and it should not read as one more turn.
              <div className="font-serif text-[0.95rem] leading-7 text-foreground">
                <ChatMessageText
                  text={latest.content}
                  hasRealPages={hasRealPages}
                  labelForPage={labelForPage}
                  onJumpToPage={onJumpToPage}
                  spacing="document"
                />
              </div>
            )}
          </article>
        )}

        {rest.length > 0 &&
          (latest ? (
            <div className="mt-6 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => setShowConversation((v) => !v)}
                aria-expanded={showConversation}
                className="flex w-full items-center gap-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 transition-transform",
                    showConversation && "rotate-90"
                  )}
                />
                How this came about
              </button>
              {showConversation && (
                <Transcript
                  messages={rest}
                  scope={scope}
                  hasRealPages={hasRealPages}
                  labelForPage={labelForPage}
                  onJumpToPage={onJumpToPage}
                  status={status}
                />
              )}
            </div>
          ) : (
            <Transcript
              messages={rest}
              scope={scope}
              hasRealPages={hasRealPages}
              labelForPage={labelForPage}
              onJumpToPage={onJumpToPage}
              status={status}
            />
          ))}

        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        {/* Only while there is nothing yet. Once written, this has one control
            and it is the bin, up in the header. The escape hatch beside the
            button is load-bearing: the interview begins on its own, so this is
            what says you never have to finish it. */}
        {!latest && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void run("document", null)}
              disabled={!online || sending}
              className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
            >
              {writeDocumentLabel(scope)}
            </button>
            <p className="text-[11px] text-muted-foreground">
              {BOOK_DOCUMENT_INTERVIEW_HINT}
            </p>
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
              void send();
            }}
            rows={2}
            disabled={!online}
            placeholder={
              !online
                ? "This needs a connection"
                : latest
                  ? `Ask about your ${BOOK_DOCUMENT_NOUN[scope]}…`
                  : "Answer, or say what you think…"
            }
            className="min-h-[3.375rem] flex-1 resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
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
      </div>
    </div>
  );
}

/**
 * The conversation under the document: the interview that produced it, and
 * anything asked about it since.
 *
 * A document is still rendered as prose with its date rather than as a turn, so
 * that a thread which somehow holds two — a write that raced itself — reads as
 * two documents rather than as two things the assistant happened to say.
 */
function Transcript({
  messages,
  scope,
  hasRealPages,
  labelForPage,
  onJumpToPage,
  status,
}: {
  messages: ReaderChatMessage[];
  scope: BookScope;
  hasRealPages: boolean;
  labelForPage: (page: number) => string | null;
  onJumpToPage: (page: number) => void;
  /**
   * What the pending turn is waiting on, when there is anything to say about
   * it. Passed down rather than read here: named `status`, an undeclared one
   * silently resolves to `window.status` and renders nothing at all.
   */
  status: string | null;
}) {
  return (
    <div className="mt-3 flex flex-col gap-3">
      {messages.map((m) =>
        m.role === "document" ? (
          <div key={m.id} className="rounded-md bg-muted/40 px-3 py-2">
            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {documentHeading(scope, m.createdAt || null)}
            </p>
            <div className="font-serif text-sm leading-6 text-muted-foreground">
              <ChatMessageText
                text={m.content}
                hasRealPages={hasRealPages}
                labelForPage={labelForPage}
                onJumpToPage={onJumpToPage}
              />
            </div>
          </div>
        ) : m.role === "note" ? (
          <div key={m.id} className="border-l-2 border-foreground/25 py-0.5 pl-3">
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
              // A search is long enough that an unexplained spinner reads as a
              // hang — say what the wait is for when there is something to say.
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
              <span className="whitespace-pre-wrap">{m.content}</span>
            )}
          </div>
        )
      )}
    </div>
  );
}
