/**
 * Backfill reading_book_content.word_count and the TOC's per-chapter startWord
 * for books converted before migration 00163 added them.
 *
 * Why this exists: the reader's time-left estimate is word_count * (1 - ratio)
 * / 250 (reading-time.ts), so a null word_count silently drops the estimate
 * while percent-complete — which is derived from characters — keeps working.
 * Books converted before #416 have that null.
 *
 * Why not just re-run the converter: POST /reader/api/convert re-parses the
 * original file with today's converter, which injects a heading per nav entry.
 * That shifts the character space out from under every stored annotation and
 * chat anchor, rewrites the page map, overwrites total_pages with 280-word
 * synthetic pages, and — for an in_progress book — plants a weekly goal, a due
 * date and a generated stretch quiz. None of that is wanted to recover two
 * numbers that are already computable from the HTML we stored.
 *
 * So this reads the CONVERTED HTML instead and counts it, touching nothing but
 * word_count and toc. The character space is left exactly as it was, so reading
 * positions and anchors are untouched.
 *
 * Usage (dry run — reports what it would write, changes nothing):
 *   npx tsx scripts/backfill-reading-word-counts.mts
 *
 * Prove the arithmetic first — recount books the converter ALREADY counted and
 * compare against its stored word_count. Any drift means this file and
 * convert.ts have diverged, and the backfill should not be trusted:
 *   npx tsx scripts/backfill-reading-word-counts.mts --verify
 *
 * Against production, applying:
 *   NEXT_PUBLIC_SUPABASE_ENV=production \
 *   SUPABASE_SERVICE_ROLE_KEY=<from the Vercel dashboard> \
 *   npx tsx scripts/backfill-reading-word-counts.mts --apply
 *
 * dotenv does not override variables already in the environment, so the two
 * above win over .env.local's NEXT_PUBLIC_SUPABASE_ENV=local.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

// Loaded after dotenv: supabase/config.ts reads process.env at module scope, so
// a static import would resolve the URL before .env.local is on the environment.
const { createAdminClient } = await import("../src/lib/supabase/admin");
const { blockMap } = await import("../src/lib/reading/block-stream");
const { READING_BOOKS_BUCKET } = await import("../src/lib/reading/constants");
import type { ReadingTocEntry } from "../src/lib/types";

const apply = process.argv.includes("--apply");
const verify = process.argv.includes("--verify");

/**
 * Whitespace-delimited tokens — the same counter convert.ts uses. Duplicated
 * rather than imported because convert.ts is "server-only" and pulls in pdfjs;
 * if that definition ever changes, change it here too.
 */
function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

const admin = createAdminClient();

/** Fetch a book's converted HTML, or null with a reason to report. */
async function loadHtml(contentPath: string | null): Promise<string | null> {
  if (!contentPath) return null;
  const download = await admin.storage.from(READING_BOOKS_BUCKET).download(contentPath);
  if (download.error || !download.data) return null;
  return await download.data.text();
}

// --verify: recount books that already carry a converter-written word_count and
// compare. This is the whole basis for trusting the backfill — it is the same
// arithmetic over the same text, so an exact match on every book means a
// backfilled count is indistinguishable from a converted one.
if (verify) {
  const { data: counted, error: verifyError } = await admin
    .from("reading_book_content")
    .select("book_id, content_path, word_count")
    .eq("status", "ready")
    .neq("source_format", "article")
    .not("word_count", "is", null);
  if (verifyError) throw new Error(verifyError.message);
  if (!counted || counted.length === 0) {
    console.log("No converter-counted books here to check against.");
    process.exit(0);
  }

  let mismatches = 0;
  for (const row of counted) {
    const html = await loadHtml(row.content_path as string | null);
    if (html == null) {
      console.log(`- ${row.book_id}: content unreadable — cannot check`);
      continue;
    }
    const mine = blockMap(html).reduce((sum, b) => sum + countWords(b.text), 0);
    const theirs = row.word_count as number;
    const ok = mine === theirs;
    if (!ok) mismatches++;
    console.log(
      `${ok ? "  ok" : "FAIL"}  ${row.book_id}  converter ${theirs.toLocaleString()} / recount ${mine.toLocaleString()}`
    );
  }
  console.log(
    mismatches === 0
      ? `\nAll ${counted.length} match — the recount reproduces convert.ts exactly.`
      : `\n${mismatches} of ${counted.length} disagree — do NOT run the backfill.`
  );
  process.exit(mismatches === 0 ? 0 : 1);
}

// Converted books only. Saved articles are deliberately excluded: their HTML
// comes from save-article.ts rather than convert.ts, and their anchors live in a
// DOM text-stream space over the rendered container (see 00167's header), not
// the conversion char space blockMap() reconstructs. Their "N min read" label
// already comes from reading_books.word_count.
const { data: rows, error } = await admin
  .from("reading_book_content")
  .select("book_id, user_id, content_path, char_count, word_count, toc, status")
  .eq("status", "ready")
  .neq("source_format", "article")
  .is("word_count", null);
if (error) throw new Error(error.message);

if (!rows || rows.length === 0) {
  console.log("Nothing to backfill — every ready book already has a word count.");
  process.exit(0);
}

console.log(
  `${rows.length} book(s) with a null word_count.${apply ? "" : "  (dry run — pass --apply to write)"}\n`
);

let written = 0;
let skipped = 0;

for (const row of rows) {
  const bookId = row.book_id as string;
  const { data: book } = await admin
    .from("reading_books")
    .select("title")
    .eq("id", bookId)
    .maybeSingle();
  const label = `${(book?.title as string) ?? bookId}`;

  const html = await loadHtml(row.content_path as string | null);
  if (html == null) {
    console.log(`- ${label}: converted HTML unreadable — skipped`);
    skipped++;
    continue;
  }
  const blocks = blockMap(html);
  if (blocks.length === 0) {
    console.log(`- ${label}: no blocks parsed out of the HTML — skipped`);
    skipped++;
    continue;
  }

  // Guard: the stored char_count is what every anchor and page row was recorded
  // against. If recomputing it from this HTML disagrees, the file on disk is not
  // the one those offsets describe, and anything derived from it would be wrong.
  const last = blocks[blocks.length - 1];
  const recomputedChars = last.charStart + last.text.length + 1;
  const storedChars = row.char_count as number | null;
  if (storedChars != null && recomputedChars !== storedChars) {
    console.log(
      `- ${label}: char_count mismatch (stored ${storedChars}, recomputed ${recomputedChars}) — skipped`
    );
    skipped++;
    continue;
  }

  // Words before each block, in document order, so a heading's id resolves
  // straight to the chapter's word offset.
  const wordsBeforeId = new Map<string, number>();
  let wordCursor = 0;
  for (const block of blocks) {
    if (block.id) wordsBeforeId.set(block.id, wordCursor);
    wordCursor += countWords(block.text);
  }

  const toc = (row.toc as ReadingTocEntry[] | null) ?? [];
  let resolved = 0;
  const nextToc = toc.map((entry) => {
    const startWord = wordsBeforeId.get(entry.anchorId);
    if (startWord == null) return entry;
    resolved++;
    return { ...entry, startWord };
  });

  console.log(
    `- ${label}: ${wordCursor.toLocaleString()} words, ` +
      `${resolved}/${toc.length} chapters located` +
      (resolved < toc.length ? "  (unlocated chapters fall back to characters)" : "")
  );

  if (!apply) continue;

  // Only these two columns. Not the page map, not reading_books, not the
  // position — the character space is unchanged, so nothing else needs to move.
  const { error: updateError } = await admin
    .from("reading_book_content")
    .update({ word_count: wordCursor, toc: nextToc })
    .eq("book_id", bookId)
    .eq("user_id", row.user_id as string);
  if (updateError) {
    console.log(`  ! write failed: ${updateError.message}`);
    skipped++;
    continue;
  }
  written++;
}

console.log(
  apply
    ? `\nDone — ${written} updated, ${skipped} skipped.`
    : `\nDry run complete — ${rows.length - skipped} would be updated, ${skipped} skipped.`
);
