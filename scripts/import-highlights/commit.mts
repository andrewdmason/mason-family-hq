/**
 * Write the planned Kindle highlights into the Reader as annotations.
 *
 * WRITES TO PRODUCTION. Each row is built to be indistinguishable from a
 * highlight made by hand in the reader: same anchor shape, same page resolution,
 * same spoiler-free treatment. A Kindle note rides along in the note field,
 * which is exactly what the reader's own "Note" action writes.
 *
 * Idempotent: a highlight already present at the same place in the same book is
 * skipped, so a re-run after a partial failure adds only what's missing.
 *
 *   npx tsx --env-file=.env.local --tsconfig scripts/tsconfig.json \
 *     scripts/import-highlights/commit.mts [--only "<title>"] [--limit N]
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PlannedBook } from "./plan.mts";

const EMAIL = "andrew@mason.io";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** The page a character offset falls on — mirrors the reader's own lookup. */
async function pageForCharOffset(
  db: SupabaseClient,
  userId: string,
  bookId: string,
  charOffset: number
): Promise<number | null> {
  const { data } = await db
    .from("reading_book_pages")
    .select("page_number")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .lte("char_start", charOffset)
    .order("page_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.page_number as number | undefined) ?? null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_PROD_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  if (url.includes("127.0.0.1") || url.includes("localhost")) {
    throw new Error(`Refusing to run: ${url} is not production.`);
  }
  const db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: member } = await db
    .from("family_members")
    .select("user_id")
    .eq("email", EMAIL)
    .maybeSingle();
  const userId = member?.user_id as string;
  if (!userId) throw new Error(`No user for ${EMAIL}.`);

  const { books } = JSON.parse(
    await readFile(resolve(".context/highlight-plan.json"), "utf8")
  ) as { books: PlannedBook[] };

  const only = arg("only");
  const limit = arg("limit") ? Number(arg("limit")) : Infinity;
  const todo = books
    .filter((b) => b.state === "importable" && b.bookId)
    .filter((b) =>
      only ? (b.libraryTitle ?? "").toLowerCase().includes(only.toLowerCase()) : true
    )
    .slice(0, limit);

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const book of todo) {
    // Whatever is already anchored in this book, so a re-run adds only new marks.
    const { data: existing } = await db
      .from("reading_annotations")
      .select("anchor_char_offset, quoted_text")
      .eq("book_id", book.bookId!)
      .eq("user_id", userId);
    const seen = new Set(
      (existing ?? []).map(
        (e) => `${e.anchor_char_offset}|${(e.quoted_text ?? "").slice(0, 60)}`
      )
    );

    const { data: bookRow } = await db
      .from("reading_books")
      .select("spoiler_free")
      .eq("id", book.bookId!)
      .eq("user_id", userId)
      .maybeSingle();
    const bookSpoilerFree = bookRow?.spoiler_free === true;

    let bookInserted = 0;
    for (const h of book.highlights) {
      if (!h.anchor || h.charOffset == null || !h.quotedText) continue;
      const dedupeKey = `${h.charOffset}|${h.quotedText.slice(0, 60)}`;
      if (seen.has(dedupeKey)) {
        skipped++;
        continue;
      }

      const anchorPage = await pageForCharOffset(
        db,
        userId,
        book.bookId!,
        h.charOffset
      );

      const { error } = await db.from("reading_annotations").insert({
        book_id: book.bookId,
        user_id: userId,
        anchor: h.anchor,
        anchor_char_offset: h.charOffset,
        anchor_page: anchorPage,
        spoiler_free: bookSpoilerFree,
        context_through_page: bookSpoilerFree ? anchorPage : null,
        quoted_text: h.quotedText,
        note: h.note,
        // Preserve when it was actually highlighted, so the margin reads in the
        // order these were made rather than the order they were imported.
        ...(h.highlightedAt ? { created_at: h.highlightedAt } : {}),
      });

      if (error) {
        failed++;
        console.error(`  ✗ ${book.libraryTitle}: ${error.message}`);
      } else {
        inserted++;
        bookInserted++;
        seen.add(dedupeKey);
      }
    }

    console.log(
      `  ${book.libraryTitle}: +${bookInserted}` +
        (bookInserted < book.located ? ` (${book.located - bookInserted} already there)` : "")
    );
  }

  console.log(`\nDone. ${inserted} highlights added, ${skipped} already present, ${failed} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
