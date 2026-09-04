import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic } from "@/lib/journal/anthropic";
import { chunkChapter, type PlainChunk } from "./chunk";
import { batchCustomId, parseBatchCustomId } from "./constants";
import { loadBookForHash, storeEntries, storeTerms, type HashedBook } from "./store";
import {
  PLAIN_MODEL,
  PlainRefusal,
  plainRequestParams,
  resultFromMessage,
  type ChunkResult,
} from "./translate";

/**
 * The rest of the book, as one Message Batch.
 *
 * A batch is half the price of live calls and can take hours, which is the
 * right trade for every chapter the reader has not reached yet. The two
 * chapters they are about to read go live (translate.ts); everything else
 * lands here and is stitched in when it comes back.
 *
 * Submission is SINGLE-WRITER. Two readers enabling the same conversion within
 * seconds would otherwise each read every chapter as pending and each submit a
 * whole-book batch — paying twice for a translation the data model would then
 * silently dedupe. So the rows are claimed first with a conditional UPDATE,
 * only the rows won go into the batch, and the real batch id is written after
 * the API call succeeds.
 *
 * Reconciliation never calls the model. A chunk that errored, expired or was
 * refused sets its chapter back to pending, flagged so the next live prepare
 * goes straight to the fallback model; the reader's reach-ahead or the Retry
 * marker is what fires that prepare. Keeps the cron sweep cheap and idempotent.
 */

/** A placeholder id that marks "claimed for a batch, not yet submitted". */
const PENDING_BATCH_ID = "pending";

type BatchChapterRow = {
  chapter_index: number;
  title: string;
  block_start: number;
  block_end: number;
};

/**
 * Submit every pending chapter of a conversion as one batch. Returns the batch
 * id, or null when there was nothing to submit (or someone else won the rows).
 */
export async function submitBatch(
  admin: SupabaseClient,
  book: HashedBook,
  /** Chapters held out for live translation — the one being read and the next. */
  exclude: number[] = []
): Promise<string | null> {
  let claim = admin
    .from("reading_plain_chapters")
    .update({ status: "batched", batch_id: PENDING_BATCH_ID, claimed_at: null })
    .eq("content_hash", book.hash)
    .eq("status", "pending");
  if (exclude.length > 0) claim = claim.not("chapter_index", "in", `(${exclude.join(",")})`);
  const { data: won, error } = await claim.select("chapter_index, title, block_start, block_end");
  if (error) throw new Error(error.message);
  const rows = (won ?? []) as BatchChapterRow[];
  if (rows.length === 0) return null;

  const requests: Anthropic.Messages.Batches.BatchCreateParams.Request[] = [];
  for (const row of rows) {
    const chunks = chunkChapter(book.blocks, row.chapter_index, row.block_start, row.block_end);
    for (const chunk of chunks) {
      requests.push({
        custom_id: batchCustomId(row.chapter_index, chunk.chunkIndex),
        params: plainRequestParams(
          chunk,
          { title: book.title, author: book.author, chapterTitle: row.title },
          PLAIN_MODEL
        ),
      });
    }
  }

  const indices = rows.map((r) => r.chapter_index);
  if (requests.length === 0) {
    // Chapters with nothing translatable (all headings). Nothing to wait for.
    await admin
      .from("reading_plain_chapters")
      .update({ status: "ready", batch_id: null, ready_at: new Date().toISOString() })
      .eq("content_hash", book.hash)
      .in("chapter_index", indices);
    return null;
  }

  let batchId: string;
  try {
    const batch = await anthropic().messages.batches.create({ requests });
    batchId = batch.id;
  } catch (err) {
    // Give the rows back: the reader's reach-ahead will translate them live.
    await admin
      .from("reading_plain_chapters")
      .update({ status: "pending", batch_id: null })
      .eq("content_hash", book.hash)
      .eq("batch_id", PENDING_BATCH_ID)
      .in("chapter_index", indices);
    throw err;
  }

  const { error: stampError } = await admin
    .from("reading_plain_chapters")
    .update({ batch_id: batchId })
    .eq("content_hash", book.hash)
    .eq("batch_id", PENDING_BATCH_ID)
    .in("chapter_index", indices);
  if (stampError) throw new Error(stampError.message);
  return batchId;
}

/** The distinct real batch ids still open for a hash. */
async function openBatchIds(admin: SupabaseClient, hash: string): Promise<string[]> {
  const { data, error } = await admin
    .from("reading_plain_chapters")
    .select("batch_id")
    .eq("content_hash", hash)
    .eq("status", "batched")
    .not("batch_id", "is", null)
    .neq("batch_id", PENDING_BATCH_ID);
  if (error) throw new Error(error.message);
  return Array.from(new Set(((data ?? []) as { batch_id: string }[]).map((r) => r.batch_id)));
}

/**
 * Ingest any batch for this hash that has finished. Cheap when none has: one
 * retrieve per open batch. Returns how many chapters became ready.
 */
export async function reconcileHash(
  admin: SupabaseClient,
  hash: string,
  loaded?: HashedBook | null
): Promise<number> {
  const batchIds = await openBatchIds(admin, hash);
  if (batchIds.length === 0) return 0;

  const client = anthropic();
  let readied = 0;
  let book = loaded ?? null;

  for (const batchId of batchIds) {
    const batch = await client.messages.batches.retrieve(batchId);
    if (batch.processing_status !== "ended") continue;

    if (!book) book = await loadBookForHash(admin, hash);
    if (!book) {
      // Every copy of this conversion is gone. Nothing to validate against;
      // leave the rows for a later sweep in case a copy reappears.
      continue;
    }

    const { data: rowData, error } = await admin
      .from("reading_plain_chapters")
      .select("chapter_index, title, block_start, block_end")
      .eq("content_hash", hash)
      .eq("batch_id", batchId)
      .eq("status", "batched");
    if (error) throw new Error(error.message);
    const rows = (rowData ?? []) as BatchChapterRow[];
    if (rows.length === 0) continue;
    const byIndex = new Map(rows.map((r) => [r.chapter_index, r]));

    // Group results by chapter; validate each chunk against its paragraphs.
    const perChapter = new Map<
      number,
      { results: Map<number, ChunkResult>; failed: string | null }
    >();
    for (const row of rows) {
      perChapter.set(row.chapter_index, { results: new Map(), failed: null });
    }

    const chunksFor = new Map<number, PlainChunk[]>();
    const chunksOf = (row: BatchChapterRow) => {
      let list = chunksFor.get(row.chapter_index);
      if (!list) {
        list = chunkChapter(book!.blocks, row.chapter_index, row.block_start, row.block_end);
        chunksFor.set(row.chapter_index, list);
      }
      return list;
    };

    for await (const item of await client.messages.batches.results(batchId)) {
      const id = parseBatchCustomId(item.custom_id);
      if (!id) continue;
      const row = byIndex.get(id.chapterIndex);
      if (!row) continue;
      const bucket = perChapter.get(id.chapterIndex)!;
      const chunk = chunksOf(row)[id.chunkIndex];
      if (!chunk) {
        bucket.failed = "batch result for an unknown chunk";
        continue;
      }
      if (item.result.type !== "succeeded") {
        bucket.failed = item.result.type;
        continue;
      }
      try {
        bucket.results.set(id.chunkIndex, resultFromMessage(chunk, item.result.message, PLAIN_MODEL));
      } catch (err) {
        bucket.failed =
          err instanceof PlainRefusal
            ? "refusal"
            : err instanceof Error
              ? err.message
              : "validation failed";
      }
    }

    for (const row of rows) {
      const bucket = perChapter.get(row.chapter_index)!;
      const expected = chunksOf(row).length;
      const complete = !bucket.failed && bucket.results.size === expected;

      if (!complete) {
        // Back to pending, flagged for the fallback. First writer wins: a live
        // prepare that already finished this chapter is not disturbed, because
        // the filter insists the row is still `batched`.
        await admin
          .from("reading_plain_chapters")
          .update({
            status: "pending",
            batch_id: null,
            fallback_next: true,
            error_message: (bucket.failed ?? "incomplete batch result").slice(0, 500),
          })
          .eq("content_hash", hash)
          .eq("chapter_index", row.chapter_index)
          .eq("status", "batched");
        continue;
      }

      let inputTokens = 0;
      let outputTokens = 0;
      for (const result of bucket.results.values()) {
        await storeEntries(admin, hash, row.chapter_index, result.entries, result.model);
        await storeTerms(admin, hash, row.chapter_index, result.terms);
        inputTokens += result.usage.inputTokens;
        outputTokens += result.usage.outputTokens;
      }
      const { data: readied_ } = await admin
        .from("reading_plain_chapters")
        .update({
          status: "ready",
          ready_at: new Date().toISOString(),
          batch_id: null,
          model_used: PLAIN_MODEL,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          error_message: null,
        })
        .eq("content_hash", hash)
        .eq("chapter_index", row.chapter_index)
        .eq("status", "batched")
        .select("chapter_index");
      readied += (readied_ ?? []).length;
    }
  }
  return readied;
}

/** Every hash with an open batch — the cron sweep's worklist. */
export async function hashesWithOpenBatches(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin
    .from("reading_plain_chapters")
    .select("content_hash")
    .eq("status", "batched")
    .not("batch_id", "is", null)
    .neq("batch_id", PENDING_BATCH_ID);
  if (error) throw new Error(error.message);
  return Array.from(new Set(((data ?? []) as { content_hash: string }[]).map((r) => r.content_hash)));
}
