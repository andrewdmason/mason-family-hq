---
title: Reader Bookmarks - Plan
type: feat
date: 2026-09-04
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
---

# Reader Bookmarks - Plan

## Goal Capsule

- **Objective:** Let a reader save the spot they're on from the reading header, give it a name, and get back to it from the same menu that holds the book's contents.
- **Authority:** This plan. Product behaviour is owned by the R-IDs below; mechanism by the KTDs. `CLAUDE.md` conventions win over any sequencing detail here.
- **Stop conditions:** Stop and surface if a bookmark's saved character offset cannot be made to survive a Plain English face swap, or if the next migration number collides with prod (check prod `max(version)` first — see [[migration-collision-blocks-prod]]).
- **Tail ownership:** Executor opens the PR. Migration `00189` must be applied to prod before the code deploys.

---

## Product Contract

### Summary

A bookmark is a named place in a book. You tap a ribbon in the reading header, name it (or just hit Enter), and it appears in a Bookmarks group pinned to the top of the Contents dialog, in reading order. Tapping a bookmark takes you there, and that becomes your place.

### Problem Frame

There is currently no way to mark a spot you want to come back to unless it happens to be a passage worth quoting. Starring a mark requires selecting text and means "these words mattered" — a different act from "I want to find my way back here." Readers of long nonfiction need the second one: the chapter where an argument turns, the page with the diagram, the place you stopped to think.

### Requirements

**Making one**

- R1. A bookmark ribbon sits in the reading header, immediately right of the contents icon. Books only — never articles.
- R2. Tapping it when the current spot is not bookmarked opens a small dialog: an empty name field, focused, with the first words of the bookmarked line shown above it as context. Enter or Save commits; Escape cancels and saves nothing.
- R3. Saving with an empty name is normal and expected. The bookmark is then labelled by its excerpt in the list.
- R4. A bookmark attaches to the first block visible on screen — the top line in scrolling, the first line of the page in paged mode — snapped to that block's start, not to a mid-paragraph offset.
- R5. The ribbon renders solid whenever a bookmark's line is currently on screen, outline otherwise.
- R6. Tapping a solid ribbon deletes that bookmark immediately, with a transient "Bookmark removed · Undo" pill in the reader's existing bottom pill strip. Undo restores the same bookmark, name included.
- R7. `B` toggles the bookmark on desktop, subject to the reader's existing shortcut rules (no firing while a field or composer has focus).
- R8. Bookmarking twice at the same block is a no-op that reopens nothing — R5 already makes the ribbon solid there.

**Finding your way back**

- R9. The Contents dialog gains a Bookmarks group pinned above everything else, including the reader's preface. It carries a count and is collapsible; it does not render when the book has none.
- R10. Bookmarks list in reading order — where they fall in the book — not by when they were made.
- R11. Each row shows: the name if there is one, the excerpt from the bookmarked line, and the chapter plus page (or percent, when the book's pages are synthetic).
- R12. Tapping a row jumps there exactly as tapping a chapter does: the position moves, no return pill, dialog closes.
- R13. A row can be renamed or deleted from the list. Renaming reuses the same dialog as R2, prefilled with the current name.
- R14. The contents icon appears when a book has a table of contents **or** at least one bookmark, so a heading-less book can still reach its bookmarks. A dialog with no chapters shows only the Bookmarks group and the reader's two documents.

**Nothing else changes**

- R15. Bookmarks are private to the reader and never travel with a shared passage.
- R16. No margin marker, no gutter icon, no ribbon on the page. The header icon is the only in-page signal.
- R17. Starred marks are untouched: a bookmark is never a mark, never appears in the marks panel, and is never fed to the chat as a mark.
- R18. A bookmark survives switching between the original and Plain English faces, and between scrolling and paged layout.

### Out of Scope

- Bookmarks in articles.
- Bookmarks surfaced on the shelf, the book card, or in any chat prompt.
- Sharing a bookmark with another reader (sharing a passage already exists and is the right tool).
- A page-corner ribbon (revisitable later; R16 keeps the door open).

---

## Key Technical Decisions

- **KTD1 — its own table, not a column on marks.** `reading_bookmarks`: id, user_id, book_id, char_offset, block_index, excerpt, name (nullable), created_at. Row-level security mirrors the marks table's "own rows" policy. Keeping it separate is what makes R17 free — nothing that reads marks has to learn to skip a kind of row it doesn't want.
- **KTD2 — anchored by character offset, the reader's existing position space.** The reader already stores its position, its listening position and its chapter starts in conversion character offsets, and already has both a "which block contains this offset" lookup and a "go to this offset" jump that works in scrolling, paged and side-by-side. A bookmark is therefore just an offset, and R12 and R18 come from machinery that exists.
- **KTD3 — block index and excerpt stored alongside.** The offset does the jumping; the stored block index and first words do the displaying, so the list can render without loading the book's text. The excerpt is captured at save time.
- **KTD4 — the current-spot signal is the reader's existing current offset**, which already resolves correctly across scrolling, paged and side-by-side modes. Snap it to the containing block's start (R4) so two bookmarks made a scroll apart on the same paragraph are one bookmark.
- **KTD5 — the Bookmarks group is a peer of the front/back matter groups** in the contents dialog, reusing their collapsible row shape rather than introducing a second visual vocabulary.
- **KTD6 — undo is a client-held tombstone**, not a soft-delete column: the delete goes through immediately and Undo re-inserts from the row the client still has in hand. One fewer state in the table, and the pill's lifetime is the only thing that has to be right.

---

## Phases

**Phase A — the thing exists.** Migration `00189`, server actions to create, rename, delete and list, and loading a book's bookmarks with the reading view. Verified by a script that creates, renames and deletes against a local database and asserts the RLS policy refuses another user's rows.

**Phase B — making one.** Header ribbon with its solid/outline state, the name dialog, the delete-and-undo pill, the `B` shortcut. (R1–R8.)

**Phase C — getting back.** Bookmarks group in the contents dialog, reading-order sort, row rename and delete, the icon's new visibility rule for heading-less books. (R9–R14.)

Phase A blocks both. B and C are independent after it.

---

## Verification

- Type check and build clean.
- A bookmark made in scrolling mode is found in the same place after switching to paged, and after switching a book to Plain English and back.
- A bookmark in a book with no table of contents is reachable — the contents icon appears once it exists.
- The marks panel and the starred filter show no bookmarks.
- A shared passage sent to another reader carries no bookmark.
- Delete then Undo restores the name, not just the place.
