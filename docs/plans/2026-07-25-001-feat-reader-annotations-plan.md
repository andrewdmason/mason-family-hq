---
title: Reader Annotations - Highlights, Notes and Chat on Books and Articles - Plan
type: feat
date: 2026-07-25
topic: reader-annotations
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ask-questions dialogue
execution: code
---

# Reader Annotations - Highlights, Notes and Chat on Books and Articles - Plan

## Goal Capsule

- **Objective:** One marking-up experience in the reader — highlight a passage, attach a note to it, or start an AI conversation about it — working identically on uploaded books and saved web articles, on desktop, iPad and phone.
- **Product authority:** Andrew (owner). Product decisions confirmed in `/ask-questions` dialogue 2026-07-25, following the architecture memo of the same day.
- **Execution profile:** Deep, `execution: code`. One schema migration that reshapes the four-day-old `reading_chats` table into `reading_annotations`, an anchor-scheme generalization, a text-extraction fix, and a substantial client rework inside the reader. No unit-test harness exists in this repo — verification is `tsc` + `lint` + `build` + targeted manual reader checks via `npm run dev:agent`.
- **Open blockers:** None. The two findings that contradicted the dialogue were both resolved by Andrew on 2026-07-25: the sidebar shortcut is **bare `b`** (not `Cmd-\`, which 1Password owns and the page cannot override), and the always-visible low-contrast header control is **approved**. See §8c and risks 1–2.

---

## Product Contract

### Summary

Selecting a passage offers three things: **Highlight** (yellow background, no margin icon), **Note** (yellow underline, margin icon), **Ask** (purple, margin icon, opens the AI thread). They are not three features — they are three states of one **annotation**. A highlight can gain a note later; either can gain a conversation later; all of that happens on the same row, in place. An annotation that has a conversation shows the purple treatment even if it also carries a note — the text gets one treatment, never a split one.

Everything works the same on books and on saved articles. Chat being books-only was a v1 scope guard, not a design decision, and it goes away.

A new list mode in the side panel shows every annotation in the current book in reading order — highlights included, rendered lighter — reachable from a control in the reader header and from a keyboard shortcut. Clicking a row opens that annotation, conversation and all.

### Key Decisions

- **Model B — one annotation, three states.** `reading_chats` becomes `reading_annotations`. State is *derived*, not stored: `note IS NULL` and no messages = plain highlight; `note` set = note; any AI turns = chat. Promotion is an `UPDATE`/message-insert on the same row, never a second row. This is what structurally prevents "a note and a chat on the same passage" from becoming two overlapping paint jobs.
- **Books and articles are one experience.** The `!isArticle` gate at `book-reader.tsx:715` is deleted. Anchors move to a v2 shape that addresses both.
- **Touch is required, not deferred.** iPad and phone get the full create-and-open loop. The desktop floating popover is kept for `(hover: hover) and (pointer: fine)`; touch gets a non-modal fixed bottom action bar.
- **Margin icons mean "there is content here you can't see."** Notes and chats get a gutter icon. Plain highlights do not — the highlight *is* its own indicator.
- **Yellow is the only colour.** The `color` column ships (default `'yellow'`) but no picker does.
- **One PR.** Sequenced internally as ten steps, each leaving the tree building and the reader working.

### Explicitly deferred (do not build)

Multiple highlight colours; highlights/notes in the markdown export (`copyableArchive()`, `src/app/(reading)/reader/library/page.tsx:19-28`); a cross-book "everything I've marked" view; an overlap-chooser UI; versioning article HTML on re-save.

### Accepted known risk

Re-saving an article overwrites `content.html` in place (`src/lib/reading/save-article.ts:115-124`), so that article's annotations can drift. The stored quote (`anchor.quote`) is the mitigation and is deemed good enough.

---

## Ground truth verified in the code

Everything below was checked against source or against production today, and several items change the shape of the work.

1. **Production has ZERO annotations.** `SELECT ... FROM reading_chats JOIN reading_books ...` via the read-only prod MCP returned `[]` on 2026-07-25. `reading_chat_messages` is therefore empty too. The rename is a pure code refactor with no data migration and no compat shim — but the migration is still written to be data-safe (rename + backfill, never drop), because a chat created between now and merge must not be destroyed.

2. **The server never resolves an anchor. Only the client does.** This is the single most load-bearing finding and it is easy to get wrong. `blockMap()` (`src/lib/reading/block-stream.ts:48-62`) is called *client-side* over the fetched HTML string (`reader-chat-layer.tsx:72`); the server only ever consumes the client-computed `anchor_char_offset`, clamped (`chat-actions.ts:203-207`) and turned into `anchor_page` (`chat-actions.ts:71-87`). The only *server-side* use of the block stream is plain-text extraction for prompts (`extract-text.ts:171`), which is order-insensitive. **Consequence:** article anchors do NOT require a server-side HTML parser, and we are not adding one.

3. **`stripHtmlToText` silently loses most of an article.** The regex is `/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi` (`block-stream.ts:49`). Run over sanitized article HTML — whose allowlist includes `ul/ol/li/blockquote/pre/table/td/figcaption/dl/dd/div` (`article-sanitize.ts:14-26`) — every `<li>`, `<td>`, `<pre>`, `<figcaption>` and bare-`<div>` text is dropped. Turning chat on for articles without fixing this ships an assistant grounded on a mutilated article. **This is a correctness fix, not a nicety.**

4. **The widened block selector is safe for books, and the regex could not have been widened.** Converted books emit only `<p>`, `<h1>`, `<h2>` (`convert.ts:188-192`, `convert.ts:986`, `convert.ts:1018`), so widening `BLOCK_SELECTOR` (`chat-anchors.ts:21`) adds zero elements to a book's DOM list and leaves the conversion char space untouched. For nested article HTML, `querySelectorAll` returns document order *including nested matches* — `<li><p>x</p></li>` is two entries — whereas the regex's `lastIndex` skips past the inner `</p>` and reports one. So option (a) from the memo (widen the selector, keep the regex) is concretely broken; option (a′) (widen and replace the regex with a real parser walk) is correct but, per finding 2, buys a capability with no consumer. Both rejected in favour of the client-only scheme in §2.

5. **`role: 'note'` is already taken, and means something else.** In `reading_chat_messages`, `'note'` is an app-authored UI line — the model-promotion notice (`00166_reading_chats.sql:96-103`, `chat-types.ts:27`, rendered as a centred muted line at `chat-thread.tsx:194-201`, inserted at `api/chat/route.ts:195-201`). The user's note is a different thing entirely. **Resolution: the message role is renamed `'note'` → `'notice'`; the user-facing concept keeps the word "note" as `reading_annotations.note`.** Product vocabulary wins the good name; the internal system line takes the new one.

6. **Articles' `char_count` is HTML length, not text length** (`save-article.ts:137`). The clamp at `chat-actions.ts:203-207` therefore stays safe (HTML length ≥ text length) but loose. Left as-is with a comment; nothing downstream depends on it for articles because `pageForCharOffset` returns null for a book with no `reading_book_pages` rows.

7. **Articles already have no page map and already resume by ratio.** `save-article.ts:126-141` writes `has_real_pages: false`, `page_count: null`, and inserts no `reading_book_pages` rows. Article HTML contains no `.page-anchor` spans, so `book-reader.tsx:145-157` finds none and resume falls through to `resumeScrollRatio` (`book-reader.tsx:337-340`). So "articles have no page map" costs us nothing that is not already the status quo — gutter placement is pure `blockIndex` (`gutter-placement.ts:51-65`) and is unaffected.

8. **Spoiler-free must be *hidden* for articles, not merely defaulted.** `spoiler_free` defaults false (`00166_reading_chats.sql:23`), so articles are correct today by accident. But if the toggle were shown and flipped, `api/chat/route.ts:107` would truncate the article at `anchor_char_offset` — a value that, for articles, is measured in DOM-text space, not `blockMap` space. The cut would be wrong. Hiding the control is load-bearing, and the server also forces `spoiler_free = false` for `type = 'article'`.

9. **`Cmd-\` is not free.** It is the documented default for 1Password's Universal Autofill / browser-extension fill on macOS ([1Password keyboard shortcuts](https://support.1password.com/keyboard-shortcuts/), [Universal Autofill on Mac](https://support.1password.com/mac-universal-autofill/)). Chrome's own macOS shortcut list does not bind `⌘\` ([Chrome keyboard shortcuts](https://support.google.com/chrome/answer/157179?hl=en&co=GENIE.Platform%3DDesktop)) and I found no macOS system binding for it ([Mac keyboard shortcuts](https://support.apple.com/en-us/102650)); Safari binds `⇧⌘\` (Show Tab Overview), not `⌘\` ([Safari shortcuts](https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac)). So the browsers are clear — but 1Password's hotkey is registered by the desktop app (system-wide) or via `chrome.commands` (extension), and **both fire ahead of a page `keydown` handler, so the page cannot `preventDefault()` them.** For a 1Password user, `Cmd-\` in the reader pops the autofill sheet. See §9 risk 1 for the recommendation. *Uncertainty stated plainly: I verified this from vendor documentation, not by pressing the key in this environment.*

10. **The repo's shortcut convention is unmodified single keys, plus one global `Cmd-K`.** `search-provider.tsx:26-37` owns `Cmd/Ctrl-K` app-wide with `preventDefault()`. Everything else — todos (`todos-shortcuts.tsx:80`), the metronome (`metronome-context.tsx:272-315`), practice (`practice-log-header.tsx:127`) — uses bare keys and explicitly *bails* when any modifier is held. There is no shortcut registry and no reader shortcut today; this is the reader's first.

11. **The mobile split is a width media query, which mis-classifies iPad.** `reader-chat-layer.tsx:86-92` sets `isMobile` from `(max-width: 767px)`. An iPad in portrait (768–1024 CSS px) lands on the *desktop* branch — right-edge drawer, hover gutter — while the selection toolbar's `(hover: hover) and (pointer: fine)` guard (`selection-toolbar.tsx:30`) excludes it. That is exactly why "iPad has no way to annotate" today. The fix is capability-based per-affordance, not a second width breakpoint.

12. **`BottomSheet` is a Base UI `Dialog` with a backdrop** (`bottom-sheet.tsx:96-107`). Opening it moves focus and dims the page — which on iOS collapses the very selection the reader just made. This rules it out as the *selection* surface (a non-modal action bar is used instead) but keeps it right for the *detail/list* surface, which is how `chat-panel.tsx:58-63` already uses it.

13. **Migration `00167` is free.** The repo's highest file is `00166_reading_chats.sql` (`00165` was deliberately skipped) and production's `supabase_migrations` tops out at `00166 reading_chats` (checked via MCP today). **Hazard carried forward from the prior plan's risk 11:** the local Supabase is shared across Conductor workspaces and heal keys off version number only, so a sibling workspace may already have recorded `00167`. Check the local recorded versions before applying and renumber if it collides.

14. **The reader header is not permanently visible.** It is `opacity-0 pointer-events-none` unless hovered/tapped/scrolled-up (`book-reader.tsx:549-558`, `headerVisible` at `:105`). "A permanent click target in the upper-right of the reader header" therefore cannot be satisfied by putting a button inside that container. See §8 and risk 2.

15. **The touch chrome-toggle already excludes buttons.** `book-reader.tsx:517-525` ignores taps whose target is inside `a, button, [role="menuitem"], input, textarea, select`, so a `<button>`-based action bar will not fight it. It does *not* check for a live selection, which is a small pre-existing annoyance worth fixing while we are here.

---

## 1. Schema — `supabase/migrations/00167_reading_annotations.sql`

Rename-and-extend, not drop-and-recreate: production has no rows today, but a chat created between now and merge must survive. Postgres does **not** rename a table's indexes, triggers, constraints or policies when the table is renamed, so those are renamed explicitly for hygiene (the policy name `"Own rows"` is already correct and stays).

Follows the reading app's RLS convention verbatim (`00166_reading_chats.sql:89-91`, `00083_reading_books_content.sql`).

```sql
-- Reader annotations: one row per marked-up passage.
--
-- Supersedes reading_chats (migration 00166). An annotation has three states,
-- DERIVED rather than stored:
--   note IS NULL and no messages  -> plain highlight   (yellow background)
--   note IS NOT NULL              -> note              (yellow underline)
--   any 'user'/'assistant' message-> chat              (purple; wins the treatment)
-- Promotion happens on THIS row (UPDATE / message insert), never as a second row.
-- That is what keeps two annotations from ever painting the same passage twice.
--
-- Anchors (jsonb, v2) address both converted books and saved web articles; see
-- src/lib/reading/annotation-anchors.ts. anchor_char_offset means two different
-- things by design:
--   books    -> the conversion character space (convert.ts advance(), the same
--               space as reading_book_pages.char_start/char_end)
--   articles -> a DOM text-stream offset over the rendered container, used ONLY
--               for reading-order sorting. Articles have no page map, so it is
--               never resolved to a page and never used to cut spoiler context.

-- ============================================================
-- 1. Rename the table and its dependents
-- ============================================================
ALTER TABLE reading_chats          RENAME TO reading_annotations;
ALTER TABLE reading_chat_messages  RENAME TO reading_annotation_messages;

ALTER TABLE reading_annotation_messages RENAME COLUMN chat_id TO annotation_id;
ALTER TABLE reading_annotations RENAME COLUMN forked_from_chat_id
                                  TO forked_from_annotation_id;

ALTER INDEX idx_reading_chats_book
  RENAME TO idx_reading_annotations_book;
ALTER INDEX idx_reading_chat_messages_chat
  RENAME TO idx_reading_annotation_messages_annotation;
ALTER TRIGGER reading_chats_updated_at ON reading_annotations
  RENAME TO reading_annotations_updated_at;

-- ============================================================
-- 2. The two new columns
-- ============================================================
-- The reader's own words about this passage. NULL = a plain highlight (or a
-- chat-only annotation). Distinct from the 'notice' message role below.
ALTER TABLE reading_annotations ADD COLUMN note text;

-- Yellow is the only colour shipping; the column exists so adding more later is
-- not a migration.
ALTER TABLE reading_annotations
  ADD COLUMN color text NOT NULL DEFAULT 'yellow'
  CHECK (color IN ('yellow'));

-- ============================================================
-- 3. Free the word "note" for the reader
-- ============================================================
-- role 'note' has always meant an APP-authored line in the thread (e.g. "answered
-- with the Deep model because this book is too long for Fast") and is never sent
-- to the model. With reader-authored notes arriving, that name is ambiguous, so
-- the system line becomes 'notice'.
UPDATE reading_annotation_messages SET role = 'notice' WHERE role = 'note';

ALTER TABLE reading_annotation_messages
  DROP CONSTRAINT reading_chat_messages_role_check;
ALTER TABLE reading_annotation_messages
  ADD CONSTRAINT reading_annotation_messages_role_check
  CHECK (role IN ('user', 'assistant', 'notice'));

-- ============================================================
-- 4. Reading-order index
-- ============================================================
-- The annotations list and the gutter both want "every annotation in this book,
-- in reading order". idx_reading_annotations_book covers the filter; this covers
-- the sort as well.
CREATE INDEX idx_reading_annotations_order
  ON reading_annotations (book_id, user_id, anchor_char_offset);
```

**Not changed, deliberately:** `quoted_text` stays nullable (a `kind:"between"` chat has no quote); `spoiler_free`, `context_through_page`, `model_preference` and the fork column stay exactly as they are and remain meaningful only for the chat state; the primary-key and foreign-key constraint names keep their `reading_chats_*` spellings (cosmetic only — renaming them adds churn and risk for no behavioural gain).

**Double-guard security convention (mandatory for every query added in this plan).** `resolveReadingScope` returns a **service-role client in member mode** (`src/lib/reading/scope.ts:50-71`), which bypasses RLS entirely. So both guards are required and neither is sufficient alone:
1. RLS `"Own rows"` on the table — inherited unchanged through the rename.
2. An explicit `.eq("user_id", userId)` on **every** select/update/delete and an explicit `user_id` on **every** insert.
The warning at `chat-actions.ts:14-22` says this in those words; the new annotation actions must repeat it verbatim in their own header comment. A missing filter here is a cross-member data leak, not a bug anyone would notice locally.

---

## 2. Anchor scheme v2 — `src/lib/reading/annotation-anchors.ts`

Renamed from `chat-anchors.ts`. One shape for both content types; two derivations for the char offset.

**Shape.** Same four positional fields as v1, plus a quote:

```ts
export const ANCHOR_VERSION = 2;

export type AnnotationAnchor = {
  v: number;
  kind: "between" | "selection";
  blockIndex: number;
  endBlockIndex: number | null;
  startOffset: number | null;
  endOffset: number | null;
  /** Selection anchors only. Re-finds the passage if the HTML was rewritten. */
  quote: { exact: string; prefix: string; suffix: string } | null;
};
```

v1 rows (none exist in prod, but local dev may have some) read as v2 with `quote: null`. No lazy upgrade, no dual-read path — v2 is a strict superset for book HTML because the widened selector adds no elements to a converted book's DOM (ground truth 4).

**Selector.** `BLOCK_SELECTOR` widens from `"p, h1, h2, h3, h4, h5, h6"` to add `li, blockquote, pre, figcaption, dt, dd, th, td, caption, div`. `div` is a deliberate safety net: the sanitizer allows it (`article-sanitize.ts:26`) and Readability output sometimes leaves text un-`<p>`-wrapped; without it `anchorFromRange` returns null on those selections and the affordance silently does nothing. `closestBlock` (`chat-anchors.ts:190-200`) already walks to the *innermost* match, so `blockquote > p` anchors to the `p` and only genuinely bare text anchors to a wrapper.

Indices come from `container.querySelectorAll(BLOCK_SELECTOR)` on the client at both create time and resolve time, over HTML fetched from the same stored bytes. Nesting cannot desynchronize what only one side ever enumerates.

**Char-offset derivation** — a tiny two-case space, passed down from `book-reader.tsx`:

```ts
export type AnchorSpace =
  | { kind: "book"; blocks: BookBlock[] }   // blockMap(html)
  | { kind: "dom" };                        // articles
```

- *book:* unchanged — `blocks[blockIndex].charStart + startOffset` (`chat-anchors.ts:111`). Preserves `anchor_page`, frozen `context_through_page`, `[p.N]` citations, `labelForPage`, and the `jumpToPage` char fallback (`reader-chat-layer.tsx:215-233`) exactly.
- *dom:* count text-node characters before the position with a `TreeWalker` over the container. Monotonic in document order, which is all it is used for (sorting the list and the gutter). Server-side it produces `anchor_page = null` because articles have no `reading_book_pages` rows, and it is never used to cut context because spoiler-free is forced off for articles (§5).

**Quote fallback.** `anchorFromRange` captures `exact` (the selected text, capped ~300 chars) plus ~32 chars of `prefix`/`suffix`. `rangeForAnchor` resolves by index first; if the resulting range's whitespace-normalized text no longer matches `exact`, it searches the container's text for `exact` disambiguated by `prefix`/`suffix` and rebuilds the range from the text nodes. This is what survives an article re-save. `kind:"between"` anchors have no quote and simply clamp — acceptable, they are gap markers.

The re-anchored position is **not** written back (deferred). It re-resolves on each load, which is cheap at family scale.

---

## 3. Text extraction — `src/lib/reading/extract-text.ts`

Add an article branch to `getTextForRange`, keyed on `reading_book_content.source_format === 'article'` (written by `save-article.ts:130`).

```
if (article) {
  text  = plain text of the whole stored HTML   // no page range to resolve
  hasPageMarkers = false                        // no page rows exist
  hasRealPages   = false
}
```

Extraction reuses the trick already proven in `countWords` (`article-sanitize.ts:58-65`): insert whitespace at closing block tags, drop `<br>`, then `sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })`. Zero new dependencies, and it fixes the lossiness in ground truth 3. Factor it out of `countWords` as `articleHtmlToText()` in `article-sanitize.ts` so there is one implementation, and have `countWords` call it.

`fitToBudget` (`extract-text.ts:26-39`) and the `maxChars` cap still apply as the backstop. Because `hasPageMarkers` is false, `buildReaderChatSystem` omits the citation rule automatically (`chat-prompt.ts:74-83`) — no prompt change needed. The book path is untouched; assert byte-identical output for a converted book before and after.

---

## 4. Server actions — `src/app/(reading)/reader/annotation-actions.ts`

Renamed from `chat-actions.ts`. Existing functions keep their behaviour, gain the annotation vocabulary, and are joined by four new ones. Every one of them repeats the double-guard discipline of §1.

| Function | Change |
|---|---|
| `getAnnotationData` (was `getReaderChatData`) | Selects the new columns; returns highlights and notes alongside chats. Still one roll-up message query, still skipped on an empty id list (an empty `.in()` is a malformed PostgREST filter — `chat-actions.ts:123-132`). |
| `createAnnotation` (was `createReaderChat`) | Gains `note?`, and `spoilerFree` is forced `false` when `reading_books.type = 'article'`. Otherwise unchanged: clamps the client offset, derives `anchor_page` server-side, freezes `context_through_page`. |
| `setAnnotationNote` | **New.** Sets/clears `note`. This is highlight→note promotion. |
| `deleteAnnotation` (was `deleteReaderChat`) | Unchanged but renamed. |
| `discardAnnotationIfEmpty` | Tightened: deletes only when there are no messages **and** `note IS NULL`. See the draft rule below. |
| `getAnnotation`, `forkAnnotation`, `setBookSpoilerFree`, `setAnnotationModelPreference` | Renamed; behaviour unchanged. |

**The draft rule, stated precisely, because it is the one place Model B can eat data.** Under the old model an empty chat was garbage; under Model B an empty annotation is a legitimate plain highlight. So: the *client* calls `discardAnnotationIfEmpty` only for a row **it created in this interaction as a chat draft** (it holds that id in local state), and the *server* additionally refuses to delete anything that has a note or any message. A pre-existing highlight that the reader opens a chat on was not created by this interaction, so it is never a discard candidate, and closing that chat without typing leaves the highlight alone.

---

## 5. Article parity in the reader — `src/components/reading/book-reader.tsx`

- Delete the `!isArticle` gate at `book-reader.tsx:715` and its comment at `:713-714`; render the annotation layer for both types.
- Pass `isArticle` down to the layer; the layer builds `AnchorSpace` as `{kind:"book", blocks: blockMap(html)}` or `{kind:"dom"}`. Article renders must not call `blockMap` at all.
- **Hide the spoiler toggle for articles** — thread `isArticle` into the thread header and omit the control (belt-and-braces to the server-side force in §4). Ground truth 8 explains why this is correctness, not tidiness.
- **Suppress annotation-open when the click is inside a link.** The container click handler (`reader-chat-layer.tsx:199-210`) currently opens whatever annotation is under the pointer; article HTML has real `<a target="_blank">` links (`article-sanitize.ts:41-46`), so a click inside a highlighted link would both navigate and open a panel. Bail when `(e.target as HTMLElement).closest("a")` is non-null.
- **Filter gap targets to top-level blocks.** With the widened selector, `ParagraphHoverTarget` (`paragraph-hover-target.tsx:43-47`) would offer a "start here" gap above every `<li>` and `<td>`. Build its `tops` array from blocks whose `parentElement === container`, keeping the original index so the anchor is still addressed in the full list. On books every block is a direct child, so behaviour is bit-identical.
- **Ignore the chrome-toggle tap while a selection is live.** In `book-reader.tsx:517-525`, bail when `window.getSelection()` is non-collapsed. Small pre-existing annoyance; it becomes visible once selecting is the primary gesture.

---

## 6. Painting — `src/components/reading/annotations/use-annotation-highlights.ts`

Renamed from `use-chat-highlights.ts`; keeps its architecture, which is already right: the CSS Custom Highlight API paints without touching the DOM, which is what lets the content stay React-owned under `dangerouslySetInnerHTML` and keeps the block indices honest (`use-chat-highlights.ts:11-17`).

**Registries** (one per visual state, plus the open-annotation emphasis):

| Registry | State | Style |
|---|---|---|
| `reader-annot-highlight` | note IS NULL, no messages | yellow background |
| `reader-annot-note` | note set, no messages | yellow underline (+ faint yellow background, see below) |
| `reader-annot-chat` | has messages (wins over note) | purple background |
| `reader-annot-active` | whichever is open | the same colour, stronger |

Purple as a **background**, not an underline: it is the existing treatment (`use-chat-highlights.ts:38-39`, `color-mix(in oklab, var(--primary) 14%…)`), readers already associate it with chat, and reserving underline for "note" keeps the two yellows distinguishable from each other.

**Lightning CSS.** The rules stay injected at runtime, exactly as now (`use-chat-highlights.ts:33-42`), because Tailwind v4's Lightning CSS parser drops `::highlight()` as an unknown pseudo-element at build time — documented at `src/app/globals.css:385-388`. Do not move them into `globals.css`.

**`text-decoration` in `::highlight()` — and the honest uncertainty.** The css-pseudo-4 highlight property allowlist includes `text-decoration` and its sub-properties alongside `color`/`background-color`, and Chromium implements it. API support is Chrome/Edge 105+, Safari 17.2+, Firefox 140+. **I could not verify from source whether current Safari honours `text-decoration` inside `::highlight()`** — WebKit's initial implementation honoured only colour and background-color. Mitigation, applied unconditionally so it costs nothing: give the note state a faint yellow **background in addition to** the underline. If an engine ignores the decoration it degrades to "lighter yellow than a highlight", which still reads as a distinct state. Confirm in Safari during step 10 and, if the underline is absent, either accept the two-tone-yellow fallback or paint decorations from `range.getClientRects()` in a `pointer-events-none` overlay re-placed on `layoutNonce` — **never** by wrapping text in `<mark>`.

**Priorities: still needed, but for a smaller reason.** Model B removes self-overlap (one annotation, one range, one treatment), which was the ugly case. Two *distinct* annotations on genuinely overlapping ranges are still possible — the reader can highlight "the last half of sentence A" and then chat about "sentence A through B". `Highlight.priority` (ties broken by registration order) settles it: highlight 1 < note 2 < chat 3 < active 4, so the content-bearing one paints on top. Three lines, keep them.

`chatAtPoint` becomes `annotationAtPoint` and, when several ranges contain the point, returns the **smallest** one — the more specific annotation is the one you meant to click.

---

## 7. Gutter — `src/components/reading/annotations/gutter-placement.ts`, `gutter-markers.tsx`

- Placement filters to annotations that have a note or messages. A plain highlight contributes nothing to the gutter, per the "an icon means hidden content" principle.
- Icon by state: `MessageSquare` for chats (as today, `gutter-markers.tsx:50`), a note glyph (`StickyNote`) for notes, and the chat icon when an annotation has both — the same "chat wins" rule as the text treatment, so the margin and the text never disagree.
- Grouping by `blockIndex` and the `MARKER_PITCH` stacking (`gutter-placement.ts:51-65`, `gutter-markers.tsx:36`) are unchanged.

---

## 8. Creating and opening on every device

### 8a. Selection actions

Three actions everywhere — **Highlight**, **Note**, **Ask** — in two shells:

- **Pointer-fine devices** keep the floating popover (`selection-toolbar.tsx`), widened from one button to three. The `onMouseDown={e => e.preventDefault()}` guard at `selection-toolbar.tsx:90` is what keeps the selection alive and must be replicated on all three.
- **Touch devices** get a **non-modal fixed bottom action bar** — not the `BottomSheet`. Rationale (ground truth 12): `BottomSheet` is a Base UI `Dialog` with a backdrop; opening it moves focus and dims the page, which on iOS collapses the selection the reader just made. A plain `fixed inset-x-0 bottom-0` bar of three `<button>`s takes no focus and dims nothing.

The guard changes from a single desktop check to a live capability check, mirrored with a `matchMedia` change listener the way `reader-chat-layer.tsx:86-92` already does — because an iPad flips between coarse and fine when a Magic Keyboard is attached mid-session. Both shells can be mounted; only the matching one renders.

**iOS callout coexistence.** iOS summons its own edit menu (Copy / Look Up / Share) adjacent to the selection, and no web API suppresses, extends or repositions it. `-webkit-touch-callout: none` is the wrong tool — it governs the long-press callout on links and images, not the text-selection edit menu, and applying it to the content would degrade normal link behaviour in articles. So we do not compete for that space: the action bar sits at the bottom edge, where the OS menu does not go. Long-press selection stays entirely native, which is the behaviour `selection-toolbar.tsx:8-14` and `book-reader.tsx:491-493` deliberately protect.

**Capture the Range immediately.** All three actions must clone the `Range` at selection time (`selection-toolbar.tsx:57` already does) and compute the anchor from the clone. Anything that opens a panel afterwards may collapse the visual selection; the cloned live Range does not care.

**Chrome-toggle interaction:** the action bar's `<button>`s are already excluded by `book-reader.tsx:521`, and the selection-live bail added in §5 covers the rest.

### 8b. Panel list mode — `src/components/reading/annotations/annotation-panel.tsx`

`chat-panel.tsx` (renamed) gains a `mode: "thread" | "list"`. Its two shells are unchanged: desktop is the non-modal right-edge drawer whose deliberate non-dismissal is the whole point (`chat-panel.tsx:9-18`), mobile is the `BottomSheet` — correct here, because the list is a destination, not an inline affordance.

List mode: every annotation in the current book sorted by `(anchor_char_offset, created_at)`, one row each — quote excerpt, note preview, message count. Plain highlights render lighter (muted quote, no icon) than notes and chats. A row click switches the panel to `thread` mode for that annotation and scrolls the reader to it.

### 8c. The header control and the shortcut

**Control.** Ground truth 14: the reader header is invisible unless hovered, so a button inside it is not "permanent". Proposal: render the annotations button in its own always-opaque container in the fixed top-right region — outside the `opacity-0` wrapper at `book-reader.tsx:554-558` — as a low-contrast icon (`muted-foreground/50`, no border) that goes full contrast on hover or whenever `headerVisible`. That satisfies "permanent" without putting real chrome back on a reader whose entire aesthetic is not having any. **Flagged for Andrew** (risk 2): the alternative is accepting that it appears with the rest of the header.

**Shortcut.** Toggles the panel into list mode; closes it if already there. Implementation notes: match on `e.code === "Backslash"` rather than `e.key` (the character varies by keyboard layout, the physical key does not); bail when the event target is an `input`/`textarea`/`contenteditable` so it cannot fire from the chat composer; `preventDefault()` on match; register on `document` and scope it to the reader component's lifetime, following `search-provider.tsx:26-37`.

**On the binding itself — SETTLED, and it overrides the original dialogue.** `Cmd-\` is 1Password's documented default fill hotkey on macOS, registered by the desktop app / via `chrome.commands`, both of which run ahead of page handlers and **cannot be `preventDefault()`-ed from the page**. Browsers and macOS itself are clear (ground truth 9) — 1Password is the collision.

**Decision (Andrew, 2026-07-25): bare `b`.** Matches this repo's dominant convention — no modifiers, bail when any are held, bail inside a field (`todos-shortcuts.tsx:80`, `metronome-context.tsx:272-315`). Verified collision-free: the only bare-key handlers in the app are `f` (`practice-log-header.tsx:126`), `g` and `?` (`todos-shortcuts.tsx:114-118`), `j` (`task-list.tsx:835`), `m` (`task-list.tsx:906`, `metronome-context.tsx:278`), plus the global `Cmd-K` (`search-provider.tsx:29`). The reader has no shortcut at all today. Build it as a single exported constant so rebinding is a one-line change.

---

## 9. Build order

One branch, ten steps. Each leaves `tsc`/`build` clean and the reader usable. Agents use `npm run dev:agent` — **never port 3000** (CLAUDE.md; enforced by `.claude/hooks/block-port-3000.js`).

| # | Step | Files | Verify |
|---|---|---|---|
| 1 | Migration `00167` | `supabase/migrations/00167_reading_annotations.sql` | Confirm `00167` is unused *locally* before applying (shared-DB hazard, risk 3). Apply; confirm RLS `"Own rows"` survived the rename, the `role` check is `('user','assistant','notice')`, and both indexes exist under their new names. |
| 2 | Mechanical rename, no behaviour change | `chat-types.ts`→`annotation-types.ts`, `chat-anchors.ts`→`annotation-anchors.ts`, `chat-actions.ts`→`annotation-actions.ts`, `src/components/reading/chat/`→`src/components/reading/annotations/` (8 files), `api/chat/route.ts` (`chat_id`→`annotation_id`, `'note'`→`'notice'`), `book-reader.tsx` import. Route URL stays `/reader/api/chat`. | `tsc` + `lint` + `build`; existing book chat still works end to end. Do this in one commit so every later step is written against final names. |
| 3 | Anchor v2 | `annotation-anchors.ts`, `reader-chat-layer.tsx` | Widened selector on a converted book: DOM element count still equals `blockMap(html).length`, offsets still land on `reading_book_pages` boundaries. Existing anchors still resolve. |
| 4 | Article text extraction | `article-sanitize.ts` (extract `articleHtmlToText`), `extract-text.ts` | Book output byte-identical to before; article output includes list/table/`pre` text that was previously dropped. |
| 5 | Articles get chat | `book-reader.tsx` (gate, `isArticle` threading, selection bail), `reader-chat-layer.tsx` (AnchorSpace, `<a>` suppression), `paragraph-hover-target.tsx` (gap filter), `chat-thread.tsx` (hide spoiler toggle), `annotation-actions.ts` (force `spoiler_free=false` for articles) | Chat on a saved article: gap anchor, selection anchor, reload → both re-resolve; assistant grounded in real article text; no spoiler control; clicking a link inside a highlight navigates without opening a panel; no gap target above list items. |
| 6 | Highlight + note data path | `annotation-actions.ts` (`setAnnotationNote`, tightened discard), `annotation-types.ts` | Create a highlight; add a note; promote to chat; verify one row throughout and that closing an untouched chat opened on an existing highlight leaves the highlight intact. |
| 7 | Painting | `use-annotation-highlights.ts` | Three treatments visible on book and article; overlapping annotations paint by priority; open annotation emphasised; **check Safari for the note underline**. |
| 8 | Gutter | `gutter-placement.ts`, `gutter-markers.tsx` | Icons for notes and chats only; none for plain highlights; stacking still correct at several widths. |
| 9 | Selection actions on all devices | `selection-toolbar.tsx`, new `selection-action-bar.tsx`, `reader-chat-layer.tsx` | Desktop popover with three actions; iPad (touch **and** with a keyboard attached) and phone get the bottom bar; iOS callout not fought; selection survives to anchor creation. |
| 10 | Panel list mode, header control, shortcut | `annotation-panel.tsx`, new `annotation-list.tsx`, `book-reader.tsx` | List in reading order with highlights lighter; row click opens the thread and scrolls; header control visible without hovering; shortcut toggles and is inert inside the composer. Full `build` + desktop/iPad/phone pass. |

**Verification per repo convention:** `npx tsc --noEmit`, `npm run lint`, `npm run build`, plus the manual reader checks above via `npm run dev:agent`. There is no unit-test harness in this repo, so the manual passes in steps 5, 7, 9 and 10 are the real gate.

---

## 10. Risks and sharp edges

1. ~~**`Cmd-\` collides with 1Password.**~~ **RESOLVED (Andrew, 2026-07-25): bound to bare `b`.** 1Password's default macOS fill hotkey is `⌘\`, registered system-wide by the desktop app or via `chrome.commands` by the extension; both dispatch ahead of page `keydown`, so `preventDefault()` was never available to us. Browsers and macOS were otherwise clear. `b` verified collision-free against every bare-key handler in the app. Residual risk: none beyond the usual "a bare key fires while you thought you were typing", which the not-in-a-field guard covers.
2. ~~**"Permanent" header control fights the reader's no-chrome aesthetic.**~~ **RESOLVED (Andrew, 2026-07-25): approved.** The header is deliberately invisible until hovered (`book-reader.tsx:549-558`), so the annotations button renders in its own always-opaque container outside that wrapper as a low-contrast icon that goes full contrast on hover or whenever `headerVisible`. Still worth Andrew's eye in step 10, but it is no longer an open decision.
3. **The shared local Supabase may already hold `00167`.** Carried forward from the prior plan's risk 11: every Conductor workspace shares one local DB and heal keys off version number only; `00160`/`00161`/`00165` are already recorded under sibling-branch names. Production is clean at `00166`. Check locally before applying and renumber if needed.
4. **The rename touches every chat file at once.** ~15 files, one commit, entirely mechanical — but it is the step most likely to produce a stale import or a missed `chat_id` in a string-built PostgREST column list (`chat-actions.ts:24-26`, `api/chat/route.ts:55-57` build column lists as strings, which `tsc` cannot check). Grep for `chat_id`, `forked_from_chat_id` and `'note'` after step 2.
5. **Article annotations drift on re-save.** Accepted (product contract). The quote fallback covers selection anchors; `kind:"between"` chats on articles will land approximately. Worth a follow-up: re-anchoring writes back the corrected index.
6. **`::highlight()` + `text-decoration` in Safari is unconfirmed.** Mitigated by double-encoding the note state (underline *and* faint background). If it fails, the fallback is a rects overlay, never DOM wrapping.
7. **Two char-offset meanings in one column.** `anchor_char_offset` is conversion space for books and DOM-text space for articles. Documented in the migration and in `annotation-anchors.ts`, and structurally safe because articles have no page rows and no spoiler cut — but it is the kind of thing that reads as a bug in six months. Anyone adding a consumer of that column must branch on content type.
8. **iPad classification.** `isMobile` stays a width query for the *panel* shell (portrait iPad gets the desktop drawer, which is fine at that width), while the *selection* affordance switches on live pointer capability. Two different questions answered by two different checks, on purpose; do not collapse them into one boolean.
9. **`chatAtPoint` is O(annotations × rects) per click** (`use-chat-highlights.ts:78-99`) and now runs over highlights too, which will be the numerous kind. Fine at family scale; if a heavily-marked book feels sluggish, cache the resolved ranges per `layoutNonce`.
10. **Layout settle vs. gutter placement.** `waitForLayoutToSettle` caps at ~2s (`book-reader.tsx:286-308`); an image that decodes later leaves marker Y-positions stale until the next resize. Painting and hit-testing stay correct (live Ranges compute rects lazily). Pre-existing, marginally more likely on image-heavy articles.
11. **Kid quiz-cheat risk is still dormant.** Unchanged from the prior plan: kids do not use the reader today, and the single-function system prompt (`chat-prompt.ts:1-11`) remains the hook for a Socratic kid variant. Notes and highlights do not change that calculus; an AI thread on an article does not touch the quiz economy.
