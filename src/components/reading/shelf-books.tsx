"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReadingBookWithProgress } from "@/lib/types";

/**
 * The shelf, drawn from what you just did rather than from what the server has
 * got round to confirming.
 *
 * Rating a book, moving it to another shelf or throwing it away are all one-row
 * writes, but each one used to make the whole library page re-render on the
 * server before anything moved on screen — a second or two of nothing, then the
 * book jumping to its new group. The verdict you picked is not in doubt, so the
 * shelf applies it immediately and lets the save catch up behind it.
 *
 * Changes are held as a patch per book, laid over the server's list. Each patch
 * is let go the moment the server's own copy says the same thing, so there's no
 * moment where the two disagree and nothing to clean up by hand. A write that
 * fails hands back the undo it returned, and the book snaps back.
 */

/** What a shelf edit can change. Scalars only: the reconciler compares them
 * against the server's copy to know when a change has landed. */
export type BookPatch = Partial<
  Pick<
    ReadingBookWithProgress,
    | "rating"
    | "status"
    | "title"
    | "author"
    | "total_pages"
    | "recommendation_note"
    | "fiction"
    | "genre"
  >
>;

/** Put the book back the way it was — for when the save comes back an error. */
export type UndoShelfChange = () => void;

export type ShelfBooks = {
  /** False when nothing is holding an optimistic list — the kids' reading
   * program reuses these menus and dialogs, and there the server's render is
   * still the only copy, so a caller that would otherwise close over a save
   * has to keep waiting for it. */
  managed: boolean;
  /** Draw a change on the shelf now. */
  patchBook: (id: string, patch: BookPatch) => UndoShelfChange;
  /** Take the book off the shelf now. */
  dropBook: (id: string) => UndoShelfChange;
  /** Say why a change didn't stick. The tile it belonged to may well be gone by
   * then (deleted, or moved to a shelf you're not looking at), so the message
   * belongs to the shelf rather than to any one book. */
  fail: (message: string) => void;
};

/** Outside a shelf — the kids' reading program reuses these menus — every book
 * is already rendered from server state, so there's nothing to draw ahead. */
const UNMANAGED: ShelfBooks = {
  managed: false,
  patchBook: () => () => {},
  dropBook: () => () => {},
  fail: () => {},
};

const ShelfBooksContext = createContext<ShelfBooks | null>(null);

export function useShelfBooks(): ShelfBooks {
  return useContext(ShelfBooksContext) ?? UNMANAGED;
}

export function ShelfBooksProvider({
  value,
  children,
}: {
  value: ShelfBooks;
  children: React.ReactNode;
}) {
  return (
    <ShelfBooksContext.Provider value={value}>
      {children}
    </ShelfBooksContext.Provider>
  );
}

/** True once the server's copy of the book already says everything the patch
 * says — at which point the patch is just noise and can be dropped. */
function landed(book: ReadingBookWithProgress, patch: BookPatch): boolean {
  return Object.entries(patch).every(
    ([field, value]) => book[field as keyof ReadingBookWithProgress] === value
  );
}

/**
 * The shelf's list, with your unsaved changes already applied. Call it where the
 * server's list arrives, render from `books`, publish `optimistic` to the tiles,
 * and show `error` somewhere the shelf itself can hold it.
 */
export function useOptimisticShelf(books: ReadingBookWithProgress[]): {
  books: ReadingBookWithProgress[];
  optimistic: ShelfBooks;
  error: string | null;
} {
  const [patches, setPatches] = useState<Record<string, BookPatch>>({});
  const [dropped, setDropped] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(
    () => new Map(books.map((book) => [book.id, book])),
    [books]
  );

  // Let a change go as soon as the server agrees with it — or as soon as the
  // book leaves the list altogether, which is the same thing for a delete.
  // Adjusted during render rather than in an effect, so what gets painted is
  // already reconciled and a book never flickers back to its old group.
  const settled = Object.keys(patches).filter((id) => {
    const book = byId.get(id);
    return !book || landed(book, patches[id]);
  });
  if (settled.length > 0) {
    setPatches((prev) => {
      const next = { ...prev };
      for (const id of settled) delete next[id];
      return next;
    });
  }
  if (dropped.some((id) => !byId.has(id))) {
    setDropped((prev) => prev.filter((id) => byId.has(id)));
  }

  const shelfBooks = useMemo(() => {
    if (dropped.length === 0 && Object.keys(patches).length === 0) return books;
    const gone = new Set(dropped);
    return books
      .filter((book) => !gone.has(book.id))
      .map((book) =>
        patches[book.id] ? { ...book, ...patches[book.id] } : book
      );
  }, [books, patches, dropped]);

  const optimistic = useMemo<ShelfBooks>(
    () => ({
      managed: true,
      patchBook(id, patch) {
        setError(null);
        setPatches((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
        // Undoing drops exactly the fields this write claimed, so the book falls
        // back to the server's copy of them rather than to a guess.
        return () =>
          setPatches((prev) => {
            const current = prev[id];
            if (!current) return prev;
            const kept = { ...current };
            for (const field of Object.keys(patch)) {
              delete kept[field as keyof BookPatch];
            }
            const next = { ...prev };
            if (Object.keys(kept).length === 0) delete next[id];
            else next[id] = kept;
            return next;
          });
      },
      dropBook(id) {
        setError(null);
        setDropped((prev) => (prev.includes(id) ? prev : [...prev, id]));
        return () => setDropped((prev) => prev.filter((gone) => gone !== id));
      },
      fail(message) {
        setError(message);
      },
    }),
    []
  );

  return { books: shelfBooks, optimistic, error };
}
