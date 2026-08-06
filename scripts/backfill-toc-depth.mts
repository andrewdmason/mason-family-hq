/**
 * Teach books already on the shelf how they nest.
 *
 * A book's contents is read from its EPUB nav at conversion time, and until now
 * the nesting in that nav was thrown away — so every book converted before this
 * has a flat contents and no way to know its chapters have sections in them. The
 * fix is to re-read the nav. The nav is inside the source EPUB, which is still in
 * storage, so this re-runs the conversion and keeps ONLY the depths.
 *
 * WHY THIS IS SAFE, AND THE CHECK THAT MAKES IT SO
 *
 * The contents is not a sidecar. Each of its entries corresponds to a heading
 * printed into the converted HTML, and those headings occupy character positions
 * that every highlight, every chat, every chapter summary and the whole page map
 * are anchored to. Rewriting the HTML would move all of them silently, in books
 * that have been read and marked up.
 *
 * So the HTML is never touched. And before a single depth is written, the
 * regenerated contents is compared to the stored one entry by entry: same count,
 * same anchor ids, same titles, same word offsets, same levels. Only when the two
 * are identical in every respect EXCEPT the new field is the book written. A book
 * that fails is skipped and reported, never partially updated — `anchorId` is the
 * only durable name a chapter has, and it is what chapter summaries are keyed on.
 *
 * Idempotent, and safe to interrupt and re-run: a book already carrying depths is
 * skipped unless --force.
 *
 * Defaults to a dry run. Reads the service key from .env.local (gitignored)
 * rather than the command line, so it stays out of shell history:
 *
 *   npx tsx --env-file=.env.local --tsconfig scripts/tsconfig.json \
 *     scripts/backfill-toc-depth.mts [--email andrew@mason.io] [--write] [--limit N] [--force]
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { convertBookFile } from "@/lib/reading/convert";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import type { ReadingTocEntry } from "@/lib/types";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const WRITE = flag("write");
const FORCE = flag("force");
const LIMIT = Number(arg("limit") ?? "0") || null;

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

/**
 * Everything about an entry that is NOT the new field, as one comparable string.
 *
 * If any of this differs between the stored contents and a fresh conversion, the
 * conversion is not reproducing the book that was stored — a different converter,
 * a different source file — and its depths describe a contents this reader has
 * never seen. Every one of these is load-bearing somewhere: anchorId is what a
 * chapter summary is keyed on, startWord is what a weekly goal snaps to, level is
 * what decides which entries count as chapters at all.
 *
 * JSON rather than joined-up fields, because a chapter can be called anything
 * at all — including whatever separator seemed safe — and two different
 * contents that happen to concatenate to the same string would read as a
 * match. It also keeps this file plain text, which control characters as
 * separators did not: git read them as binary and refused to show the diff.
 */
function fingerprint(toc: ReadingTocEntry[]): string {
  return JSON.stringify(
    toc.map((e) => [e.anchorId, e.title, e.level, e.startWord ?? null])
  );
}

type Row = {
  book_id: string;
  user_id: string;
  source_format: string;
  source_path: string;
  toc: ReadingTocEntry[] | null;
};

async function main() {
  const db = client();
  const email = arg("email");

  let query = db
    .from("reading_book_content")
    .select("book_id, user_id, source_format, source_path, toc")
    .eq("status", "ready")
    .eq("source_format", "epub");

  if (email) {
    const { data: member, error } = await db
      .from("family_members")
      .select("user_id")
      .eq("email", email)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!member?.user_id) throw new Error(`No family member for ${email}.`);
    query = query.eq("user_id", member.user_id as string);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Row[];
  // Titles are only for the log, and are a separate table — one query rather
  // than one per book.
  const { data: books } = await db
    .from("reading_books")
    .select("id, title")
    .in(
      "id",
      rows.map((r) => r.book_id)
    );
  const titleOf = new Map((books ?? []).map((b) => [b.id as string, b.title as string]));

  const todo = rows.filter((r) => {
    const toc = r.toc ?? [];
    if (toc.length === 0) return false;
    const already = toc.some((e) => typeof e.depth === "number" && e.depth > 0);
    return FORCE || !already;
  });

  console.log(
    `${rows.length} converted EPUB(s); ${todo.length} without nesting.` +
      (WRITE ? "" : " DRY RUN — pass --write to apply.")
  );

  let updated = 0;
  let unchanged = 0;
  const skipped: string[] = [];

  for (const row of LIMIT ? todo.slice(0, LIMIT) : todo) {
    const title = titleOf.get(row.book_id) ?? row.book_id;

    const file = await db.storage.from(READING_BOOKS_BUCKET).download(row.source_path);
    if (file.error || !file.data) {
      skipped.push(`${title} — source file unreadable (${file.error?.message})`);
      continue;
    }

    let fresh;
    try {
      fresh = await convertBookFile("epub", await file.data.arrayBuffer());
    } catch (e) {
      skipped.push(`${title} — reconversion failed (${(e as Error).message})`);
      continue;
    }

    const stored = row.toc ?? [];
    if (fingerprint(fresh.toc) !== fingerprint(stored)) {
      skipped.push(
        `${title} — a fresh conversion doesn't match the stored contents ` +
          `(${stored.length} entries stored, ${fresh.toc.length} regenerated)`
      );
      continue;
    }

    const depths = fresh.toc.map((e) => e.depth);
    if (depths.every((d) => d == null)) {
      unchanged++;
      console.log(`  --   ${title} — its nav records no nesting`);
      continue;
    }

    // Merge onto the STORED entries, not the fresh ones. The fingerprint proves
    // the two agree on every field that exists in both, but the stored rows are
    // what the reader has been using, and copying only the new field across keeps
    // that true even if a future conversion starts emitting something extra.
    const merged = stored.map((e, i) =>
      depths[i] != null ? { ...e, depth: depths[i] } : e
    );

    const deepest = Math.max(...depths.filter((d): d is number => d != null));
    console.log(
      `  ${WRITE ? "->" : "  "}   ${title} — ${merged.length} entries, ${deepest} level(s)`
    );

    if (WRITE) {
      const { error: writeError } = await db
        .from("reading_book_content")
        .update({ toc: merged })
        .eq("book_id", row.book_id);
      if (writeError) {
        skipped.push(`${title} — write failed (${writeError.message})`);
        continue;
      }
    }
    updated++;
  }

  console.log(
    `\n${updated} book(s) ${WRITE ? "updated" : "would be updated"}, ` +
      `${unchanged} with nothing to nest, ${skipped.length} skipped.`
  );
  for (const s of skipped) console.log(`  skipped: ${s}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
