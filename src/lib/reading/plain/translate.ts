import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic } from "@/lib/journal/anthropic";
import type { BookBlock } from "@/lib/reading/block-stream";
import { chunkChapter, chunkRange, splitChunk, type PlainChunk } from "./chunk";
import {
  PLAIN_CLAIM_STALE_MS,
  PLAIN_CONCURRENCY,
  PLAIN_PEEK_STALE_MS,
  PLAIN_PRIMARY_ATTEMPTS,
} from "./constants";
import { buildPlainSystem, buildPlainUser, type PlainPromptBook } from "./prompt";
import { storeEntries, storedBlockIndices, storeTerms, type HashedBook } from "./store";
import type { PlainUsage } from "./types";
import {
  parsePlainOutput,
  PLAIN_OUTPUT_SCHEMA,
  validateChunk,
  type ValidatedEntry,
  type ValidatedTerm,
} from "./validate";

/**
 * Translating one chapter, live, end to end.
 *
 * The row is CLAIMED first (a conditional UPDATE, exactly as the audiobook does
 * it) so two readers enabling at once, or one impatient double-tap, pay once.
 * The chapter's chunks then run in parallel — each carries the ORIGINAL
 * paragraph before it as context, so none depends on another's output — and
 * every chunk's paragraphs are stored the moment they validate. A request killed
 * mid-flight therefore loses only the chunks still in the air: the reclaim that
 * follows skips whatever is already on disk.
 */

/**
 * The primary model and the one that takes over when it declines or keeps
 * failing validation. Fable's thinking is always on and is what makes the
 * translation faithful; effort "medium" keeps the bill sane. Both overridable
 * from the environment, so a rate-limit incident is a config change.
 */
export const PLAIN_MODEL = process.env.PLAIN_ENGLISH_MODEL ?? "claude-fable-5-1";
export const PLAIN_FALLBACK_MODEL =
  process.env.PLAIN_ENGLISH_FALLBACK_MODEL ?? "claude-opus-5";
export const PLAIN_EFFORT = "medium" as const;

/**
 * Room for the answer plus the thinking that precedes it. A 10k-char chunk is
 * a few thousand output tokens; thinking can be as much again. Streamed, so the
 * SDK's non-streaming timeout never applies.
 */
export const PLAIN_MAX_TOKENS = 32_000;

export class PlainRefusal extends Error {
  constructor(model: string) {
    super(`${model} declined to translate this passage.`);
    this.name = "PlainRefusal";
  }
}

export class PlainValidationFailure extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PlainValidationFailure";
  }
}

export type ChunkResult = {
  entries: ValidatedEntry[];
  terms: ValidatedTerm[];
  model: string;
  usage: PlainUsage;
};

/** The request for one chunk, shared by the live path and the batch path. */
export function plainRequestParams(
  chunk: PlainChunk,
  book: PlainPromptBook,
  model: string
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: PLAIN_MAX_TOKENS,
    system: buildPlainSystem(book),
    messages: [{ role: "user", content: buildPlainUser(chunk) }],
    output_config: {
      effort: PLAIN_EFFORT,
      format: { type: "json_schema", schema: PLAIN_OUTPUT_SCHEMA as unknown as Record<string, unknown> },
    },
  };
}

/** Pull the text out of a finished message, or throw for a refusal. */
export function messageText(message: Anthropic.Message, model: string): string {
  if (message.stop_reason === "refusal") throw new PlainRefusal(model);
  if (message.stop_reason === "max_tokens") {
    throw new PlainValidationFailure("the translation ran out of room");
  }
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Turn a finished message into validated paragraphs, or throw. */
export function resultFromMessage(
  chunk: PlainChunk,
  message: Anthropic.Message,
  model: string
): ChunkResult {
  const text = messageText(message, model);
  const parsed = parsePlainOutput(text);
  if (!parsed) throw new PlainValidationFailure("the answer wasn't the JSON we asked for");
  const checked = validateChunk(chunk.blocks, parsed);
  if (!checked.ok) throw new PlainValidationFailure(checked.reason);
  return {
    entries: checked.entries,
    terms: checked.terms,
    model,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
  };
}

async function callOnce(
  client: Anthropic,
  chunk: PlainChunk,
  book: PlainPromptBook,
  model: string,
  usage: PlainUsage
): Promise<ChunkResult> {
  const message = await client.messages
    .stream(plainRequestParams(chunk, book, model))
    .finalMessage();
  usage.inputTokens += message.usage.input_tokens;
  usage.outputTokens += message.usage.output_tokens;
  return resultFromMessage(chunk, message, model);
}

/**
 * One chunk through the attempt ladder: the primary model twice, then the
 * fallback once, then — if allowed — the chunk split in half and each half sent
 * down the same ladder without a further split. A refusal skips straight to
 * the fallback rather than counting as a validation miss.
 */
export async function translateChunk(
  client: Anthropic,
  chunk: PlainChunk,
  book: PlainPromptBook,
  options: { allowSplit: boolean; startWithFallback: boolean }
): Promise<ChunkResult> {
  const usage: PlainUsage = { inputTokens: 0, outputTokens: 0 };
  let lastError: Error | null = null;

  const ladder: string[] = options.startWithFallback
    ? [PLAIN_FALLBACK_MODEL]
    : [...Array(PLAIN_PRIMARY_ATTEMPTS).fill(PLAIN_MODEL), PLAIN_FALLBACK_MODEL];

  for (let i = 0; i < ladder.length; i++) {
    const model = ladder[i];
    try {
      const result = await callOnce(client, chunk, book, model, usage);
      return { ...result, usage };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (err instanceof PlainRefusal && model !== PLAIN_FALLBACK_MODEL) {
        // Jump the remaining primary attempts: it will decline again.
        const next = ladder.indexOf(PLAIN_FALLBACK_MODEL);
        if (next > i) i = next - 1;
      }
    }
  }

  if (options.allowSplit) {
    const halves = splitChunk(chunk);
    if (halves) {
      const [a, b] = await Promise.all(
        halves.map((half) =>
          translateChunk(client, half, book, { allowSplit: false, startWithFallback: false })
        )
      );
      return {
        entries: [...a.entries, ...b.entries],
        terms: [...a.terms, ...b.terms],
        model: a.model === b.model ? a.model : `${a.model}+${b.model}`,
        usage: {
          inputTokens: usage.inputTokens + a.usage.inputTokens + b.usage.inputTokens,
          outputTokens: usage.outputTokens + a.usage.outputTokens + b.usage.outputTokens,
        },
      };
    }
  }

  throw lastError ?? new Error("Couldn't translate this passage.");
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

type ChapterRow = {
  chapter_index: number;
  title: string;
  block_start: number;
  block_end: number;
  status: string;
  attempts: number;
  fallback_next: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
};

/**
 * Take ownership of a chapter, or return null if someone already has it (or
 * it is already done). A row stuck in `preparing` past the stale window is
 * fair game — the only way there is a request that died without writing.
 */
async function claimChapter(
  admin: SupabaseClient,
  hash: string,
  index: number
): Promise<ChapterRow | null> {
  const now = new Date().toISOString();
  const claimed = { status: "preparing", claimed_at: now, error_message: null };
  const cols =
    "chapter_index, title, block_start, block_end, status, attempts, fallback_next, input_tokens, output_tokens";

  const fresh = await admin
    .from("reading_plain_chapters")
    .update(claimed)
    .eq("content_hash", hash)
    .eq("chapter_index", index)
    .in("status", ["pending", "failed"])
    .select(cols);
  if (fresh.error) throw new Error(fresh.error.message);
  if ((fresh.data ?? []).length > 0) return fresh.data![0] as ChapterRow;

  const stale = await admin
    .from("reading_plain_chapters")
    .update(claimed)
    .eq("content_hash", hash)
    .eq("chapter_index", index)
    .in("status", ["preparing", "batched"])
    .lt("claimed_at", new Date(Date.now() - PLAIN_CLAIM_STALE_MS).toISOString())
    .select(cols);
  if (stale.error) throw new Error(stale.error.message);
  if ((stale.data ?? []).length > 0) return stale.data![0] as ChapterRow;

  // A chapter sitting in a batch with no live claim yet: the reader has reached
  // it before the batch landed, so it goes live now. `claimed_at` is null on a
  // batched row, which the stale query above cannot match.
  const batched = await admin
    .from("reading_plain_chapters")
    .update(claimed)
    .eq("content_hash", hash)
    .eq("chapter_index", index)
    .eq("status", "batched")
    .is("claimed_at", null)
    .select(cols);
  if (batched.error) throw new Error(batched.error.message);
  if ((batched.data ?? []).length > 0) return batched.data![0] as ChapterRow;

  return null;
}

async function failChapter(
  admin: SupabaseClient,
  hash: string,
  index: number,
  message: string
): Promise<void> {
  await admin
    .from("reading_plain_chapters")
    .update({ status: "failed", error_message: message.slice(0, 500) })
    .eq("content_hash", hash)
    .eq("chapter_index", index);
}

export type TranslateOutcome = "ready" | "preparing" | "failed";

/**
 * Translate one chapter of a conversion, live.
 *
 * Returns "preparing" when another request holds the chapter or it is already
 * ready — the caller polls rather than treating that as an error, because the
 * chapter is on its way regardless of who is making it.
 */
export async function translateChapter(
  admin: SupabaseClient,
  book: HashedBook,
  chapterIndex: number
): Promise<TranslateOutcome> {
  const row = await claimChapter(admin, book.hash, chapterIndex);
  if (!row) return "preparing";

  const client = anthropic();
  const promptBook: PlainPromptBook = {
    title: book.title,
    author: book.author,
    chapterTitle: row.title,
  };

  try {
    const chunks = chunkChapter(book.blocks, chapterIndex, row.block_start, row.block_end);
    const already = await storedBlockIndices(admin, book.hash, row.block_start, row.block_end);
    const todo = chunks.filter((c) => !c.blocks.every((b) => already.has(b.index)));

    const usage: PlainUsage = {
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
    };
    let model: string | null = null;

    await pooled(todo, PLAIN_CONCURRENCY, async (chunk) => {
      const result = await translateChunk(client, chunk, promptBook, {
        allowSplit: true,
        startWithFallback: row.fallback_next,
      });
      await storeEntries(admin, book.hash, chapterIndex, result.entries, result.model);
      await storeTerms(admin, book.hash, chapterIndex, result.terms);
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      model = model && model !== result.model ? `${model}+${result.model}` : result.model;
    });

    const { error } = await admin
      .from("reading_plain_chapters")
      .update({
        status: "ready",
        ready_at: new Date().toISOString(),
        attempts: row.attempts + 1,
        fallback_next: false,
        model_used: model ?? (todo.length === 0 ? "stored" : null),
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        error_message: null,
        batch_id: null,
      })
      .eq("content_hash", book.hash)
      .eq("chapter_index", chapterIndex);
    if (error) throw new Error(error.message);
    return "ready";
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't translate this chapter.";
    await failChapter(admin, book.hash, chapterIndex, message);
    await admin
      .from("reading_plain_chapters")
      .update({ attempts: row.attempts + 1 })
      .eq("content_hash", book.hash)
      .eq("chapter_index", chapterIndex);
    return "failed";
  }
}

/** Reset a failed chapter so the next prepare takes it. */
export async function retryChapter(
  admin: SupabaseClient,
  hash: string,
  chapterIndex: number
): Promise<void> {
  await admin
    .from("reading_plain_chapters")
    .update({ status: "pending", error_message: null, claimed_at: null })
    .eq("content_hash", hash)
    .eq("chapter_index", chapterIndex)
    .eq("status", "failed");
}

/**
 * Translate a handful of paragraphs on demand — the selection peek.
 *
 * Guarded by a short-lived claim on the exact range, so a second identical tap
 * waits for the first rather than paying again. Stores what it makes (so the
 * next peek is instant and a later whole-chapter run skips them) but never
 * touches chapter rows: a peek must not make a book look enabled.
 */
export async function translatePeek(
  admin: SupabaseClient,
  book: HashedBook,
  chapterIndex: number,
  chapterTitle: string,
  from: number,
  to: number
): Promise<"ready" | "preparing"> {
  const already = await storedBlockIndices(admin, book.hash, from, to);
  const chunks = chunkRange(book.blocks, chapterIndex, from, to).filter(
    (c) => !c.blocks.every((b) => already.has(b.index))
  );
  if (chunks.length === 0) return "ready";

  const claimed = await claimPeek(admin, book.hash, from, to);
  if (!claimed) return "preparing";

  const client = anthropic();
  const promptBook: PlainPromptBook = { title: book.title, author: book.author, chapterTitle };
  try {
    for (const chunk of chunks) {
      const result = await translateChunk(client, chunk, promptBook, {
        allowSplit: true,
        startWithFallback: false,
      });
      await storeEntries(admin, book.hash, chapterIndex, result.entries, result.model);
      await storeTerms(admin, book.hash, chapterIndex, result.terms);
    }
    return "ready";
  } finally {
    await admin
      .from("reading_plain_peeks")
      .delete()
      .eq("content_hash", book.hash)
      .eq("block_start", from)
      .eq("block_end", to);
  }
}

async function claimPeek(
  admin: SupabaseClient,
  hash: string,
  from: number,
  to: number
): Promise<boolean> {
  const inserted = await admin
    .from("reading_plain_peeks")
    .insert({ content_hash: hash, block_start: from, block_end: to });
  if (!inserted.error) return true;
  if (inserted.error.code !== "23505") throw new Error(inserted.error.message);

  const stale = await admin
    .from("reading_plain_peeks")
    .update({ claimed_at: new Date().toISOString() })
    .eq("content_hash", hash)
    .eq("block_start", from)
    .eq("block_end", to)
    .lt("claimed_at", new Date(Date.now() - PLAIN_PEEK_STALE_MS).toISOString())
    .select("content_hash");
  if (stale.error) throw new Error(stale.error.message);
  return (stale.data ?? []).length > 0;
}

/** The blocks of a book that fall inside a block range — for the peek panel. */
export function blocksInRange(blocks: BookBlock[], from: number, to: number): BookBlock[] {
  return blocks.slice(Math.max(0, from), Math.min(blocks.length, to));
}
