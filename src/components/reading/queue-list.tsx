"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { QueueRow } from "@/components/reading/queue-row";
import {
  renormalizeBookOrder,
  setBookSortOrder,
} from "@/app/(reading)/reader/actions";
import { needsRenormalize, sortBetween } from "@/lib/sort-order";
import type { ReadingBookWithProgress } from "@/lib/types";

/** A rank only moves up or down, so sideways drift is just noise. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * The Queue, as a list you rank by hand.
 *
 * Books and saved articles share one list: an article's "54 min read" is a real
 * advantage when you're deciding what's next, and burying it under fifteen novels
 * is how it never gets picked. Order is a fractional index, so a drag writes one
 * number for one row and nothing else moves — see src/lib/sort-order.ts.
 *
 * The order on screen is local state, updated the instant you drop, with the save
 * fired behind it. The server is not asked to re-render the page: it already
 * agrees with what you're looking at, and refreshing under a drag that just
 * landed is exactly the flicker we've chased out of the calendar and to-dos.
 */
export function QueueList({
  books,
  memberEmail = null,
}: {
  books: ReadingBookWithProgress[];
  memberEmail?: string | null;
}) {
  const [items, setItems] = useState(books);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Take the incoming list on whenever it genuinely changes, in one of two ways.
  // A book joining or leaving is the server's call, so the whole list is adopted,
  // order and all — a book you just added belongs where it was filed, not at the
  // end. A book merely *edited* — retitled, renoted, or any of the changes the
  // shelf draws ahead of their save (see shelf-books) — keeps the position you
  // dropped it in, and only its contents are refreshed; the server's ordering
  // lags a drag we've already drawn, and adopting it would yank the row back.
  //
  // Both are fingerprinted in id order for the same reason, and adjusted during
  // render rather than in an effect, so a new book never flashes as absent.
  const membership = books
    .map((b) => b.id)
    .sort()
    .join(",");
  const contents = books
    .map((b) =>
      [b.id, b.title, b.author, b.status, b.recommendation_note].join("~")
    )
    .sort()
    .join(",");
  const [last, setLast] = useState({ membership, contents });
  if (membership !== last.membership) {
    setLast({ membership, contents });
    setItems(books);
  } else if (contents !== last.contents) {
    setLast({ membership, contents });
    const incoming = new Map(books.map((b) => [b.id, b]));
    setItems((prev) => prev.map((b) => incoming.get(b.id) ?? b));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((b) => b.id === active.id);
    const newIndex = items.findIndex((b) => b.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    setError(null);

    const prev = next[newIndex - 1]?.sort_order ?? null;
    const after = next[newIndex + 1]?.sort_order ?? null;

    void (async () => {
      try {
        if (needsRenormalize(prev, after)) {
          // Midpoints have run out of float precision here. Reset the whole
          // visible list to 1..n and carry on — a handful of updates at
          // family scale.
          setItems(next.map((b, i) => ({ ...b, sort_order: i + 1 })));
          await renormalizeBookOrder(
            next.map((b) => b.id),
            memberEmail
          );
          return;
        }
        const sortOrder = sortBetween(prev, after);
        setItems(
          next.map((b) => (b.id === active.id ? { ...b, sort_order: sortOrder } : b))
        );
        await setBookSortOrder(String(active.id), sortOrder, memberEmail);
      } catch (err) {
        setItems(items);
        setError(
          err instanceof Error ? err.message : "Couldn't save the new order."
        );
      }
    })();
  }

  const activeBook = activeId ? items.find((b) => b.id === activeId) : null;

  return (
    <div className="mt-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[verticalOnly]}
        onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={items.map((b) => b.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="divide-y divide-border/60">
            {items.map((book) => (
              <SortableQueueRow
                key={book.id}
                book={book}
                memberEmail={memberEmail}
              />
            ))}
          </div>
        </SortableContext>

        {/* The row travels with the cursor rather than the list re-laying out
            around a hole — a book you're moving should look like it's in your
            hand. */}
        <DragOverlay>
          {activeBook && (
            <div className="rounded-lg bg-card opacity-95">
              <QueueRow book={activeBook} memberEmail={memberEmail} dragging />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** One row wired to dnd-kit. The handle is the only grabbable part. */
function SortableQueueRow({
  book,
  memberEmail,
}: {
  book: ReadingBookWithProgress;
  memberEmail: string | null;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: book.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // The original stays in the flow but goes blank: the overlay copy is what
      // you're looking at, and two of the same book would read as a duplicate.
      className={isDragging ? "opacity-0" : undefined}
    >
      <QueueRow
        book={book}
        memberEmail={memberEmail}
        handleRef={setActivatorNodeRef}
        handleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}
