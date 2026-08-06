/**
 * Prove every imported highlight resolves to the text it claims.
 *
 * Reads the stored anchors back out of production and re-derives, from the
 * book's own converted HTML, what the reader will show at that block and offset.
 * If that text isn't the highlight's text, the mark is in the wrong place — the
 * one failure mode that is invisible until you open the book and see a stripe
 * across the wrong sentence.
 *
 * Pass --local to check the seeded copy in the local database instead.
 *
 *   npx tsx --env-file=.env.local --tsconfig scripts/tsconfig.json \
 *     scripts/import-highlights/verify-anchors.mts [--local]
 */

import { createClient } from "@supabase/supabase-js";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import { buildIndex, normalizeQuery, type BookIndex } from "./locate";

/** Local Supabase's well-known service key — only valid against localhost. */
const LOCAL_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

async function main() {
  const local = process.argv.includes("--local");
  const db = local
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_LOCAL_URL ?? "http://127.0.0.1:54321",
        LOCAL_SERVICE_KEY,
        { auth: { autoRefreshToken: false, persistSession: false } }
      )
    : createClient(
        process.env.NEXT_PUBLIC_SUPABASE_PROD_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
  console.log(local ? "Checking local database…" : "Checking production…");

  const { data: rows, error } = await db
    .from("reading_annotations")
    .select(
      "id, book_id, anchor, anchor_char_offset, quoted_text, reading_books!inner(title, type)"
    )
    .eq("reading_books.type", "book")
    .not("quoted_text", "is", null);
  if (error) throw new Error(error.message);

  const indexes = new Map<string, BookIndex | null>();
  let ok = 0;
  let bad = 0;
  const failures: string[] = [];

  for (const row of rows ?? []) {
    const title = (row.reading_books as unknown as { title: string }).title;
    let index = indexes.get(row.book_id as string);
    if (index === undefined) {
      const { data: content } = await db
        .from("reading_book_content")
        .select("content_path")
        .eq("book_id", row.book_id as string)
        .maybeSingle();
      const path = content?.content_path as string | null;
      const dl = path
        ? await db.storage.from(READING_BOOKS_BUCKET).download(path)
        : null;
      index = dl?.data ? buildIndex(await dl.data.text()) : null;
      indexes.set(row.book_id as string, index);
    }
    if (!index) continue;

    const anchor = row.anchor as {
      blockIndex: number;
      startOffset: number | null;
      kind: string;
    };
    const quoted = row.quoted_text as string;
    const block = index.blocks[anchor.blockIndex];

    if (!block) {
      bad++;
      failures.push(`${title}: block ${anchor.blockIndex} doesn't exist`);
      continue;
    }

    // Two independent claims: the block+offset, and the flat char offset. Both
    // must name the same character, and that character must begin the quote.
    const viaBlock = block.charStart + (anchor.startOffset ?? 0);
    if (viaBlock !== row.anchor_char_offset) {
      bad++;
      failures.push(
        `${title}: block says char ${viaBlock}, row says ${row.anchor_char_offset}`
      );
      continue;
    }

    const atOffset = index.text.slice(
      viaBlock,
      viaBlock + Math.max(quoted.length + 8, 24)
    );
    const wanted = normalizeQuery(quoted);
    const found = normalizeQuery(atOffset);
    // A prefix comparison: the stored quote is the leading run of what's there.
    if (found.startsWith(wanted.slice(0, Math.min(wanted.length, 60)))) ok++;
    else {
      bad++;
      failures.push(
        `${title}: at char ${viaBlock} the book reads "${found.slice(0, 60)}" but the highlight says "${wanted.slice(0, 60)}"`
      );
    }
  }

  console.log(`${ok} highlights resolve to exactly the right text.`);
  if (bad) {
    console.log(`\n${bad} do NOT:`);
    for (const f of failures.slice(0, 15)) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
