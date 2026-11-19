/**
 * Re-convert one book that was imported by an older converter, and carry the
 * reader's marks across to the new text.
 *
 * WHY THIS EXISTS
 *
 * Converter fixes only reach books imported after them. A book imported before
 * the converter learned to keep part dividers and textless chapter title pages
 * still has the contents it was given then — for The Morning Star, a novel with
 * no chapters at all, filed under its own epigraph. `backfill-toc-depth.mts`
 * can't help: it only adds nesting to a contents that is otherwise identical,
 * and here the rows themselves are missing.
 *
 * The missing rows are headings, and headings are printed into the book's HTML.
 * So fixing the contents means replacing the HTML, which moves every block
 * index and character offset after each new heading — the space highlights,
 * bookmarks, the page map and the reading position all live in.
 *
 * WHY THIS IS SAFE, AND THE CHECK THAT MAKES IT SO
 *
 * Before anything is written, the stored book and the fresh conversion are
 * aligned block by block. The only difference allowed is that the fresh one has
 * extra HEADINGS: every stored block must reappear, in order, with identical
 * text, and nothing else may be added. Given that, each old position has exactly
 * one new position, and every mark is moved by that map rather than by searching
 * for its text. A highlight's quoted text is then re-read from its new place and
 * must still match.
 *
 * It refuses outright when it can't carry something across: narrated audio or a
 * Plain English translation cut against the old text, or another copy of the
 * book sharing this text (shared marks rely on the two being identical).
 *
 * It does NOT touch reading_books (page total, weekly target) or quizzes.
 *
 * Defaults to a dry run. --write also needs --backup-dir, where the stored HTML
 * and every row about to change are saved first.
 *
 *   npx tsx --env-file=.env.local --tsconfig scripts/tsconfig.json \
 *     scripts/reconvert-book.mts --book <book id> [--write --backup-dir <dir>]
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { blockIndexForCharOffset, blockMap, type BookBlock } from "@/lib/reading/block-stream";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import { buildContents, type ContentsNode } from "@/lib/reading/contents-tree";
import { convertBookFile, type ConvertedPage } from "@/lib/reading/convert";
import type { ReadingTocEntry } from "@/lib/types";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const WRITE = process.argv.includes("--write");
const BOOK = arg("book");
const BACKUP_DIR = arg("backup-dir");

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_PROD_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_PROD_URL is not set.");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  if (url.includes("127.0.0.1") || url.includes("localhost")) {
    throw new Error(`Refusing to run: ${url} is a local instance, not production.`);
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

const isHeading = (b: BookBlock) => b.tag !== "p";

/**
 * Old block index → new block index, or a reason the two books aren't the same
 * text. Greedy and in order: a new block either IS the next old block, or is a
 * heading the old conversion never printed. Anything else is a different book.
 */
export function alignBlocks(
  old: BookBlock[],
  fresh: BookBlock[]
): { map: number[]; added: BookBlock[] } | { error: string } {
  const map: number[] = [];
  const added: BookBlock[] = [];
  let i = 0;
  for (const block of fresh) {
    const expected = old[i];
    if (expected && expected.tag === block.tag && expected.text === block.text) {
      map.push(block.index);
      i++;
    } else if (isHeading(block)) {
      added.push(block);
    } else {
      return {
        error:
          `new block ${block.index} is text the stored book doesn't have at block ${i}: ` +
          JSON.stringify(block.text.slice(0, 80)),
      };
    }
  }
  if (i < old.length) {
    return {
      error:
        `stored block ${i} has no counterpart in the fresh conversion: ` +
        JSON.stringify(old[i].text.slice(0, 80)),
    };
  }
  return { map, added };
}

type PageSpan = { pageNumber: number; charStart: number; charEnd: number };

function pageAt(pages: PageSpan[], char: number): number | null {
  for (const p of pages) if (char >= p.charStart && char < p.charEnd) return p.pageNumber;
  return null;
}

function show(nodes: ContentsNode[], depth = 1): void {
  for (const n of nodes) {
    const mins = n.minutes == null ? "" : `  (${Math.round(n.minutes)} min)`;
    console.log(`${"  ".repeat(depth)}${n.title}${mins}`);
    show(n.children, depth + 1);
  }
}

async function must<T>(
  what: string,
  p: PromiseLike<{ data: T; error: { message: string } | null }>
): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  // A write without .select() returns null data; callers of those ignore it.
  return data as NonNullable<T>;
}

/**
 * --survey: which books on the shelf would a re-conversion change? Read-only —
 * one line per EPUB, saying whether a fresh conversion is identical, only adds
 * headings (the case this script repairs), or is a different text altogether.
 */
async function survey() {
  const db = client();
  const rows = await must(
    "content rows",
    db
      .from("reading_book_content")
      .select("book_id, source_path, content_path, content_hash, toc, created_at")
      .eq("status", "ready")
      .eq("source_format", "epub")
      .order("created_at")
  );
  const books = await must("books", db.from("reading_books").select("id, title, status").in("id", rows.map((r) => r.book_id)));
  const bookOf = new Map(books.map((b) => [b.id as string, b]));
  const head = { count: "exact" as const, head: true };
  const tally = { same: 0, fixable: 0, blocked: 0, different: 0, failed: 0 };

  for (const row of rows) {
    const id = row.book_id as string;
    const title = `${bookOf.get(id)?.title ?? id} [${bookOf.get(id)?.status ?? "?"}]`;
    try {
      const source = await db.storage.from(READING_BOOKS_BUCKET).download(row.source_path);
      const stored = await db.storage.from(READING_BOOKS_BUCKET).download(row.content_path);
      if (source.error || !source.data || stored.error || !stored.data) throw new Error("file unreadable");
      const oldHtml = await stored.data.text();
      const fresh = await convertBookFile("epub", await source.data.arrayBuffer());
      if (fresh.html === oldHtml) {
        tally.same++;
        continue;
      }
      const aligned = alignBlocks(blockMap(oldHtml), blockMap(fresh.html));
      if ("error" in aligned) {
        tally.different++;
        console.log(`DIFFERENT  ${id}  ${title} — ${aligned.error}`);
        continue;
      }
      const n = async (table: string, col: string, val: string) =>
        (await db.from(table).select(col, head).eq(col, val)).count ?? 0;
      const marks = (await n("reading_annotations", "book_id", id)) + (await n("reading_bookmarks", "book_id", id));
      const blockers: string[] = [];
      if (await n("reading_audio_chapters", "book_id", id)) blockers.push("audio");
      if (row.content_hash && (await n("reading_plain_chapters", "content_hash", row.content_hash as string))) blockers.push("plain english");
      if (row.content_hash && (await n("reading_book_content", "content_hash", row.content_hash as string)) > 1) blockers.push("shared text");
      if (await n("reading_books", "copied_from_book_id", id)) blockers.push("has copies");
      const oldRows = ((row.toc ?? []) as unknown[]).length;
      const added = aligned.added.map((b) => b.text);
      const sample = added.slice(0, 6).join(", ") + (added.length > 6 ? ", …" : "");
      if (blockers.length > 0) tally.blocked++;
      else tally.fixable++;
      console.log(
        `${blockers.length > 0 ? "BLOCKED  " : "FIXABLE  "}  ${id}  ${title} — contents ${oldRows} → ${fresh.toc.length} rows, ` +
          `+${added.length} headings (${sample}); ${marks} mark(s)` +
          (blockers.length > 0 ? `; blocked by: ${blockers.join(", ")}` : "")
      );
    } catch (e) {
      tally.failed++;
      console.log(`FAILED     ${id}  ${title} — ${(e as Error).message}`);
    }
  }
  console.log(
    `\n${rows.length} EPUBs: ${tally.same} already current, ${tally.fixable} fixable, ` +
      `${tally.blocked} fixable but blocked, ${tally.different} different text, ${tally.failed} failed.`
  );
}

async function main() {
  if (process.argv.includes("--survey")) return survey();
  if (!BOOK) throw new Error("--book <id> is required.");
  if (WRITE && !BACKUP_DIR) throw new Error("--write needs --backup-dir <dir>.");
  const db = client();

  const content = await must(
    "content row",
    db
      .from("reading_book_content")
      .select("book_id, user_id, source_format, source_path, content_path, content_hash, status, toc, char_count, word_count, page_count, has_real_pages")
      .eq("book_id", BOOK)
      .single()
  );
  const book = await must("book", db.from("reading_books").select("id, title").eq("id", BOOK).single());
  if (content.status !== "ready") throw new Error(`Book is "${content.status}", not ready.`);
  if (content.source_format !== "epub") throw new Error("Only EPUBs — a PDF's headings aren't read from a nav.");
  console.log(`${book.title}${WRITE ? "" : "  — DRY RUN, pass --write to apply"}`);

  const source = await db.storage.from(READING_BOOKS_BUCKET).download(content.source_path);
  if (source.error || !source.data) throw new Error(`source file: ${source.error?.message}`);
  const stored = await db.storage.from(READING_BOOKS_BUCKET).download(content.content_path);
  if (stored.error || !stored.data) throw new Error(`stored html: ${stored.error?.message}`);
  const oldHtml = await stored.data.text();

  const fresh = await convertBookFile("epub", await source.data.arrayBuffer());
  const newHash = createHash("sha256").update(fresh.html).digest("hex");
  if (fresh.html === oldHtml) {
    console.log("Already current: a fresh conversion is identical to what is stored.");
    return;
  }

  // ── What can't be carried across ────────────────────────────────────────────
  const blockers: string[] = [];
  const count = async (what: string, q: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count: n, error } = await q;
    if (error) throw new Error(`${what}: ${error.message}`);
    return n ?? 0;
  };
  const head = { count: "exact" as const, head: true };
  if (await count("audio", db.from("reading_audio_chapters").select("book_id", head).eq("book_id", BOOK)))
    blockers.push("it has narrated audio cut against the old text");
  if (content.content_hash) {
    if (await count("plain", db.from("reading_plain_chapters").select("content_hash", head).eq("content_hash", content.content_hash)))
      blockers.push("it has a Plain English translation of the old text");
    if (await count("siblings", db.from("reading_book_content").select("book_id", head).eq("content_hash", content.content_hash).neq("book_id", BOOK)))
      blockers.push("another copy shares this exact text, and shared marks rely on that");
  }
  if (await count("copies", db.from("reading_books").select("id", head).eq("copied_from_book_id", BOOK)))
    blockers.push("other books were copied from it");

  // ── The map from the old text to the new ───────────────────────────────────
  const oldBlocks = blockMap(oldHtml);
  const newBlocks = blockMap(fresh.html);
  const aligned = alignBlocks(oldBlocks, newBlocks);
  if ("error" in aligned) throw new Error(`Not the same text — ${aligned.error}`);
  const { map, added } = aligned;

  const mapChar = (char: number): number => {
    const b = oldBlocks[blockIndexForCharOffset(oldBlocks, char)];
    return newBlocks[map[b.index]].charStart + (char - b.charStart);
  };
  const newIdOf = new Map<string, string>();
  for (const b of oldBlocks) {
    const id = newBlocks[map[b.index]].id;
    if (b.id && id) newIdOf.set(b.id, id);
  }
  const mapId = (id: string | null): string | null => {
    if (id == null) return null;
    const next = newIdOf.get(id);
    if (!next) throw new Error(`No new heading for stored anchor ${id}.`);
    return next;
  };

  // Paged: the API returns at most 1000 rows a request, and long books have more.
  const oldPageRows: { page_number: number; char_start: number; char_end: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const batch = await must(
      "pages",
      db
        .from("reading_book_pages")
        .select("page_number, char_start, char_end")
        .eq("book_id", BOOK)
        .order("page_number")
        .range(from, from + 999)
    );
    oldPageRows.push(...batch);
    if (batch.length < 1000) break;
  }
  const oldPages: PageSpan[] = (oldPageRows ?? []).map((p) => ({
    pageNumber: p.page_number as number,
    charStart: p.char_start as number,
    charEnd: p.char_end as number,
  }));
  const newPages: ConvertedPage[] = fresh.pages;
  /** A stored page number → the new page holding the text that page started with. */
  const mapPage = (page: number | null): number | null => {
    if (page == null) return null;
    const old = oldPages.find((p) => p.pageNumber === page);
    if (!old) return page;
    return pageAt(newPages, mapChar(old.charStart)) ?? page;
  };

  // ── Every row that lives in the old space ──────────────────────────────────
  type Change = { table: string; match: Record<string, string>; before: Record<string, unknown>; after: Record<string, unknown> };
  const changes: Change[] = [];

  const annotations = await must(
    "annotations",
    db
      .from("reading_annotations")
      .select("id, anchor, anchor_char_offset, anchor_page, context_through_page, chapter_anchor_id")
      .eq("book_id", BOOK)
  );
  for (const a of annotations ?? []) {
    const anchor = a.anchor as Record<string, unknown> | null;
    const before = {
      anchor,
      anchor_char_offset: a.anchor_char_offset,
      anchor_page: a.anchor_page,
      context_through_page: a.context_through_page,
      chapter_anchor_id: a.chapter_anchor_id,
    };
    const nextAnchor = anchor ? { ...anchor } : anchor;
    if (nextAnchor && anchor) {
      for (const key of ["blockIndex", "endBlockIndex"]) {
        const v = nextAnchor[key];
        if (typeof v === "number") nextAnchor[key] = map[v];
      }
      // The proof the highlight still covers the words it covered before. Not
      // compared to the stored quote: some marks (imported ones, mostly) never
      // matched theirs exactly, and that is not this script's to judge or fix.
      const { startOffset, endOffset } = anchor as Record<string, number>;
      for (const key of ["blockIndex", "endBlockIndex"]) {
        const from = anchor[key];
        const to = nextAnchor[key];
        if (typeof from !== "number" || typeof to !== "number") continue;
        const cut = (blocks: BookBlock[], i: number) =>
          blocks[i]?.text.slice(key === "blockIndex" ? startOffset ?? 0 : 0, key === "endBlockIndex" ? endOffset : undefined);
        if (cut(oldBlocks, from) !== cut(newBlocks, to)) {
          blockers.push(`highlight ${a.id} would land on ${JSON.stringify(String(cut(newBlocks, to)).slice(0, 60))}`);
        }
      }
    }
    const nextOffset = typeof a.anchor_char_offset === "number" ? mapChar(a.anchor_char_offset) : a.anchor_char_offset;
    // A page recorded as "the page this sits on" stays that; anything else is
    // carried by where its page began.
    const sitsOn = (page: number | null) =>
      page != null && typeof a.anchor_char_offset === "number" && pageAt(oldPages, a.anchor_char_offset) === page;
    const nextPage = (page: number | null) =>
      sitsOn(page) ? pageAt(newPages, nextOffset as number) : mapPage(page);
    changes.push({
      table: "reading_annotations",
      match: { id: a.id as string },
      before,
      after: {
        anchor: nextAnchor,
        anchor_char_offset: nextOffset,
        anchor_page: nextPage(a.anchor_page as number | null),
        context_through_page: nextPage(a.context_through_page as number | null),
        chapter_anchor_id: mapId(a.chapter_anchor_id as string | null),
      },
    });
  }

  const bookmarks = await must(
    "bookmarks",
    db.from("reading_bookmarks").select("id, char_offset, block_index, page_number").eq("book_id", BOOK)
  );
  for (const b of bookmarks ?? []) {
    const { id, ...before } = b as { id: string; char_offset: number | null; block_index: number | null; page_number: number | null };
    const offset = before.char_offset == null ? null : mapChar(before.char_offset);
    changes.push({
      table: "reading_bookmarks",
      match: { id },
      before,
      after: {
        char_offset: offset,
        block_index: before.block_index == null ? null : map[before.block_index],
        page_number: before.page_number == null ? null : offset != null ? pageAt(newPages, offset) : mapPage(before.page_number),
      },
    });
  }

  const states = await must(
    "reading state",
    db.from("reading_book_state").select("user_id, last_char_offset, last_anchor_id, last_page_number").eq("book_id", BOOK)
  );
  for (const s of states ?? []) {
    const { user_id, ...before } = s as { user_id: string; last_char_offset: number | null; last_anchor_id: string | null; last_page_number: number | null };
    changes.push({
      table: "reading_book_state",
      match: { book_id: BOOK, user_id },
      before,
      after: {
        last_char_offset: before.last_char_offset == null ? null : mapChar(before.last_char_offset),
        last_anchor_id: mapId(before.last_anchor_id),
        last_page_number: mapPage(before.last_page_number),
      },
    });
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  const oldToc = (content.toc ?? []) as ReadingTocEntry[];
  console.log(`\nText: ${oldBlocks.length} blocks stored, all present and in order in the fresh conversion.`);
  console.log(`Headings added: ${added.length} — ${added.map((b) => b.text).join(", ")}`);
  console.log(`Contents rows: ${oldToc.length} → ${fresh.toc.length}.  Words: ${content.word_count} → ${fresh.wordCount}.  Pages: ${oldPages.length} → ${newPages.length}.`);
  console.log("\nNew contents:");
  const contents = buildContents(fresh.toc as ReadingTocEntry[], book.title as string, fresh.wordCount);
  console.log(" Front matter"); show(contents.front, 2);
  console.log(" Body"); show(contents.body, 2);
  console.log(" Back matter"); show(contents.back, 2);
  console.log(`\nRows to move (${changes.length}):`);
  for (const c of changes) {
    console.log(`  ${c.table} ${JSON.stringify(c.match)}`);
    for (const key of Object.keys(c.after)) {
      const from = JSON.stringify(key === "anchor" ? pickIndices(c.before[key]) : c.before[key]);
      const to = JSON.stringify(key === "anchor" ? pickIndices(c.after[key]) : c.after[key]);
      if (from !== to) console.log(`    ${key}: ${from} → ${to}`);
    }
  }

  if (blockers.length > 0) {
    console.log("\nREFUSING — this book can't be re-converted in place:");
    for (const b of blockers) console.log(`  - ${b}`);
    process.exit(2);
  }
  if (!WRITE) {
    console.log("\nDry run: nothing written.");
    return;
  }

  // ── Write ──────────────────────────────────────────────────────────────────
  mkdirSync(BACKUP_DIR!, { recursive: true });
  writeFileSync(join(BACKUP_DIR!, `${BOOK}.content.html`), oldHtml);
  writeFileSync(
    join(BACKUP_DIR!, `${BOOK}.rows.json`),
    JSON.stringify({ content, pages: oldPageRows, changes }, null, 1)
  );
  console.log(`\nBackup written to ${BACKUP_DIR}.`);

  const step = async (what: string, run: () => Promise<void>) => {
    try {
      await run();
      console.log(`  ok  ${what}`);
    } catch (e) {
      console.error(`\nFAILED at "${what}": ${(e as Error).message}`);
      console.error(`The book is now PARTLY updated. Restore from ${BACKUP_DIR} or finish by hand — do not just re-run.`);
      process.exit(1);
    }
  };

  await step("upload html", async () => {
    const up = await db.storage
      .from(READING_BOOKS_BUCKET)
      .upload(content.content_path, new Blob([fresh.html], { type: "text/html" }), { contentType: "text/html", upsert: true });
    if (up.error) throw new Error(up.error.message);
  });
  await step("page map", async () => {
    await must("delete pages", db.from("reading_book_pages").delete().eq("book_id", BOOK));
    const rows = newPages.map((p) => ({
      book_id: BOOK,
      user_id: content.user_id,
      page_number: p.pageNumber,
      anchor_id: p.anchorId,
      char_start: p.charStart,
      char_end: p.charEnd,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await must("insert pages", db.from("reading_book_pages").insert(rows.slice(i, i + 500)));
    }
  });
  await step("contents", async () => {
    await must(
      "content row",
      db
        .from("reading_book_content")
        .update({
          content_hash: newHash,
          page_count: fresh.pageCount,
          has_real_pages: fresh.hasRealPages,
          char_count: fresh.charCount,
          word_count: fresh.wordCount,
          toc: fresh.toc,
        })
        .eq("book_id", BOOK)
    );
  });
  for (const c of changes) {
    await step(`${c.table} ${Object.values(c.match).join("/")}`, async () => {
      let q = db.from(c.table).update(c.after);
      for (const [k, v] of Object.entries(c.match)) q = q.eq(k, v);
      await must("update", q);
    });
  }
  console.log("\nDone. Reload the reader on any device that has this book open.");
}

function pickIndices(anchor: unknown): unknown {
  if (!anchor || typeof anchor !== "object") return anchor;
  const { blockIndex, endBlockIndex } = anchor as Record<string, unknown>;
  return { blockIndex, endBlockIndex };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
