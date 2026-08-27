import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import { ensureBookCopy } from "@/lib/reading/book-copy";
import { buildIndex, locate, buildAnchor } from "@/lib/reading/locate-quote";
import { pageForCharOffset } from "@/lib/reading/reader-position";
import type { AnnotationAnchor } from "@/lib/reading/annotation-anchors";

/**
 * Putting somebody else's mark in your margin.
 *
 * Runs after the share has already been granted and returned, so it is allowed
 * to be slow and allowed to fail — a participant row with no mark attached is
 * the "not placed yet" state, and this is what resolves it. It is called from
 * three places that can all fire at once (the share's own follow-up, the
 * permalink, the panel opening), so it has to be idempotent, and the unique key
 * on (thread, person) is what makes losing that race harmless.
 *
 * The one rule it will not break: a share always produces something visible. If
 * the passage cannot be found in the recipient's copy the mark is still created,
 * marked unplaced. It appears in their index and their notifications and their
 * link works; it just never paints. A mention that quietly produces nothing is
 * the worst failure available here — worse than a mark in the wrong place,
 * because at least a wrong one can be seen and argued with.
 */
export async function ensurePlacement(
  input: { threadId: string; userId: string }
): Promise<string | null> {
  // Its own admin client rather than the caller's: placing a mark writes into
  // somebody's library on their behalf, which is a privileged act however the
  // request that triggered it arrived.
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("reading_annotations")
    .select("id")
    .eq("thread_id", input.threadId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (existing) {
    const id = (existing as { id: string }).id;
    await admin
      .from("reading_annotation_thread_participants")
      .update({ annotation_id: id })
      .eq("thread_id", input.threadId)
      .eq("user_id", input.userId)
      .is("annotation_id", null);
    return id;
  }

  // The mark this conversation started from — whoever else is in it already has
  // one, and the oldest is the original.
  const { data: sourceRows } = await admin
    .from("reading_annotations")
    .select(
      "id, user_id, book_id, anchor, anchor_char_offset, quoted_text, color, anchor_page, " +
        "reading_books(type)"
    )
    .eq("thread_id", input.threadId)
    .neq("user_id", input.userId)
    .order("created_at", { ascending: true })
    .limit(1);

  const source = ((sourceRows ?? []) as unknown[])[0] as
    | {
        id: string;
        user_id: string;
        book_id: string;
        anchor: AnnotationAnchor;
        anchor_char_offset: number;
        quoted_text: string | null;
        color: string;
        anchor_page: number | null;
        reading_books: { type: string | null } | null;
      }
    | undefined;
  if (!source) return null;

  const copy = await ensureBookCopy(admin, {
    sourceBookId: source.book_id,
    ownerId: source.user_id,
    recipientId: input.userId,
  });
  if (!copy) return null;

  let anchor = source.anchor;
  let charOffset = source.anchor_char_offset;
  let status: "exact" | "relocated" | "unplaced" = "exact";

  // An article's offsets are measured over the RENDERED DOM, not over the
  // conversion character space a book's are — the quote matcher works in the
  // second, so pointing it at the first would return a number that looks right
  // and lands somewhere else entirely. Copying an article is still exact (the
  // file is the same file); it is only the case where the recipient already
  // saved the same URL themselves that has nowhere to go, and that is left
  // unplaced rather than guessed at.
  const isArticle = source.reading_books?.type === "article";

  if (copy.charSpace === "different" && isArticle) {
    status = "unplaced";
  } else if (copy.charSpace === "different") {
    const found = await relocate(admin, {
      bookId: copy.bookId,
      userId: input.userId,
      quote: source.quoted_text,
    });
    if (found) {
      anchor = found.anchor;
      charOffset = found.charOffset;
      status = "relocated";
    } else {
      // Still created. See the note at the top of this file.
      status = "unplaced";
    }
  }

  // Derived against THEIR page map, never carried over. The page a character
  // offset falls on is a fact about a copy, and migration 00166 is explicit that
  // a page is always re-derived rather than accepted.
  const anchorPage =
    status === "unplaced"
      ? null
      : await pageForCharOffset(admin, input.userId, copy.bookId, charOffset);

  const { data: inserted, error } = await admin
    .from("reading_annotations")
    .insert({
      thread_id: input.threadId,
      user_id: input.userId,
      book_id: copy.bookId,
      shared_from_user_id: source.user_id,
      anchor,
      anchor_char_offset: charOffset,
      anchor_page: anchorPage,
      quoted_text: source.quoted_text,
      color: source.color,
      anchor_status: status,
      // Their own boundary, not the sender's. Set to the passage they have been
      // shown rather than to where they have read: accepting a share is
      // consenting to know that much, and no more.
      spoiler_free: false,
      context_through_page: anchorPage,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 — another of the three callers got there first.
    if (error.code === "23505") {
      const { data: winner } = await admin
        .from("reading_annotations")
        .select("id")
        .eq("thread_id", input.threadId)
        .eq("user_id", input.userId)
        .maybeSingle();
      return winner ? (winner as { id: string }).id : null;
    }
    throw new Error(error.message);
  }

  const annotationId = (inserted as { id: string }).id;
  await admin
    .from("reading_annotation_thread_participants")
    .update({ annotation_id: annotationId })
    .eq("thread_id", input.threadId)
    .eq("user_id", input.userId);

  return annotationId;
}

/**
 * Find the passage again, by its words, in a copy that isn't the sender's.
 *
 * The same matcher the Kindle importer uses, and for the same reason: two copies
 * of a book agree about the words and about nothing else. A mark on a GAP
 * between paragraphs has no words at all, so it can only ever be exact-copied —
 * there is nothing to search for.
 */
async function relocate(
  admin: SupabaseClient,
  input: { bookId: string; userId: string; quote: string | null }
): Promise<{ anchor: AnnotationAnchor; charOffset: number } | null> {
  const quote = input.quote?.trim();
  if (!quote) return null;

  const { data: content } = await admin
    .from("reading_book_content")
    .select("content_path, status")
    .eq("book_id", input.bookId)
    .eq("user_id", input.userId)
    .maybeSingle();
  const row = content as { content_path: string | null; status: string } | null;
  if (!row || row.status !== "ready" || !row.content_path) return null;

  const { data: file } = await admin.storage
    .from(READING_BOOKS_BUCKET)
    .download(row.content_path);
  if (!file) return null;

  const index = buildIndex(await file.text());
  const at = locate(index, quote);
  if (!at) return null;

  const built = buildAnchor(index, at);
  if (!built) return null;

  return { anchor: built.anchor, charOffset: built.anchorCharOffset };
}
