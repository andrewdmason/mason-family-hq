"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createBookmark,
  deleteBookmark,
  listBookmarks,
  renameBookmark,
} from "@/app/(reading)/reader/bookmark-actions";
import {
  bookmarkAtSpot,
  bookmarkExcerpt,
  type ReaderBookmark,
} from "@/lib/reading/bookmarks";
import { blockIndexForCharOffset, type BookBlock } from "@/lib/reading/block-stream";

/** How long the offer to undo a removed bookmark stands. */
const UNDO_MS = 6000;

/**
 * What the dialog is currently doing: naming a new place, or renaming a saved
 * one. The same form either way — the only difference is what Save writes to.
 */
export type BookmarkDraft =
  | { mode: "create"; charOffset: number; blockIndex: number; excerpt: string | null }
  | { mode: "rename"; bookmark: ReaderBookmark };

/**
 * Bookmarks, from the reader's point of view.
 *
 * Two questions this answers that the list alone can't: whether the reader is
 * currently STANDING on one (which is what the header ribbon renders, and what
 * decides whether tapping it saves or removes), and what "here" means when
 * they save.
 *
 * "Here" is the block under the reading line, snapped to its start. Not the raw
 * character offset: in pages that is wherever the column happened to break, so
 * two bookmarks on the same paragraph would be two different places, and the
 * ribbon would go hollow again the moment the font size changed.
 */
export function useBookmarks({
  bookId,
  memberEmail,
  enabled,
  blocks,
  currentCharOffset,
  visibleThroughChar,
}: {
  bookId: string;
  memberEmail: string | null;
  /** Books only, and only once the text is loaded — see the reader. */
  enabled: boolean;
  blocks: BookBlock[];
  currentCharOffset: number;
  /** Last character on screen in paged mode; null while scrolling. */
  visibleThroughChar: number | null;
}) {
  const [bookmarks, setBookmarks] = useState<ReaderBookmark[]>([]);
  const [draft, setDraft] = useState<BookmarkDraft | null>(null);
  /** The one just deleted, while the offer to put it back is still standing. */
  const [removed, setRemoved] = useState<ReaderBookmark | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    listBookmarks(bookId, memberEmail)
      .then((rows) => {
        if (!cancelled) setBookmarks(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bookId, enabled, memberEmail]);

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    []
  );

  /** The block the reader is on, and where it starts. */
  const spot = useMemo(() => {
    if (blocks.length === 0) return null;
    const blockIndex = blockIndexForCharOffset(blocks, currentCharOffset);
    const block = blocks[blockIndex];
    if (!block) return null;
    return {
      blockIndex,
      charOffset: block.charStart,
      excerpt: bookmarkExcerpt(block.text),
    };
  }, [blocks, currentCharOffset]);

  /** What makes the ribbon solid, and what a tap on it removes. See the rule. */
  const active = useMemo(
    () =>
      spot == null ? null : bookmarkAtSpot(bookmarks, spot.charOffset, visibleThroughChar),
    [bookmarks, spot, visibleThroughChar]
  );

  const put = useCallback((b: ReaderBookmark) => {
    setBookmarks((prev) =>
      [...prev.filter((x) => x.id !== b.id), b].sort((a, c) => a.charOffset - c.charOffset)
    );
  }, []);

  const offerUndo = useCallback((b: ReaderBookmark) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setRemoved(b);
    undoTimer.current = setTimeout(() => setRemoved(null), UNDO_MS);
  }, []);

  const dismissUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setRemoved(null);
  }, []);

  const remove = useCallback(
    (b: ReaderBookmark) => {
      setBookmarks((prev) => prev.filter((x) => x.id !== b.id));
      offerUndo(b);
      void deleteBookmark(b.id, memberEmail).catch(() => {});
    },
    [memberEmail, offerUndo]
  );

  /**
   * Put back exactly what was removed, name included.
   *
   * A new row rather than the old id — the delete has already happened — which
   * is invisible to the reader and is why this needs no soft-delete column.
   */
  const undoRemove = useCallback(() => {
    const b = removed;
    if (!b) return;
    dismissUndo();
    put(b);
    void createBookmark({
      bookId,
      charOffset: b.charOffset,
      blockIndex: b.blockIndex,
      excerpt: b.excerpt,
      name: b.name,
      memberEmail,
    })
      .then(put)
      .catch(() => setBookmarks((prev) => prev.filter((x) => x.id !== b.id)));
  }, [bookId, dismissUndo, memberEmail, put, removed]);

  /**
   * The header ribbon, and the `B` key.
   *
   * Standing on one removes it outright — Andrew's call, and the undo pill is
   * what makes a stray tap survivable. Standing anywhere else opens the dialog
   * rather than saving silently, because a bookmark you can name is worth the
   * one keystroke it costs to skip naming it.
   */
  const toggle = useCallback(() => {
    if (!enabled || spot == null) return;
    if (active) {
      remove(active);
      return;
    }
    setDraft({
      mode: "create",
      charOffset: spot.charOffset,
      blockIndex: spot.blockIndex,
      excerpt: spot.excerpt,
    });
  }, [active, enabled, remove, spot]);

  const rename = useCallback(
    (bookmark: ReaderBookmark) => setDraft({ mode: "rename", bookmark }),
    []
  );

  const closeDraft = useCallback(() => setDraft(null), []);

  /** Save whatever the dialog is holding. An empty name is a normal answer. */
  const save = useCallback(
    (name: string) => {
      const current = draft;
      setDraft(null);
      if (!current) return;
      const trimmed = name.trim() || null;

      if (current.mode === "rename") {
        const next = { ...current.bookmark, name: trimmed };
        put(next);
        void renameBookmark(next.id, trimmed, memberEmail).catch(() => {});
        return;
      }

      void createBookmark({
        bookId,
        charOffset: current.charOffset,
        blockIndex: current.blockIndex,
        excerpt: current.excerpt,
        name: trimmed,
        memberEmail,
      })
        .then(put)
        .catch(() => {});
    },
    [bookId, draft, memberEmail, put]
  );

  return {
    bookmarks,
    active,
    draft,
    removed,
    toggle,
    rename,
    remove,
    save,
    closeDraft,
    undoRemove,
    dismissUndo,
  };
}
