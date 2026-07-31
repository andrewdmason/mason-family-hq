"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createAnnotation,
  deleteAnnotation,
  discardAnnotationIfEmpty,
  forkAnnotation,
  getAnnotation,
  getAnnotationData,
  setBookSpoilerFree,
  setAnnotationModelPreference,
  setAnnotationNote,
} from "@/app/(reading)/reader/annotation-actions";
import { blockIndexForCharOffset, type BookBlock } from "@/lib/reading/block-stream";
import { note, startTimer, time } from "@/lib/reading/perf";
import {
  anchorForGap,
  anchorFromRange,
  type AnchorSpace,
  type ResolvedAnchor,
} from "@/lib/reading/annotation-anchors";
import type {
  ReaderAnnotationData,
  AnnotationDetail,
  ReaderChatModelPreference,
} from "@/lib/reading/annotation-types";
import { AnnotationPanel } from "./annotation-panel";
import { AnnotationList } from "./annotation-list";
import { AnnotationsButton } from "./annotations-button";
import { AnnotationThread } from "./annotation-thread";
import { GutterMarkers } from "./gutter-markers";
import { useGutterPlacement, type PagedGutterContext } from "./gutter-placement";
import { PanelDockToggle } from "./panel-dock-toggle";
import { ParagraphHoverTarget } from "./paragraph-hover-target";
import { SelectionToolbar, type SelectionIntent } from "./selection-toolbar";
import { annotationAtPoint, useAnnotationHighlights } from "./use-annotation-highlights";
import { useContentVersion } from "./use-content-version";

/**
 * Owns reader chat: loads the anchored chats for a book, renders the two ways to
 * start one and the markers that reopen them, and hosts the panel.
 *
 * Everything positional is computed from the book HTML the reader already
 * fetched (see block-stream.ts), so anchors resolve without measuring text —
 * which is why pagination didn't disturb any of it. Only the placement of the
 * markers cares how the book is laid out.
 */
/** Stable identity, so an article doesn't re-run every blocks-keyed memo. */
const NO_BLOCKS: BookBlock[] = [];

/**
 * An annotation the reader can see and type into before the server has heard
 * about it.
 *
 * The panel used to open only after `createAnnotation` came back, which meant
 * every "Ask" cost a database round trip before anything appeared. It now opens
 * on the click, against a stand-in row whose id is replaced by the real one when
 * the insert lands — usually while the reader is still typing their question.
 *
 * The window in between is small but has real states in it: the reader can send,
 * write a note, close, or delete, all before the row exists. Each is recorded
 * here and carried out by the create's own continuation, so nothing races the
 * insert. `onCreate` in particular is what keeps the discard guarantee intact:
 * an abandoned draft still gets thrown away, and it still can't be confused with
 * an ordinary highlight, because the id it discards can only ever have come from
 * this interaction's own insert.
 */
type PendingCreate = {
  /** Also the optimistic row's id, until the real one arrives. */
  clientId: string;
  /** Deliberately never rejects, so no continuation is an unhandled rejection. */
  result: Promise<{ ok: true; detail: AnnotationDetail } | { ok: false; error: Error }>;
  /** Server writes asked for while the row didn't exist, in the order asked. */
  queue: Promise<unknown>;
  /** Decided while the row didn't exist; honoured once it does. */
  onCreate: "keep" | "discardIfEmpty" | "delete";
  /**
   * True once the insert has come back. The record outlives that — the thread
   * may still be holding the stand-in id and need it translated — but only an
   * UNSETTLED one blocks starting another annotation.
   */
  settled: boolean;
};

function isPendingId(id: string): boolean {
  return id.startsWith("pending:");
}

export function ReaderAnnotationLayer({
  bookId,
  memberEmail,
  blocks: allBlocks,
  isArticle,
  contentRef,
  currentCharOffset,
  goToChar,
  paged,
  panelOpen,
  onPanelOpenChange,
  preferSheet,
  docked,
  canFloat,
  windowBase,
  layoutNonce,
}: {
  bookId: string;
  memberEmail: string | null;
  /** The book's block stream, mapped once by the reader and shared from there. */
  blocks: BookBlock[];
  /** Articles have no page map and no conversion char space — see AnchorSpace. */
  isArticle: boolean;
  contentRef: React.RefObject<HTMLDivElement | null>;
  /** Where the reader is now, in the conversion char space. */
  currentCharOffset: number;
  goToChar: (charOffset: number) => void;
  /** Non-null in paged mode; drives marker placement. */
  paged: PagedGutterContext | null;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  /** Present the chat over the book rather than beside it — see chatAsSheet. */
  preferSheet: boolean;
  /** The panel takes width from the book rather than sitting over it. */
  docked: boolean;
  /**
   * Whether floating is on offer at all. Only a paged book has a second column
   * worth protecting; a scrolling one is a single centred measure that simply
   * shifts, and a sheet has taken nothing to give back.
   */
  canFloat: boolean;
  /**
   * Global index of the first block currently rendered. Zero while the whole
   * book is in the DOM; non-zero once the paged reader windows it. Every
   * translation between a stored anchor and the page goes through this.
   */
  windowBase: number;
  layoutNonce: number;
}) {
  const [data, setData] = useState<ReaderAnnotationData | null>(null);
  const [detail, setDetail] = useState<AnnotationDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // Whether anything has been sent in the open chat. Drives both the discard on
  // close and whether clicking back into the book dismisses the panel.
  const [touched, setTouched] = useState(false);
  /**
   * The annotation THIS interaction created as an empty chat draft, if any.
   *
   * Load-bearing under the one-annotation model. "No messages" used to mean
   * "abandoned draft, throw it away"; now it also describes a perfectly good
   * highlight. Without this, opening a chat on a highlight you made last week
   * and closing it without typing would silently delete the highlight.
   */
  const [draftId, setDraftId] = useState<string | null>(null);
  /** The panel shows one annotation, or the index of all of them. */
  const [mode, setMode] = useState<"thread" | "list">("thread");
  /** Set when the row this panel is showing failed to save — see PendingCreate. */
  const [createError, setCreateError] = useState<string | null>(null);
  /** Bumped per open, so the thread remounts per annotation but not per id swap. */
  const [threadKey, setThreadKey] = useState(0);
  /** The row the panel is showing, while it exists only on this device. */
  const pendingRef = useRef<PendingCreate | null>(null);

  // Articles never touch the conversion char space: their HTML was never run
  // through convert.ts, so the block stream would be describing a stream that
  // doesn't exist.
  //
  // The blocks themselves arrive as a prop rather than being derived here. They
  // used to be a second `blockMap(html)` over the same string the reader had
  // already mapped — a regex pass over 1.1M characters, run twice on every open
  // for one copy of the answer.
  const blocks = isArticle ? NO_BLOCKS : allBlocks;
  const space = useMemo<AnchorSpace>(
    () => (isArticle ? { kind: "dom" } : { kind: "book", blocks, base: windowBase }),
    [isArticle, blocks, windowBase]
  );
  // Memoized, not `data?.chats ?? []`: a fresh array literal every render would
  // re-run the placement effect, which sets state, which renders again — a loop.
  const loaded = useMemo(() => data?.chats ?? [], [data]);

  /**
   * The loaded list with the OPEN annotation's live state laid over it.
   *
   * Necessary because what an annotation *is* now depends on its contents: send
   * the first message in a chat and it stops being a highlight. The summary list
   * only learns that on its next fetch, so without this overlay a brand-new
   * conversation keeps painting yellow and stays out of the margin until you
   * reload the page — which is exactly the bug this fixes. refreshList() below
   * makes it durable; this makes it immediate.
   */
  const chats = useMemo(() => {
    if (!detail) return loaded;
    // An annotation the server hasn't returned yet is still one the reader has
    // made, and they should see the passage marked the moment they act. It
    // dedupes itself: once refreshList lands, the row is in `loaded` under its
    // real id and this branch stops firing.
    if (!loaded.some((c) => c.id === detail.id)) {
      const { messages, ...summary } = detail;
      void messages;
      return [...loaded, summary];
    }
    return loaded.map((c) =>
      c.id === detail.id
        ? {
            ...c,
            note: detail.note,
            messageCount: Math.max(c.messageCount, detail.messages.length),
          }
        : c
    );
  }, [loaded, detail]);
  // Both of the things below are derived from the rendered content, so both
  // have to be re-derived when that content is swapped in or replaced. See
  // use-content-version.ts: layoutNonce alone does not reliably cover it.
  const contentVersion = useContentVersion(contentRef, layoutNonce);
  // Placed next to the hover target's own pass, in the same module, so the two
  // margins can't disagree about where a block is — see gutter-placement.ts.
  const gutterRows = useGutterPlacement(
    chats,
    contentRef,
    layoutNonce + contentVersion,
    paged,
    windowBase
  );
  // Annotated passages stay marked in the text.
  useAnnotationHighlights(
    chats,
    contentRef,
    detail?.id ?? null,
    layoutNonce + contentVersion,
    windowBase
  );
  const totalChars = useMemo(() => {
    const last = blocks.at(-1);
    return last ? last.charStart + last.text.length + 1 : 0;
  }, [blocks]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // A phone is always a sheet; so is any window where the book has no room to
  // sit beside a panel, which the reader works out from its own geometry and
  // tells us. See chatAsSheet in book-reader.tsx.
  const asSheet = isMobile || preferSheet;
  // Only offered where it changes something. On a sheet the book has no width to
  // give — that's why it's a sheet — and a scrolling column has no second column
  // to save, so the panel there is simply always docked.
  const dockToggle = canFloat && !asSheet ? <PanelDockToggle /> : null;

  useEffect(() => {
    let cancelled = false;
    void getAnnotationData(bookId, memberEmail)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bookId, memberEmail]);

  const refreshList = useCallback(() => {
    void getAnnotationData(bookId, memberEmail)
      .then(setData)
      .catch(() => {});
  }, [bookId, memberEmail]);

  /**
   * Which page a character offset falls on, from the marks the book shipped
   * with. The server works this out too when it creates an annotation; doing it
   * here as well is what lets the panel open with the right page on it before the
   * server has been asked.
   */
  const pageMarks = useMemo(
    () => [...(data?.pageMarks ?? [])].sort((a, b) => a.charStart - b.charStart),
    [data]
  );
  const pageForCharOffset = useCallback(
    (charOffset: number): number | null => {
      let page: number | null = null;
      for (const mark of pageMarks) {
        if (mark.charStart <= charOffset) page = mark.pageNumber;
        else break;
      }
      return page;
    },
    [pageMarks]
  );

  const openList = useCallback(() => {
    // Toggle: the same control and the same key close it again.
    if (panelOpen && mode === "list") {
      onPanelOpenChange(false);
      return;
    }
    setMode("list");
    setDraftId(null);
    onPanelOpenChange(true);
  }, [mode, onPanelOpenChange, panelOpen]);

  const openPanelWith = useCallback(
    (annotation: AnnotationDetail, asDraft = false) => {
      setMode("thread");
      setDetail(annotation);
      // A chat opened with an empty transcript is a draft until something is
      // sent — see closePanel.
      setTouched(annotation.messages.length > 0);
      setDraftId(asDraft ? annotation.id : null);
      setCreateError(null);
      // Bumped per open rather than keyed on the annotation's id, because that
      // id changes under an optimistic draft the moment the insert lands — and
      // remounting the thread then would throw away the half-typed question the
      // optimistic open exists to let them start.
      setThreadKey((k) => k + 1);
      onPanelOpenChange(true);
    },
    [onPanelOpenChange]
  );

  /** True while an annotation is being inserted — one at a time is plenty. */
  const isCreating = useCallback(
    () => pendingRef.current != null && !pendingRef.current.settled,
    []
  );

  /**
   * The real id for an annotation, waiting for its insert if it hasn't landed.
   *
   * Normally this returns immediately — the row exists, or the create settled
   * while the reader was typing. It only ever actually waits if they type and
   * send within the round trip.
   */
  const realIdFor = useCallback(async (id: string): Promise<string> => {
    const pending = pendingRef.current;
    if (!pending || pending.clientId !== id) return id;
    const result = await pending.result;
    if (!result.ok) throw result.error;
    return result.detail.id;
  }, []);

  /** Run a server write against an annotation that may not exist yet. */
  const onceCreated = useCallback(
    (id: string, run: (realId: string) => Promise<unknown>): Promise<unknown> => {
      const pending = pendingRef.current;
      if (!pending || pending.clientId !== id) return run(id);
      // Chained rather than fired in parallel, so a note written into a draft
      // commits before any discard that was also asked for while it was pending.
      pending.queue = pending.queue
        .then(() => pending.result)
        .then((result) => (result.ok ? run(result.detail.id) : undefined))
        .catch(() => {});
      return pending.queue;
    },
    []
  );

  /**
   * Open the panel now; create the row alongside it.
   *
   * Shared by the selection toolbar and the between-paragraphs target, which
   * differ only in the anchor they arrive with.
   */
  const openDraft = useCallback(
    (resolved: ResolvedAnchor, asDraft: boolean) => {
      const stopOpen = startTimer("annotate: click → panel");
      const clientId = `pending:${crypto.randomUUID()}`;
      const anchorPage = pageForCharOffset(resolved.anchorCharOffset);
      // Everything createAnnotation would have told us, predicted from what the
      // client already holds. The header reads from these, so getting them right
      // is what stops the panel visibly correcting itself a moment later.
      const spoilerFree = !isArticle && data?.spoilerFree === true;
      const optimistic: AnnotationDetail = {
        id: clientId,
        anchor: resolved.anchor,
        anchorCharOffset: resolved.anchorCharOffset,
        anchorPage,
        spoilerFree,
        contextThroughPage: spoilerFree ? anchorPage : null,
        quotedText: resolved.quotedText,
        note: null,
        // The column's default, and its only permitted value today.
        color: "yellow",
        modelPreference: "fast",
        forkedFromAnnotationId: null,
        messageCount: 0,
        lastMessageAt: null,
        createdAt: new Date().toISOString(),
        messages: [],
      };

      const result = createAnnotation({
        bookId,
        anchor: resolved.anchor,
        anchorCharOffset: resolved.anchorCharOffset,
        quotedText: resolved.quotedText,
        memberEmail,
      }).then(
        (detail) => ({ ok: true, detail }) as const,
        (error: unknown) => ({
          ok: false as const,
          error: error instanceof Error ? error : new Error("Couldn't save that annotation."),
        }) as const
      );
      const pending: PendingCreate = {
        clientId,
        result,
        queue: Promise.resolve(),
        onCreate: "keep",
        settled: false,
      };
      pendingRef.current = pending;

      openPanelWith(optimistic, asDraft);
      // Two frames: one for React to commit the panel, one for the browser to
      // paint it. This is the number the reader actually feels.
      requestAnimationFrame(() => requestAnimationFrame(() => stopOpen()));

      void result.then((settled) => {
        if (pendingRef.current !== pending) return;
        pending.settled = true;
        if (!settled.ok) {
          console.error("[reader] couldn't save that annotation", settled.error);
          setCreateError(settled.error.message);
          return;
        }
        const real = settled.detail;
        note("annotate: id settled", real.id);
        // Anything typed in the meantime outranks the empty row the server made.
        setDetail((d) => (d && d.id === clientId ? { ...real, note: d.note ?? real.note } : d));
        setDraftId((d) => (d === clientId ? real.id : d));

        const queued = pending.queue;
        const disposition = pending.onCreate;
        void queued
          .then(async () => {
            if (disposition === "delete") await deleteAnnotation(real.id, memberEmail);
            else if (disposition === "discardIfEmpty") {
              await discardAnnotationIfEmpty(real.id, memberEmail);
            }
          })
          .then(refreshList)
          .catch(() => {});
      });
    },
    [bookId, data, isArticle, memberEmail, openPanelWith, pageForCharOffset, refreshList]
  );

  /**
   * Closing a chat you never wrote in throws it away, so an abandoned draft
   * doesn't leave a marker in the margin. The row is created up front (the
   * anchor has to exist before there's anywhere to send to), so this is the
   * cleanup for it.
   *
   * Only ever the draft this interaction created: anything else on screen is an
   * annotation that already existed, and closing a panel is not a request to
   * delete it.
   *
   * Worth knowing exactly how much the server backstop covers, because it isn't
   * everything. It refuses to discard a row carrying a note or any message — so
   * notes and chats are safe twice over. A PLAIN HIGHLIGHT looks identical to an
   * abandoned draft in the database (no note, no messages), so nothing on the
   * server can tell them apart, and this `draftId` check is the only thing
   * standing between it and deletion. Do not route any other close path through
   * discardAnnotationIfEmpty.
   */
  const closePanel = useCallback(() => {
    const closing = detail;
    const wasTouched = touched;
    const wasDraft = closing != null && closing.id === draftId;
    onPanelOpenChange(false);
    setDetail(null);
    setDraftId(null);
    if (!closing || wasTouched || !wasDraft) return;

    const pending = pendingRef.current;
    if (pending && pending.clientId === closing.id) {
      // The row doesn't exist yet, so there is nothing to discard and nothing to
      // race the insert with. Record it; the create's own continuation carries
      // it out once it knows the id — see openDraft.
      pending.onCreate = "discardIfEmpty";
      return;
    }
    void discardAnnotationIfEmpty(closing.id, memberEmail)
      .then((discarded) => {
        if (discarded) refreshList();
      })
      .catch(() => {});
  }, [detail, draftId, memberEmail, onPanelOpenChange, refreshList, touched]);

  // `blockIndex` is global, like every index that reaches an anchor — the hover
  // target adds `windowBase` when it measures. See RenderedBlocks.
  const startAtGap = useCallback(
    (blockIndex: number) => {
      const container = contentRef.current;
      if (!container || busy || isCreating()) return;
      const resolved = anchorForGap(blockIndex, space, container);
      if (!resolved) return;
      openDraft(resolved, true);
    },
    [busy, contentRef, isCreating, openDraft, space]
  );

  /**
   * The three things a selection can become. They differ only in what the row
   * starts with and whether the panel opens — it is one annotation either way,
   * and any of them can grow into any other later.
   */
  const annotateSelection = useCallback(
    async (range: Range, intent: SelectionIntent) => {
      const container = contentRef.current;
      if (!container || busy || isCreating()) return;
      const resolved = time("anchor: from selection", () =>
        anchorFromRange(range, container, space)
      );
      // anchorFromRange reports its own reason — see fail() there.
      if (!resolved) return;

      // Notes and chats need somewhere to write, so they open the panel — and
      // they open it now, against a row that doesn't exist yet, rather than
      // after the round trip that creates it. See PendingCreate.
      //
      // "Note" deliberately does NOT pre-write an empty note. The row starts as
      // a highlight and becomes a note the moment you type something, so tapping
      // Note and changing your mind leaves a highlight rather than a blank entry
      // in the sidebar. Only "Ask" creates a discardable draft.
      if (intent !== "highlight") {
        openDraft(resolved, intent === "ask");
        return;
      }

      // Highlighting is a one-gesture action: mark it and keep reading. Nothing
      // opens, so there is nothing to be optimistic about — but it still holds
      // `busy` so the toolbar can't fire it twice.
      setBusy(true);
      const stopCreate = startTimer("annotate: server create");
      try {
        await createAnnotation({
          bookId,
          anchor: resolved.anchor,
          anchorCharOffset: resolved.anchorCharOffset,
          quotedText: resolved.quotedText,
          memberEmail,
        });
        stopCreate(intent);
        refreshList();
      } catch (err) {
        // `void annotateSelection(...)` means a throw here becomes an unhandled
        // rejection nobody sees, and the reader just watches their selection
        // vanish. Surface it.
        console.error("[reader] couldn't save that annotation", err);
      } finally {
        setBusy(false);
      }
    },
    [bookId, busy, contentRef, isCreating, memberEmail, openDraft, refreshList, space]
  );

  const openExisting = useCallback(
    async (chatId: string) => {
      const chat = await getAnnotation(chatId, memberEmail);
      if (chat) openPanelWith(chat);
    },
    [memberEmail, openPanelWith]
  );

  // Clicking a highlighted passage opens its chat — the highlight should be the
  // affordance, not just a colour. Ignored while a selection is live, so this
  // never hijacks the click that finishes selecting text.
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const onClick = (e: MouseEvent) => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      // Articles keep real links. A click inside one is meant for the link, and
      // opening a panel on top of a navigation is the wrong answer to both.
      if ((e.target as HTMLElement | null)?.closest("a")) return;
      const hit = annotationAtPoint(chats, container, e.clientX, e.clientY, windowBase);
      if (hit) void openExisting(hit.id);
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [chats, contentRef, openExisting, windowBase]);

  // A citation cites a page, and every page we know about has a recorded
  // character offset — which navigates identically whether the book is paged or
  // scrolled. (The page-N elements can't be relied on: even books flagged
  // has_real_pages often carry none in the DOM.)
  const jumpToPage = useCallback(
    (page: number) => {
      const mark = data?.pageMarks.find((m) => m.pageNumber === page);
      if (!mark) return;
      goToChar(mark.charStart);
    },
    [data, goToChar]
  );

  // Which page the reader has reached, for the spoiler-free scoping and the
  // "you've read past this" note. Derived from where they are rather than from
  // page-anchor elements, which most books don't actually carry.
  const currentPage = useMemo(
    () => pageForCharOffset(currentCharOffset),
    [currentCharOffset, pageForCharOffset]
  );

  /** Synthetic page numbers mean nothing on screen — show progress instead. */
  const labelForPage = useCallback(
    (page: number) => {
      const mark = data?.pageMarks.find((m) => m.pageNumber === page);
      if (!mark || totalChars <= 0) return null;
      return `${Math.round((mark.charStart / totalChars) * 100)}%`;
    },
    [data, totalChars]
  );

  const forkHere = useCallback(async () => {
    // Forking references the annotation being forked FROM, so it needs a row
    // that exists. Unreachable in practice — the offer only appears once the
    // reader has read past the anchor — but a stand-in id must never be sent.
    if (!detail || isPendingId(detail.id)) return;
    const container = contentRef.current;
    if (!container) return;
    // Anchor the fork where the reader is now. Both modes report that as a
    // character offset, so this no longer has to know how the book is laid out.
    const resolved = anchorForGap(
      blockIndexForCharOffset(blocks, currentCharOffset),
      space,
      container
    );
    if (!resolved) return;
    const chat = await forkAnnotation({
      chatId: detail.id,
      anchor: resolved.anchor,
      anchorCharOffset: resolved.anchorCharOffset,
      memberEmail,
    });
    openPanelWith(chat, true);
    refreshList();
  }, [
    blocks,
    contentRef,
    currentCharOffset,
    detail,
    memberEmail,
    openPanelWith,
    refreshList,
    space,
  ]);

  // Deletes outright rather than going through closePanel, which would then
  // also try to discard the row it just removed.
  const removeChat = useCallback(async () => {
    if (!detail) return;
    const id = detail.id;
    onPanelOpenChange(false);
    setDetail(null);
    setDraftId(null);

    const pending = pendingRef.current;
    if (pending && pending.clientId === id) {
      // Deleting something that hasn't been inserted yet. Left as "keep" this
      // would land a row nobody asked for the moment the insert returned.
      pending.onCreate = "delete";
      return;
    }
    await deleteAnnotation(id, memberEmail);
    refreshList();
  }, [detail, memberEmail, onPanelOpenChange, refreshList]);

  const changeSpoilerFree = useCallback(
    async (next: boolean) => {
      setData((d) => (d ? { ...d, spoilerFree: next } : d));
      await setBookSpoilerFree(bookId, next, memberEmail);
    },
    [bookId, memberEmail]
  );

  const changeNote = useCallback(
    async (noteText: string | null) => {
      if (!detail) return;
      // Optimistic: the textarea already shows this, and a note that flickered
      // back to its old text on save would read as a lost edit.
      setDetail((d) => (d ? { ...d, note: noteText } : d));
      await onceCreated(detail.id, (id) => setAnnotationNote(id, noteText, memberEmail));
      refreshList();
    },
    [detail, memberEmail, onceCreated, refreshList]
  );

  const changeModel = useCallback(
    async (next: ReaderChatModelPreference) => {
      if (!detail) return;
      setDetail((d) => (d ? { ...d, modelPreference: next } : d));
      await onceCreated(detail.id, (id) =>
        setAnnotationModelPreference(id, next, memberEmail)
      );
    },
    [detail, memberEmail, onceCreated]
  );

  return (
    <>
      <AnnotationsButton
        onClick={openList}
        active={panelOpen && mode === "list"}
      />
      <GutterMarkers
        rows={gutterRows}
        openAnnotationId={detail?.id ?? null}
        onOpen={(id) => void openExisting(id)}
      />
      <ParagraphHoverTarget
        contentRef={contentRef}
        onStart={(i) => void startAtGap(i)}
        layoutNonce={layoutNonce + contentVersion}
        disabled={busy}
        paged={paged}
        base={windowBase}
      />
      <SelectionToolbar
        contentRef={contentRef}
        onAct={(range, intent) => void annotateSelection(range, intent)}
        disabled={busy}
      />
      <AnnotationPanel
        open={panelOpen}
        isMobile={asSheet}
        docked={docked}
        onClose={closePanel}
        // The list is a destination and stays put; only an untouched chat
        // draft behaves like a popover and gets out of your way.
        dismissOnOutsidePress={mode === "thread" && !touched}
      >
        {mode === "list" ? (
          <AnnotationList
            annotations={chats}
            openAnnotationId={detail?.id ?? null}
            hasRealPages={data?.hasRealPages ?? false}
            onOpen={(id) => void openExisting(id)}
            onClose={closePanel}
            dockToggle={dockToggle}
          />
        ) : (
          detail && (
          <AnnotationThread
            key={threadKey}
            chat={detail}
            resolveChatId={realIdFor}
            createError={createError}
            memberEmail={memberEmail}
            bookSpoilerFree={data?.spoilerFree ?? false}
            isArticle={isArticle}
            hasRealPages={data?.hasRealPages ?? false}
            currentPage={currentPage}
            labelForPage={labelForPage}
            onJumpToPage={jumpToPage}
            onFork={() => void forkHere()}
            onDelete={() => void removeChat()}
            onClose={closePanel}
            onTouched={() => setTouched(true)}
            // A sent message promotes a highlight to a chat, which changes both
            // its colour and whether it gets a margin icon. Refetch so the
            // change outlives the panel being open.
            onExchangeComplete={refreshList}
            onSpoilerFreeChange={(v) => void changeSpoilerFree(v)}
            onModelChange={(v) => void changeModel(v)}
            onNoteChange={(n) => void changeNote(n)}
            dockToggle={dockToggle}
          />
          )
        )}
      </AnnotationPanel>
    </>
  );
}
