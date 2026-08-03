import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { blockMap, type BookBlock } from "@/lib/reading/block-stream";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import { cleanForNarration } from "./clean";
import {
  AUDIO_MIME,
  CLAIM_STALE_MS,
  DEFAULT_VOICE_ID,
  NARRATION_MODEL,
  READING_AUDIO_BUCKET,
  SYNTHESIS_CONCURRENCY,
} from "./constants";
import { narrate } from "./elevenlabs";
import { concatMp3 } from "./mp3";
import { characterTimes, cuesForChunk, normaliseCues, planChunks } from "./script";
import type { AudioTimings } from "./types";

/**
 * Voicing one chapter, end to end.
 *
 * Clean the text, cut it into requests, narrate them, stitch the audio, work
 * out when every sentence is spoken, and store the result. It runs inside a
 * single request with a five-minute ceiling, which is what bounds a chapter's
 * size (see MAX_CHAPTER_CHARS) — the alternative was a whole worker service for
 * something that takes under a minute.
 *
 * The row is CLAIMED before any of that happens. Two tabs, or a tap on a slow
 * connection followed by an impatient second tap, would otherwise both start
 * synthesizing the same chapter and both pay for it. A conditional update is
 * the whole mechanism: exactly one caller can move a row out of `pending`.
 */

export type SynthesisResult = {
  durationMs: number;
  billedChars: number;
};

/**
 * Take ownership of a chapter, or return false if someone already has it.
 *
 * A row stuck in `preparing` past the stale window is fair game: the only way
 * to reach that state is a request that died without writing an outcome (a
 * function timeout, a deploy mid-flight), and without this the chapter would be
 * unplayable forever with no way for the reader to retry.
 */
async function claim(
  client: SupabaseClient,
  userId: string,
  bookId: string,
  index: number
): Promise<boolean> {
  const now = new Date().toISOString();
  const claimed = { status: "preparing", claimed_at: now, error_message: null };

  const fresh = await client
    .from("reading_audio_chapters")
    .update(claimed)
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .eq("chapter_index", index)
    .in("status", ["pending", "failed"])
    .select("id");
  if (fresh.error) throw new Error(fresh.error.message);
  if ((fresh.data ?? []).length > 0) return true;

  const stale = await client
    .from("reading_audio_chapters")
    .update(claimed)
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .eq("chapter_index", index)
    .eq("status", "preparing")
    .lt("claimed_at", new Date(Date.now() - CLAIM_STALE_MS).toISOString())
    .select("id");
  if (stale.error) throw new Error(stale.error.message);
  return (stale.data ?? []).length > 0;
}

/** The blocks of the book that fall inside a chapter's character range. */
function blocksInRange(
  blocks: BookBlock[],
  charStart: number,
  charEnd: number
): { blocks: BookBlock[]; from: number } {
  let from = -1;
  const out: BookBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.charStart < charStart) continue;
    if (block.charStart >= charEnd) break;
    if (from < 0) from = i;
    out.push(block);
  }
  return { blocks: out, from: from < 0 ? 0 : from };
}

/** Run `work` over `items`, at most `limit` at a time, preserving order. */
async function pooled<T, R>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await work(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function fail(
  client: SupabaseClient,
  userId: string,
  bookId: string,
  index: number,
  message: string
): Promise<void> {
  await client
    .from("reading_audio_chapters")
    .update({ status: "failed", error_message: message.slice(0, 500) })
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .eq("chapter_index", index);
}

/**
 * Prepare one chapter for listening.
 *
 * Returns null when another request already holds the chapter — the caller
 * should poll rather than treat that as an error, because the chapter is on its
 * way regardless of who is making it.
 */
export async function synthesizeChapter(
  client: SupabaseClient,
  userId: string,
  bookId: string,
  index: number
): Promise<SynthesisResult | null> {
  const { data: chapter, error: chapterError } = await client
    .from("reading_audio_chapters")
    .select("char_start, char_end, status")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .eq("chapter_index", index)
    .maybeSingle();
  if (chapterError) throw new Error(chapterError.message);
  if (!chapter) throw new Error("That chapter isn't part of this book.");
  if (chapter.status === "ready") return null;

  if (!(await claim(client, userId, bookId, index))) return null;

  try {
    const { data: content } = await client
      .from("reading_book_content")
      .select("content_path, status")
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!content || content.status !== "ready" || !content.content_path) {
      throw new Error("This book isn't ready to be read yet.");
    }

    // The voice is fixed per book. Whatever earlier chapters were narrated in is
    // what this one gets, so a change to the house default never lands halfway
    // through a book you're already listening to.
    const { data: book } = await client
      .from("reading_books")
      .select("audio_voice_id")
      .eq("id", bookId)
      .eq("user_id", userId)
      .maybeSingle();
    const voiceId = (book?.audio_voice_id as string | null) ?? DEFAULT_VOICE_ID;

    const download = await client.storage
      .from(READING_BOOKS_BUCKET)
      .download(content.content_path as string);
    if (download.error || !download.data) throw new Error("Couldn't open this book.");

    const all = blockMap(await download.data.text());
    const { blocks, from } = blocksInRange(
      all,
      chapter.char_start as number,
      chapter.char_end as number
    );
    if (blocks.length === 0) throw new Error("There's nothing to read in this chapter.");

    const narration = await cleanForNarration(blocks, from);
    if (narration.length === 0) {
      throw new Error("Nothing in this chapter needed reading aloud.");
    }

    const chunks = planChunks(narration);
    const spoken = await pooled(chunks, SYNTHESIS_CONCURRENCY, (chunk) =>
      narrate({
        text: chunk.text,
        voiceId,
        previousText: chunk.previousText,
        nextText: chunk.nextText,
      })
    );

    // Frame-accurate, not estimated. Each piece's cues are shifted by the exact
    // playing time of everything before it — see mp3.ts.
    const joined = concatMp3(spoken.map((result) => result.audio));

    const cues = [];
    let offsetMs = 0;
    for (let i = 0; i < chunks.length; i++) {
      const times = characterTimes(
        chunks[i].text,
        spoken[i].alignment?.characters,
        spoken[i].alignment?.character_start_times_seconds
      );
      cues.push(...cuesForChunk(chunks[i], times, offsetMs));
      offsetMs += joined.durationsMs[i] ?? 0;
    }

    const timings: AudioTimings = {
      v: 1,
      durationMs: joined.totalMs,
      cues: normaliseCues(cues),
    };

    const audioPath = `${userId}/${bookId}/ch${index}.mp3`;
    const timingsPath = `${userId}/${bookId}/ch${index}.timings.json`;

    const storage = client.storage.from(READING_AUDIO_BUCKET);
    const uploadedAudio = await storage.upload(
      audioPath,
      new Blob([new Uint8Array(joined.audio)], { type: AUDIO_MIME }),
      { contentType: AUDIO_MIME, upsert: true }
    );
    if (uploadedAudio.error) throw new Error(uploadedAudio.error.message);

    const uploadedTimings = await storage.upload(
      timingsPath,
      new Blob([JSON.stringify(timings)], { type: "application/json" }),
      { contentType: "application/json", upsert: true }
    );
    if (uploadedTimings.error) throw new Error(uploadedTimings.error.message);

    // Context is not billed, so what was charged for is the spoken text alone.
    const billedChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);

    const { error: updateError } = await client
      .from("reading_audio_chapters")
      .update({
        status: "ready",
        voice_id: voiceId,
        model: NARRATION_MODEL,
        audio_path: audioPath,
        timings_path: timingsPath,
        duration_ms: joined.totalMs,
        billed_chars: billedChars,
        error_message: null,
        prepared_at: new Date().toISOString(),
      })
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .eq("chapter_index", index);
    if (updateError) throw new Error(updateError.message);

    // Written after the first chapter succeeds rather than when it starts, so a
    // book whose first attempt failed isn't locked to a voice it never used.
    if (!book?.audio_voice_id) {
      await client
        .from("reading_books")
        .update({ audio_voice_id: voiceId })
        .eq("id", bookId)
        .eq("user_id", userId);
    }

    return { durationMs: joined.totalMs, billedChars };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't prepare this chapter.";
    await fail(client, userId, bookId, index, message);
    throw err;
  }
}
