---
title: Reader AI Chat - Anchored Marginalia - Plan
type: feat
date: 2026-07-24
topic: reader-ai-chat
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ask-questions dialogue
execution: code
---

# Reader AI Chat - Anchored Marginalia - Plan

## Goal Capsule

- **Objective:** Let a reader open a conversation about the book they're reading, anchored to a specific spot in the text, without being spoiled about pages they haven't reached.
- **Product authority:** Andrew (owner). Product decisions confirmed in `/ask-questions` dialogue 2026-07-24.
- **Execution profile:** Deep, `execution: code`. One schema migration, a shared text-extraction change, a new streaming API route, and a new client surface inside the reader. No unit-test harness exists in this repo — verification is `tsc` + `lint` + `build` + targeted manual reader checks via `npm run dev:agent`.
- **Open blockers:** None.

---

## Product Contract

### Summary

Chats live *in* the book, not beside it. You start one either by hovering between two paragraphs and clicking the target that appears, or by selecting a passage and clicking the chat icon in the popover toolbar. The chat opens in a sidebar and is saved. A marker in the left gutter shows where every past chat lives; tap it to reopen.

What the assistant can see is governed by a single per-book **spoiler-free** switch. When it's on (the default for fiction), a chat's context is the book from the start through the chat's anchor page — truncated, not merely instructed. When it's off (the default for non-fiction), it's the whole book. Each chat's boundary is frozen at creation; to get a different one you start a new chat or fork an existing one.

### Key Decisions

- **Anchored marginalia, not a book-level assistant.** Every chat has a fixed location. This is the organizing idea; the gutter markers are the primary way you find chats again.
- **The boundary is frozen and derived from the anchor.** Not live, not per-message, not furthest-read. Explicitly rejected during design as too complicated to explain. A chat anchored at p.100 always sees pages 1–100, forever.
- **Truncation is load-bearing; the prompt rule is the backstop.** We cut the text at the boundary. The system-prompt spoiler rule exists only to stop the model volunteering outside knowledge about famous books.
- **One switch, not a range picker.** `spoiler_free` is per book, seeded from fiction/non-fiction at add time, user-flippable. There is no per-chat range control.
- **Forking is offered, not hidden in a menu.** When a chat's anchor is behind where you've read, the thread shows "Started at p.100 · You've read to p.312" with a **Continue from here** button.
- **Fast by default, promoted when necessary.** "Fast" is `claude-haiku-4-5`, "Deep" is `claude-sonnet-5`. Haiku's context window is 200K (every other current model is 1M), so long books do not fit. We count tokens *before* sending and promote deterministically, with a visible note in the thread. Never a retry-on-error.
- **Desktop-first.** Andrew reads on both but dislikes typing to an AI on a phone. Desktop gets the full experience; phone gets markers + read + type, and no selection toolbar.
- **Citations are worth the plumbing.** Page markers are interleaved into the extracted text so the model can cite `[p.212]`, rendered as chips that scroll the reader there. No passage highlighting in v1.
- **Everyone gets it.** The kids don't currently use the reader. The system prompt lives in one function so a kid variant (which must not become a quiz cheat engine) can be added deliberately later.

---

## Ground truth verified in the code

Three things differ from a first reading of the codebase. All three were confirmed directly in source and they shape the plan.

1. **`reading_books.genres` does not exist.** `src/lib/reading/genres.ts` is an age→genre-list helper for the Discover recommendation UI, not a per-book column. Seeding `spoiler_free` at add time requires adding the column *and* extending `book-lookup.ts`'s tool schema.

2. **`reading_book_pages.anchor_id` names a DOM id that often does not exist — the char-offset fallback is the PRIMARY scroll path, not a special case.** `convert.ts:1001-1006` only emits `pageAnchor(pageNum)` inside `if (pageNum != null)`, so synthetic-page EPUBs get rows with `anchorId: "wpage-N"` matching nothing in the HTML. Measured on the local DB 2026-07-24 (`.context/verify-anchors.mts`), it is worse than that: **all four ready books have zero `page-anchor` spans**, including the two with `has_real_pages = true`, which store `page-N` ids anyway. So scroll-to-page must branch on `getElementById(...) === null`, never on `has_real_pages`. Page numbers are still hidden in the UI when `!hasRealPages`, because synthetic numbers match nothing the reader sees. (Side effect worth knowing: on those books `book-reader.tsx`'s own `.page-anchor` position tracking finds nothing and falls back to `scrollRatio` — pre-existing, unrelated to chat.)

3. **The char-offset space is the universal coordinate system — verified exactly.** `.context/verify-anchors.mts` confirms on two real books (Jekyll 138,630 chars / 148 pages; Catching Fire 591,529 chars / 394 pages) that the rebuilt stream length equals the stored `char_count` to the character, `blockMap` finds every emitted block, and **every** `reading_book_pages.char_start` lands exactly on a block boundary. That is what makes a client-computed block index a safe address to convert into a server-side page.

   Consolidated in the build: `stripHtmlToText` moved out of `extract-text.ts` into a new client-safe `src/lib/reading/block-stream.ts`, which both the server extractor and the client anchor code now import. There is one definition of the char space rather than two that could drift. `convert.ts:976-979` advances `charCursor += text.length + 1` for every emitted block; `extract-text.ts:5-14` documents the exact inverse and `stripHtmlToText` implements it. Because `book-reader.tsx:100-116` fetches the raw HTML *string*, the client can recompute byte-identical offsets by running the same block regex over the same bytes. This is what makes durable anchors possible without fragile DOM measurement.

**Scope guard:** chats are for converted books only. Articles (`isArticle`, `book-reader.tsx:50`) retain images/links/lists and break the flat-block model. Gate the feature on `!isArticle`.

---

## 1. Schema — `supabase/migrations/00166_reading_chats.sql`

> Numbered 00166, not 00165: the shared local Supabase already had `00165`
> recorded by a sibling Conductor workspace (`baseball_team_visuals`). See
> risk 11 for the wider drift on that database.

Follows the reading app's RLS convention verbatim (`user_id = auth.uid()` "Own rows" policy + `update_updated_at_column()` trigger, as in `00083_reading_books_content.sql`).

```sql
-- Anchored AI chats inside the reader (marginalia model).
--
-- Anchors are stored in the conversion's char-offset space — the same space as
-- reading_book_pages.char_start/char_end (see convert.ts advance() and
-- extract-text.ts stripHtmlToText). The book HTML is a static generated file,
-- so the client recomputes identical offsets from the same bytes on every load.

-- Genre/fiction metadata + the per-book spoiler switch.
-- spoiler_free governs NEW chats only; each chat freezes its own boundary.
ALTER TABLE reading_books ADD COLUMN genres text[];
ALTER TABLE reading_books ADD COLUMN spoiler_free boolean NOT NULL DEFAULT false;

CREATE TABLE reading_chats (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id              uuid NOT NULL REFERENCES reading_books(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- { "v":1, "kind":"between"|"selection", "blockIndex":int,
  --   "endBlockIndex":int|null, "startOffset":int|null, "endOffset":int|null }
  anchor               jsonb NOT NULL,
  anchor_char_offset   int NOT NULL,
  -- Source page at the anchor; null when the book has no page map at all.
  anchor_page          int,
  -- FROZEN at creation: spoiler_free ? anchor_page : NULL (NULL = whole book).
  -- Never updated afterwards.
  context_through_page int,
  -- Selection chats: the highlighted passage, quoted into prompt and thread.
  quoted_text          text,
  model_preference     text NOT NULL DEFAULT 'fast'
                         CHECK (model_preference IN ('fast', 'deep')),
  forked_from_chat_id  uuid REFERENCES reading_chats(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reading_chats_book ON reading_chats (book_id, user_id);

CREATE TRIGGER reading_chats_updated_at
  BEFORE UPDATE ON reading_chats
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE reading_chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_chats FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- role 'note' = system-inserted one-liners shown in the thread (e.g. the
-- model-promotion notice). Never sent to the model.
CREATE TABLE reading_chat_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id    uuid NOT NULL REFERENCES reading_chats(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('user', 'assistant', 'note')),
  content    text NOT NULL,
  model      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reading_chat_messages_chat
  ON reading_chat_messages (chat_id, created_at);

ALTER TABLE reading_chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rows" ON reading_chat_messages FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```

Deliberate absences: no `max_page_read`, no live-boundary state, no per-message boundary.

---

## 2. Anchor strategy

New client-safe module `src/lib/reading/chat-anchors.ts` (pure functions, no `server-only`):

```ts
type BlockInfo = { index: number; charStart: number; text: string };
// Runs the SAME regex as extract-text.ts stripHtmlToText over the SAME html
// string the reader already fetched. blockMap[i] corresponds 1:1, in document
// order, to contentRef.querySelectorAll("p, h1, h2, h3, h4, h5, h6")[i].
export function blockMap(html: string): BlockInfo[];
```

Book HTML contains exactly three element kinds — `<p>`, `<h1 id="sec-N">`, `<h2 id="sec-N">` — plus zero-height `page-anchor` spans (`convert.ts:986`, `1003`). Blocks contain no inline tags (`escapeHtml`'d text only), so a block element's `textContent` equals its decoded block text. The index↔element↔charStart mapping is therefore exact and stable.

- **Between-paragraphs:** store `{kind:"between", blockIndex: i+1}` (the block *below* the gap); `anchor_char_offset = blockMap[i+1].charStart`. Re-place the marker at `elements[blockIndex].offsetTop`.
- **Selection:** walk the DOM `Range` endpoints up to their containing blocks → indices; offsets within block `textContent`. Store `startOffset`/`endOffset` **and `quoted_text` verbatim** — the quote is what feeds the prompt and renders in the thread, so nothing user-visible breaks even if an offset edge case appears. `anchor_char_offset = blockMap[blockIndex].charStart + startOffset`.
- **Server derives the page (trust boundary).** `createReaderChat` receives the anchor + offset and derives `anchor_page` itself:
  `SELECT page_number FROM reading_book_pages WHERE book_id=… AND user_id=… AND char_start <= offset ORDER BY page_number DESC LIMIT 1`.
  Then `context_through_page = book.spoiler_free ? anchor_page : NULL`. Client-supplied page numbers are never trusted for the boundary. Clamp `anchor_char_offset` to `[0, reading_book_content.char_count]`.
- **No page map at all** (unchaptered synthetic EPUB): `anchor_page` stays null; a spoiler-free boundary falls back to slicing at `anchor_char_offset` directly, and citations are disabled for that book.

---

## 3. Text extraction — `src/lib/reading/extract-text.ts`

Extend `getTextForRange` with an **opt-in options bag** so the four existing quiz callers (`quizzes/actions.ts`, `ensure-stretch-quiz.ts`) are untouched:

```ts
export type TextForRangeOptions = {
  /** Interleave "[p.N]" markers at page boundaries (chat citations). */
  pageMarkers?: boolean;
  /** Char budget; default MAX_QUIZ_CONTEXT_CHARS (existing behavior). */
  maxChars?: number | null;
  /** End fallback for books with no page map. */
  throughCharOffset?: number | null;
};
```

Marker interleaving fetches the page rows in range and emits `\n[p.N]\n` + that page's slice, per page. Markers are added *while building output*, never spliced into the counted stream, so the canonical char space is untouched. Chat passes `{ pageMarkers: true, maxChars: 3_000_000 }` — a safety cap well inside Sonnet 5's window; token counting is the real gate.

**Regression guarantee:** with no options passed, output must be byte-identical to today. The comment at `extract-text.ts:5-14` is load-bearing.

---

## 4. Prompt construction — `src/lib/reading/chat-prompt.ts` (the one place)

`buildReaderChatSystem()` returns an Anthropic system block array, ordered stable → volatile for cache stability:

**Block 1 — instructions.** Byte-stable across all books and chats. Reading-companion framing; "be concise, this is marginalia, not an essay"; citation instruction (`cite the nearest preceding [p.N] marker; only cite markers present in the text`); and, only when `contextThroughPage != null`, the spoiler rule:

> The reader has only been given the text through page N. Never reveal, hint at, or foreshadow anything beyond page N — including from your own outside knowledge of this work, its adaptations, or its reputation. If asked directly about later events, say you'll stay within what they've read and invite them back after reading further.

**Block 2 — the book text**, wrapped in `<book title="…" author="…">`, carrying `cache_control: { type: "ephemeral" }`. Everything at or before this point is byte-stable for a given `(book, context_through_page, model)`, so every turn after the first reads the whole book at ~0.1× input price (writes are 1.25×). Two caveats: Haiku 4.5's minimum cacheable prefix is 4096 tokens, so a chat anchored on page 2 of a spoiler-free book may not cache (harmless — it's tiny); and promotion to Sonnet starts a fresh cache, since caches are model-scoped.

**Block 3 — per-chat context, after the breakpoint.** The quoted selection (as system context, so the user's first message stays theirs), and for forks a `<prior_conversation>` block rendering the parent transcript as labeled plain text — *not* spliced into `messages`, keeping the API message array a clean alternation of this chat's own turns.

**Model params:** `max_tokens: 1024`. For `claude-sonnet-5` pass `thinking: { type: "disabled" }` explicitly — omitting `thinking` on Sonnet 5 runs *adaptive thinking by default*, which would delay first token and bill thinking tokens in a chat UI. Haiku 4.5: omit `thinking` (off by default), and do **not** send `output_config.effort` (unsupported on pre-4.6 models). No `temperature` on Sonnet 5 (rejected).

**Cache hygiene:** do not copy the journal's habit of injecting today's date into the system prompt — it would invalidate the cache on every request.

---

## 5. API route — `src/app/(reading)/reader/api/chat/route.ts`

Streaming skeleton copied from `src/app/(journal)/journal/api/chat/route.ts` (ReadableStream + `messages.stream` + `text_delta` forwarding + persist-on-close + `text/plain` / `X-Accel-Buffering: no`). `export const runtime = "nodejs"`.

Body: `{ chatId, userMessage, memberEmail? }`.

1. **Auth:** `resolveReadingScope(memberEmail)` — **not** `requireUserId`. In member mode this returns the service-role client, so **every** query and insert in this route must carry `user_id` explicitly. One missed filter is a cross-user leak.
2. Load chat + book; `context_through_page` on the chat row is authoritative — do **not** re-read the book's current `spoiler_free`.
3. Insert the user message row.
4. Build the context slice via `getTextForRange(..., { pageMarkers: true, maxChars: 3_000_000, throughCharOffset })`.
5. **Token count + deterministic promotion**, before opening the stream:

```ts
let model = chat.model_preference === "fast" ? "claude-haiku-4-5" : "claude-sonnet-5";
let promoted = false;
if (chat.model_preference === "fast") {
  const { input_tokens } = await anthropic().messages.countTokens({
    model: "claude-haiku-4-5", system, messages: turns,
  });
  if (input_tokens > 200_000 - 8_000) { model = "claude-sonnet-5"; promoted = true; }
}
```

Counted against the exact payload about to be sent, using the Haiku model id (counts are model-specific). If the count call itself fails, fail open to Haiku and let an oversized request surface a clear error — do not silently retry on Sonnet.

6. **Visible promotion note:** insert a `role:'note'` row ("Answering with the Deep model — this book is too long for the Fast model's context window.") if one isn't already present, and return `X-Reader-Chat-Model` / `X-Reader-Chat-Promoted` headers so the client renders it immediately without a refetch. Body stays a plain text stream.
7. Persist the assistant row with `model` and `user_id` on completion. Keep the journal's guard against persisting an empty response, and strip the journal's inline `[error: …]` marker client-side before display rather than showing it in a bubble.

**Server actions — `src/app/(reading)/reader/chat-actions.ts`** (all via `resolveReadingScope` + explicit `user_id` filters): `getReaderChatData`, `createReaderChat`, `getReaderChat`, `forkReaderChat`, `setBookSpoilerFree`, `setChatModelPreference`, `deleteReaderChat`. `getReaderChatData` also returns the page map (`page_number, char_start`) to power citation scrolling on synthetic-page books.

**Add-time seeding:** extend `LOOKUP_TOOL` in `book-lookup.ts` with `genres` (string array) and `fiction` (boolean); thread through `BookLookupResult` → `addBook` → `add-book-dialog.tsx`; insert `genres` and `spoiler_free: fiction === true`. Existing books default to `false` and are flipped by hand.

---

## 6. Client components

**`book-reader.tsx` (minimal edits):**
- Wrap the `<article>` region in a `relative` container; when the desktop panel is open apply `md:mr-[26rem] transition-[margin]` so the column **shifts** rather than being overlaid.
- Render `{!isArticle && <ReaderChatLayer … />}`, passing `bookId`, `memberEmail`, `html`, `contentRef`, `hasRealPages`, `currentPage`, `scrollToAnchor`, and `remeasure={measure}`.
- **Scroll preservation across the shift.** Anchors are document-absolute (`docTop` from `window.scrollY`), and changing the column width reflows the whole document. Before toggling, capture the block at the reading line (`window.scrollY + READING_LINE_OFFSET`); after the transition, re-run `measure()` and scroll that element back to the same line. Without this, opening a chat visually teleports the reader.

**New files under `src/components/reading/chat/`:**

| File | Role |
|---|---|
| `reader-chat-layer.tsx` | Orchestrator. Loads chat data, memoizes `blockMap(html)`, owns open/draft state, splits desktop vs mobile on `(max-width: 767px)` as `event-panel-host.tsx` does. |
| `gutter-markers.tsx` | Absolutely-positioned `<button>`s at `elements[anchor.blockIndex].offsetTop`, in the empty gutter left of the `max-w-2xl` column (inside `px-6` on narrow screens). Always visible on mobile. Stacked with a count badge when several share a block. |
| `paragraph-hover-target.tsx` | Desktop only (`(hover: hover) and (pointer: fine)`). Tracks `mousemove`, finds the nearest inter-block gap (the `mb-5` paragraph gap), renders a hairline + glyph, click creates a `between` chat. |
| `selection-toolbar.tsx` | Desktop only, same guard. On debounced `selectionchange`/`mouseup`, if the selection is non-collapsed and inside `contentRef`, float a popover above `range.getBoundingClientRect()` with a chat icon. |
| `chat-panel-host.tsx` | Desktop: hand-rolled non-modal fixed panel (`fixed inset-y-0 right-0 z-50 w-[26rem] border-l`), modeled on `event-panel-host.tsx`'s `DrawerPanel` — **but** pointerdown inside the article must not dismiss it (reading and selecting while chatting is the whole point); only Escape and the close button dismiss. Mobile: the existing `BottomSheet`. |
| `chat-thread.tsx` | Thread + composer. Stream consumption copied from `chat-surface.tsx`'s `pumpStream`. Header carries anchor context, the Fast/Deep picker, the book spoiler toggle, and delete. Renders `role:'note'` rows as centered muted lines, the quoted selection as a blockquote, and the fork banner. |
| `citation-chips.tsx` | Splits assistant text on `/\[p\.(\d+)\]/g` into tappable chips. Primary path `scrollToAnchor("page-" + n)`; fallback for synthetic-page books resolves the page's `char_start` → first block with `charStart >= that` → scroll with the `READING_LINE_OFFSET` adjustment. Tapping on mobile half-snaps the sheet so the jump is visible. |

Two UI details that follow from ground truth: the spoiler toggle is labeled to make the freeze explicit ("Spoiler-safe — applies to new chats"), and page numbers are suppressed in favour of location phrasing when `!hasRealPages`, because synthetic page numbers match nothing the reader sees.

---

## 7. Build order

Each step is independently verifiable. Agents use `npm run dev:agent` — never port 3000.

| # | Step | Verify |
|---|---|---|
| 1 | Migration `00166` | Apply to local stack; confirm RLS policies present |
| 2 | `extract-text.ts` options bag | `tsc`; take a quiz on a converted book — zero regression; assert no-options output byte-identical |
| 3 | `chat-anchors.ts` | Feed a real `content.html`: `blockMap` count == DOM query count; offsets match `reading_book_pages` boundaries |
| 4 | `book-lookup.ts` genres/fiction + `addBook` seeding | Add one fiction and one non-fiction book; check `spoiler_free` |
| 5 | `chat-actions.ts` | `tsc`; verify `anchor_page` + frozen `context_through_page` derivation; exercise member mode (owner viewing a kid) |
| 6 | `chat-prompt.ts` + API route | `curl -N` a seeded chat; assistant row persisted with `model`; log `usage.cache_read_input_tokens > 0` on turn 2; force a promotion on a long book |
| 7 | Panel host + thread (temp "new chat here" button) | Full loop desktop + mobile; text selectable while panel open; scroll position preserved across open/close |
| 8 | Gutter markers | Reload mid-book at several widths; markers land on the right paragraphs |
| 9 | Hover-gap target | Manual sweep; absent under touch emulation |
| 10 | Selection toolbar | Select across 1 and 3 paragraphs; absent on touch; quote correct in thread and prompt |
| 11 | Fork banner | Chat at p.100, read to p.312, fork; verify new boundary and `<prior_conversation>` |
| 12 | Citation chips | Real-page book **and** synthetic EPUB; verify both scroll paths |
| 13 | Spoiler toggle + model picker, full pass | `npm run build` clean; desktop + phone viewport |

---

## 8. Risks and sharp edges

1. **Window-scrolling + column shift (biggest UX risk).** The reader scrolls the window and every anchor is document-absolute (`book-reader.tsx:129, 167-227`). Shifting the column changes wrapping → document height → every `docTop`. Must re-run `measure()` after the transition (it's currently only wired to `resize`) *and* actively restore the reading-line block, on open and on close.
2. **Fixed chrome collisions.** The hover header is `z-40` (`book-reader.tsx:417`); the panel must be `z-50`. The bottom progress pill is `fixed inset-x-0 … justify-center` and will look misaligned when the column shifts — offset it by the panel width or accept the drift.
3. **Touch non-hijacking is deliberate.** `book-reader.tsx:369-409` treats long-press as selection and leaves it alone. Markers must be `<button>`s (already excluded from the chrome-toggle handler at line 396) and the selection toolbar must never mount on touch, or we regress the reading feel that comment protects.
4. **`resolveReadingScope` admin path.** Member mode returns a service-role client (`scope.ts:56-76`). Every new query, insert, and the storage download inside `getTextForRange` must filter by `userId`.
5. **Char-space alignment is fragile and load-bearing.** Three implementations must agree byte-for-byte: `convert.ts` `advance()`, `extract-text.ts` `stripHtmlToText`, and the new client `blockMap`. Add a cross-reference comment in all three. Note that re-uploading a book re-converts and re-numbers the stream (`attachBookFile` wipes pages), staling that book's anchors — acceptable for v1, but consider flagging or deleting its chats on re-upload.
6. **Synthetic-page books.** No DOM anchors, `pageCount` null, reader shows `%`. Citations work via the 280-word page space for chaptered EPUBs, but the numbers match nothing on screen — hide page numbers when `!hasRealPages`. Unchaptered synthetic EPUBs have no page rows at all: no citations, boundary falls back to `anchor_char_offset`.
7. **Sonnet 5 defaults.** Omitting `thinking` runs adaptive thinking silently; pass `{type:"disabled"}`. Don't send `temperature` (400).
8. **`count_tokens` cost.** One extra round-trip (~100–300ms) per Fast send. Acceptable for determinism; revisit by caching the count per `(chat, boundary)` if it becomes noticeable.
9. **`BottomSheet` is modal-ish.** It has a backdrop; at half-snap the text is visible but taps above the sheet dismiss it. Mobile "read + type" means *peek* + type, matching existing calendar behavior — flagging so it isn't later mistaken for a bug.
11. **The shared local Supabase has drifted (pre-existing, not caused by this work).** Every Conductor workspace shares one local database, and `db-heal-local.sh` keys off migration *version number* only. Observed on 2026-07-24: `00160`/`00161`/`00165` are recorded under sibling-branch names (`practice_recordings`, `practice_session_linking`, `baseball_team_visuals`), so heal believes this branch's files at those numbers are applied when they are not. Concretely, `reading_quiz_steering_messages` exists but `reading_quizzes.comprehension_prompt` does not, and `00162` fails to re-apply because part of it is already present. This breaks the reading *quiz* feature locally, not chat. Fixing it means reconciling by hand against a database other workspaces are actively using — deliberately not done here.

10. **Kid quiz-cheat risk is dormant, not solved.** Kids don't use the reader today. If that changes, a kid reading a chapter they skipped can ask for a summary and walk into the quiz with answers, undermining the quiz + Mason Bucks economy. The single-function system prompt is the hook for a Socratic kid variant.
