/**
 * One-time eBook library import — commit pass.
 *
 * Takes the manifest the scan pass produced and applies it: creates the book
 * rows, uploads each EPUB, converts it, and writes the page map — the same work
 * the site's upload flow does, just without a browser or a five-minute function
 * timeout in the way.
 *
 * WRITES TO PRODUCTION. Requires SUPABASE_SERVICE_ROLE_KEY, which bypasses row
 * security, so every statement is scoped to the resolved user id by hand.
 *
 * Resumable: each finished book is appended to a log, and a re-run skips
 * anything already logged. Safe to interrupt.
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY from .env.local (gitignored) rather than the
 * command line, so the key stays out of shell history:
 *
 *   npx tsx --env-file=.env.local --tsconfig scripts/tsconfig.json \
 *     scripts/import-ebooks/commit.mts --email andrew@mason.io [--limit N] [--force]
 */

import { readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { convertBookFile } from "@/lib/reading/convert";
import {
  WORDS_PER_PAGE,
  chapterSpans,
  contentWordCount,
} from "@/lib/reading/chapter-target";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import type { ScannedBook } from "./types";

const MANIFEST = resolve(".context/ebook-import-manifest.json");
const LOG = resolve(".context/ebook-import-log.jsonl");

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_PROD_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_PROD_URL is not set.");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  if (url.includes("127.0.0.1") || url.includes("localhost")) {
    throw new Error(`Refusing to run: ${url} is a local instance, not production.`);
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function resolveUserId(db: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await db
    .from("family_members")
    .select("user_id, email")
    .eq("email", email)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.user_id) throw new Error(`No family member with a login for ${email}.`);
  return data.user_id as string;
}

/** Stems already imported, so a re-run picks up where it left off. */
async function alreadyDone(): Promise<Set<string>> {
  if (!existsSync(LOG)) return new Set();
  const lines = (await readFile(LOG, "utf8")).split("\n").filter(Boolean);
  return new Set(
    lines
      .map((l) => JSON.parse(l) as { stem: string; ok: boolean })
      .filter((e) => e.ok)
      .map((e) => e.stem)
  );
}

async function main() {
  const email = arg("email") ?? "andrew@mason.io";
  const limit = arg("limit") ? Number(arg("limit")) : Infinity;
  const only = arg("only");
  const force = flag("force");

  const manifest = JSON.parse(await readFile(MANIFEST, "utf8")) as {
    books: ScannedBook[];
  };
  const done = await alreadyDone();

  const todo = manifest.books
    .filter((b) => b.action === "create" || b.action === "attach")
    .filter((b) => (only ? b.stem.toLowerCase().includes(only.toLowerCase()) : true))
    .filter((b) => !done.has(b.stem))
    .slice(0, limit);

  if (todo.length === 0) {
    console.log("Nothing to do — every book in the manifest is already imported.");
    return;
  }

  const db = client();
  const userId = await resolveUserId(db, email);
  console.log(
    `Importing ${todo.length} books into ${email} (${userId})` +
      (done.size ? ` — ${done.size} already done` : "") +
      `\n`
  );

  let ok = 0;
  let failed = 0;
  for (const [i, book] of todo.entries()) {
    const label = `[${String(i + 1).padStart(3)}/${todo.length}] ${book.title}`;
    try {
      await importOne(db, userId, book, force);
      await appendFile(LOG, JSON.stringify({ stem: book.stem, ok: true }) + "\n");
      ok++;
      console.log(`${label}  ✓`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendFile(
        LOG,
        JSON.stringify({ stem: book.stem, ok: false, error: message }) + "\n"
      );
      failed++;
      console.error(`${label}  ✗ ${message}`);
    }
  }

  console.log(`\nDone. ${ok} imported, ${failed} failed.`);
  if (failed) console.log(`Failures are in ${LOG}; re-run to retry just those.`);
}

async function importOne(
  db: SupabaseClient,
  userId: string,
  book: ScannedBook,
  force: boolean
) {
  if (!book.epubPath) throw new Error("No EPUB file.");

  let bookId = book.duplicateOf?.id ?? null;

  if (bookId) {
    // Attaching to a book that's already on the shelf. Re-converting rewrites the
    // character offsets everything else is anchored to, so refuse if there's a
    // reading position or an annotation to lose.
    const [{ count: states }, { count: annotations }] = await Promise.all([
      db
        .from("reading_book_state")
        .select("book_id", { count: "exact", head: true })
        .eq("book_id", bookId),
      db
        .from("reading_annotations")
        .select("id", { count: "exact", head: true })
        .eq("book_id", bookId),
    ]);
    if (!force && ((states ?? 0) > 0 || (annotations ?? 0) > 0)) {
      throw new Error(
        `already has a reading position or notes — attaching a file would reset them (--force to override)`
      );
    }
  } else {
    bookId = randomUUID();
    const { error } = await db.from("reading_books").insert({
      id: bookId,
      user_id: userId,
      title: book.title,
      author: book.author,
      status: "archive",
      current_page: 0,
      total_pages: null,
      target_page: null,
      target_due: null,
      cover_image_url: book.coverImageUrl,
      openlibrary_key: book.openlibraryKey,
      isbn: book.isbn,
      published_year: book.year,
      // These are old books read long ago; a "finished today" stamp would feed
      // the journal a fresh milestone that never happened.
      finished_at: null,
      started_at: null,
      spoiler_free: true,
    });
    if (error) throw new Error(error.message);
  }

  // Upload the source file, then convert it exactly as the site would.
  const sourcePath = `${userId}/${bookId}/source.epub`;
  const bytes = await readFile(book.epubPath);
  const upload = await db.storage
    .from(READING_BOOKS_BUCKET)
    .upload(sourcePath, bytes, {
      contentType: "application/epub+zip",
      upsert: true,
    });
  if (upload.error) throw new Error(`upload failed: ${upload.error.message}`);

  const { error: contentError } = await db.from("reading_book_content").upsert(
    {
      book_id: bookId,
      user_id: userId,
      source_format: "epub",
      source_path: sourcePath,
      status: "processing",
      error_message: null,
    },
    { onConflict: "book_id" }
  );
  if (contentError) throw new Error(contentError.message);

  const result = await convertBookFile("epub", bytes.buffer as ArrayBuffer);

  const contentPath = `${userId}/${bookId}/content.html`;
  const htmlUpload = await db.storage
    .from(READING_BOOKS_BUCKET)
    .upload(contentPath, new Blob([result.html], { type: "text/html" }), {
      contentType: "text/html",
      upsert: true,
    });
  if (htmlUpload.error) throw new Error(`html upload failed: ${htmlUpload.error.message}`);

  await db.from("reading_book_pages").delete().eq("book_id", bookId);
  if (result.pages.length > 0) {
    const rows = result.pages.map((p) => ({
      book_id: bookId,
      user_id: userId,
      page_number: p.pageNumber,
      anchor_id: p.anchorId,
      char_start: p.charStart,
      char_end: p.charEnd,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db
        .from("reading_book_pages")
        .insert(rows.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
  }

  const { error: finalizeError } = await db
    .from("reading_book_content")
    .update({
      status: "ready",
      content_path: contentPath,
      page_count: result.pageCount,
      has_real_pages: result.hasRealPages,
      char_count: result.charCount,
      word_count: result.wordCount,
      toc: result.toc,
      error_message: null,
    })
    .eq("book_id", bookId)
    .eq("user_id", userId);
  if (finalizeError) throw new Error(finalizeError.message);

  // Same post-conversion fixups the site applies: define the page space for a
  // chaptered EPUB, and fall back to the file's own cover if we found none.
  const spans = chapterSpans(result.toc, result.wordCount);
  const chaptered = !result.hasRealPages && result.wordCount > 0 && spans.length > 0;
  const totalPages = chaptered
    ? Math.ceil(contentWordCount(spans, result.wordCount) / WORDS_PER_PAGE)
    : result.pageCount;

  // The cover was already resolved and shrunk during the scan, so nothing to do
  // here but record the page total.
  const update: Record<string, unknown> = {};
  if (totalPages) update.total_pages = totalPages;

  if (Object.keys(update).length > 0) {
    const { error } = await db
      .from("reading_books")
      .update(update)
      .eq("id", bookId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
