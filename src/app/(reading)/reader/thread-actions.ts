"use server";

import { resolveReadingScope } from "@/lib/reading/scope";
import { ensurePlacement } from "@/lib/reading/share-placement";

/**
 * Turn a shared conversation into the mark in YOUR copy of the book.
 *
 * Returns null when you are not in the conversation at all, which the caller
 * turns into the shelf rather than into an error page: a link you weren't given
 * should look like a link that went nowhere, not like a thing you were refused.
 */
export async function resolveSharedMark(
  threadId: string
): Promise<{ bookId: string; annotationId: string } | null> {
  const { client, userId } = await resolveReadingScope(null);

  const { data: participant } = await client
    .from("reading_annotation_thread_participants")
    .select("annotation_id")
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!participant) return null;

  // The mark may not be placed yet, or the placement may have failed. Either
  // way the fix is the same and it is idempotent, so it just runs.
  const annotationId =
    (participant as { annotation_id: string | null }).annotation_id ??
    (await ensurePlacement({ threadId, userId }));
  if (!annotationId) return null;

  const { data: mark } = await client
    .from("reading_annotations")
    .select("id, book_id")
    .eq("id", annotationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!mark) return null;

  // Following the link is reading it. Stamped here rather than when the panel
  // opens so the bell clears even if the jump lands somewhere the reader
  // immediately backs out of — they saw it.
  await client
    .from("reading_annotation_thread_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("thread_id", threadId)
    .eq("user_id", userId);

  return {
    bookId: (mark as { book_id: string }).book_id,
    annotationId: (mark as { id: string }).id,
  };
}

/** Stamp a conversation as read, when its panel is opened in the book. */
export async function markThreadRead(threadId: string): Promise<void> {
  const { client, userId } = await resolveReadingScope(null);
  await client
    .from("reading_annotation_thread_participants")
    .update({ last_read_at: new Date().toISOString() })
    .eq("thread_id", threadId)
    .eq("user_id", userId);
}
