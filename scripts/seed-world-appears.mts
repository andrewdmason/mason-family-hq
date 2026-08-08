/**
 * Seed "A World Appears" as Andrew's active book, with his real Kindle
 * highlights, into the local database.
 *
 * Why this isn't a .sql seed like the other books: the book is copyrighted and
 * this repository is public, so its text is deliberately NOT committed. The
 * seeder converts a local copy of the EPUB instead. Conversion is deterministic,
 * so the character space it produces is byte-identical to the one the committed
 * highlight anchors were computed against — which the script asserts before
 * writing anything.
 *
 * No EPUB, no book: it prints where it looked and exits cleanly, so `db:reset`
 * still succeeds on a machine that doesn't have the file.
 *
 * Point it somewhere else with WORLD_APPEARS_EPUB=/path/to/book.epub.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/seed-world-appears.mts
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { convertBookFile } from "@/lib/reading/convert";
import {
  WORDS_PER_PAGE,
  chapterSpans,
  contentWordCount,
} from "@/lib/reading/chapter-target";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";

/** Fixed id, in the same family as the other seeded reading books. */
const BOOK_ID = "a0000003-0006-4001-8001-000000000001";
const EMAIL = "andrew@mason.io";

const LOCAL_URL = "http://127.0.0.1:54321";
/** Local Supabase's well-known service key — only ever valid against localhost. */
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const CANDIDATE_PATHS = [
  process.env.WORLD_APPEARS_EPUB,
  join(homedir(), "Downloads/eBooks/World Appears, A - Michael Pollan.epub"),
  join(homedir(), "Documents/eBooks/World Appears, A - Michael Pollan.epub"),
].filter(Boolean) as string[];

type Fixture = {
  title: string;
  author: string;
  highlights: {
    charOffset: number;
    anchor: unknown;
    quotedText: string;
    note: string | null;
    highlightedAt: string | null;
  }[];
};

function findEpub(): string | null {
  return CANDIDATE_PATHS.find((p) => existsSync(p)) ?? null;
}

/** Monday of the current week, matching the other reading seeds. */
function weekStart(): string {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day);
  return monday.toISOString().slice(0, 10);
}

async function main() {
  const epubPath = findEpub();
  if (!epubPath) {
    console.log('  skipped "A World Appears" — no local EPUB. Looked in:');
    for (const p of CANDIDATE_PATHS) console.log(`    ${p}`);
    console.log("  Set WORLD_APPEARS_EPUB to seed it.");
    return;
  }

  const db: SupabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_LOCAL_URL ?? LOCAL_URL,
    process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ?? LOCAL_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: user } = await db
    .from("family_members")
    .select("user_id")
    .eq("email", EMAIL)
    .maybeSingle();
  const userId = user?.user_id as string | undefined;
  if (!userId) {
    console.log(`  skipped "A World Appears" — no local user for ${EMAIL}.`);
    return;
  }

  const fixture = JSON.parse(
    await readFile(
      resolve("supabase/fixtures/world-appears-highlights.json"),
      "utf8"
    )
  ) as Fixture;

  const bytes = await readFile(epubPath);
  const result = await convertBookFile("epub", bytes.buffer as ArrayBuffer);

  // The committed anchors are offsets into this exact text. If the local EPUB is
  // a different edition the offsets are meaningless, and a highlight would land
  // on the wrong sentence rather than fail — so refuse instead of guessing.
  const lastHighlight = fixture.highlights[fixture.highlights.length - 1];
  if (lastHighlight.charOffset + lastHighlight.quotedText.length > result.charCount) {
    throw new Error(
      `"${epubPath}" doesn't match the highlight fixture (book is ${result.charCount} characters; ` +
        `highlights run to ${lastHighlight.charOffset + lastHighlight.quotedText.length}). Wrong edition?`
    );
  }

  const spans = chapterSpans(result.toc, result.wordCount);
  const totalPages =
    !result.hasRealPages && result.wordCount > 0 && spans.length > 0
      ? Math.ceil(contentWordCount(spans, result.wordCount) / WORDS_PER_PAGE)
      : result.pageCount;

  // Cascades to content, pages, state, check-ins and annotations.
  await db.from("reading_books").delete().eq("id", BOOK_ID);

  // Reading position sits just past the last highlight: he highlighted his way
  // to here, which is the state the reader should open in.
  const lastPage = pageForOffset(result.pages, lastHighlight.charOffset);
  const currentPage = Math.min(totalPages ?? 0, (lastPage ?? 1) + 2);
  const targetPage = totalPages ? Math.min(totalPages, currentPage + 50) : null;

  const { error: bookError } = await db.from("reading_books").insert({
    id: BOOK_ID,
    user_id: userId,
    title: fixture.title,
    author: fixture.author,
    status: "in_progress",
    total_pages: totalPages,
    current_page: currentPage,
    target_page: targetPage,
    target_due: targetPage != null ? nextFriday() : null,
    started_at: weekStart(),
    // Non-fiction, so the margin chat reads it as a case to test rather than a
    // story to protect — this is the book a local reader session actually opens,
    // which makes it the one that exercises that branch. spoiler_free agrees:
    // it's the default a positively-non-fiction book gets (see categorize.ts).
    fiction: false,
    genre: "science",
    genre_source: "ai",
    spoiler_free: false,
    cover_image_url: null,
  });
  if (bookError) throw new Error(bookError.message);

  const sourcePath = `${userId}/${BOOK_ID}/source.epub`;
  const contentPath = `${userId}/${BOOK_ID}/content.html`;

  const up1 = await db.storage
    .from(READING_BOOKS_BUCKET)
    .upload(sourcePath, bytes, {
      contentType: "application/epub+zip",
      upsert: true,
    });
  if (up1.error) throw up1.error;

  const up2 = await db.storage
    .from(READING_BOOKS_BUCKET)
    .upload(contentPath, Buffer.from(result.html, "utf8"), {
      contentType: "text/html",
      upsert: true,
    });
  if (up2.error) throw up2.error;

  const { error: contentError } = await db.from("reading_book_content").upsert(
    {
      book_id: BOOK_ID,
      user_id: userId,
      source_format: "epub",
      source_path: sourcePath,
      content_path: contentPath,
      status: "ready",
      error_message: null,
      page_count: result.pageCount,
      has_real_pages: result.hasRealPages,
      char_count: result.charCount,
      word_count: result.wordCount,
      toc: result.toc,
    },
    { onConflict: "book_id" }
  );
  if (contentError) throw new Error(contentError.message);

  if (result.pages.length > 0) {
    const rows = result.pages.map((p) => ({
      book_id: BOOK_ID,
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

  // Anchor weekly progress the way adding an active book does.
  await db.from("reading_checkins").insert({
    user_id: userId,
    book_id: BOOK_ID,
    checked_on: weekStart(),
    page: 0,
  });

  await db.from("reading_book_state").upsert(
    {
      book_id: BOOK_ID,
      user_id: userId,
      last_char_offset: lastHighlight.charOffset,
      last_page_number: currentPage,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "book_id" }
  );

  const { error: annotationError } = await db.from("reading_annotations").insert(
    fixture.highlights.map((h) => ({
      book_id: BOOK_ID,
      user_id: userId,
      anchor: h.anchor,
      anchor_char_offset: h.charOffset,
      anchor_page: pageForOffset(result.pages, h.charOffset),
      spoiler_free: false,
      context_through_page: null,
      quoted_text: h.quotedText,
      note: h.note,
      ...(h.highlightedAt ? { created_at: h.highlightedAt } : {}),
    }))
  );
  if (annotationError) throw new Error(annotationError.message);

  console.log(
    `  seeded "A World Appears" — ${totalPages} pages, on p.${currentPage}, ` +
      `${fixture.highlights.length} highlights`
  );
}

/** The page a character offset falls on, from the freshly converted page map. */
function pageForOffset(
  pages: { pageNumber: number; charStart: number }[],
  charOffset: number
): number | null {
  let best: number | null = null;
  for (const p of pages) {
    if (p.charStart <= charOffset) best = p.pageNumber;
    else break;
  }
  return best;
}

/** First Friday after today, matching how the other reading seeds set a due date. */
function nextFriday(): string {
  const d = new Date();
  d.setDate(d.getDate() + (((5 - d.getDay() + 6) % 7) + 1));
  return d.toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
