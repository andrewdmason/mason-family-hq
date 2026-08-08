/**
 * Classify every book already on the shelf: fiction or not, and one genre.
 *
 * Both columns arrived empty (00177), and the flag the reader chat had been
 * treating as "is this a story" — spoiler_free — turned out to track how a book
 * was added rather than what it is. Everything added before 00166 inherited the
 * column's `false` default, so every Steinbeck and Ishiguro read as non-fiction;
 * everything from the bulk Calibre import came in `true`, so Thinking, Fast and
 * Slow read as a novel. This run replaces that with a real answer and brings
 * spoiler_free back into agreement with it.
 *
 * Rewriting spoiler_free is safe: every chat FREEZES its own boundary at creation
 * (see 00166), so the book-level switch only ever decides what a NEW chat gets.
 * No existing conversation shifts under the reader.
 *
 * It is not simply set to `fiction`. Unknown stays protected, because the harm is
 * asymmetric — a spoiled novel can't be un-spoiled, an over-narrow non-fiction
 * chat is one toggle away. Only a positive "this is non-fiction" opens a book up.
 *
 * Uses the same classifier the app runs after every add, so there is one prompt
 * and one taxonomy rather than a second copy that drifts.
 *
 * Idempotent, and safe to interrupt and re-run: a book that already has a genre
 * is skipped unless --force, and a genre the reader set by hand
 * (genre_source = 'manual') is never overwritten, --force or not.
 *
 * Articles are skipped — "is this fiction" isn't a meaningful question about a
 * saved web page.
 *
 * Defaults to a dry run. Reads the service key from .env.local (gitignored)
 * rather than the command line, so it stays out of shell history:
 *
 *   npx tsx --env-file=.env.local --tsconfig scripts/tsconfig.json \
 *     scripts/backfill-book-categories.mts [--email andrew@mason.io] [--write] [--limit N] [--force]
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyBook } from "@/lib/reading/classify-book";
import { categoryWrite, spoilerDefaultFor } from "@/lib/reading/categorize";
import { genreLabel } from "@/lib/reading/book-genres";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const WRITE = flag("write");
const FORCE = flag("force");
const LIMIT = Number(arg("limit") ?? "0") || null;

/** How many books to classify at once. Politeness, not a rate limit. */
const CONCURRENCY = 4;

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

type Row = {
  id: string;
  title: string;
  author: string | null;
  genre: string | null;
  genre_source: string | null;
  fiction: boolean | null;
  spoiler_free: boolean;
};

/** How a verdict reads in the log — the whole point of the dry run. */
function describe(fiction: boolean | null, genre: string | null): string {
  const side =
    fiction === true ? "fiction" : fiction === false ? "non-fiction" : "unclear";
  return `${side}, ${genre ? genreLabel(genre) : "no genre"}`;
}

async function main() {
  const db = client();
  const email = arg("email");

  let query = db
    .from("reading_books")
    .select("id, title, author, genre, genre_source, fiction, spoiler_free")
    .eq("type", "book")
    .order("title");

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

  const handEdited = rows.filter((r) => r.genre_source === "manual");
  const todo = rows.filter((r) => {
    // A hand correction outranks the classifier, always. Skipping these is what
    // makes a re-run non-destructive.
    if (r.genre_source === "manual") return false;
    if (FORCE) return true;
    return r.genre == null || r.fiction == null;
  });

  console.log(
    `${rows.length} book(s); ${todo.length} to classify` +
      (handEdited.length ? `, ${handEdited.length} hand-edited (left alone)` : "") +
      "." +
      (WRITE ? "" : " DRY RUN — pass --write to apply.")
  );

  const batch = LIMIT ? todo.slice(0, LIMIT) : todo;
  let updated = 0;
  let unknown = 0;
  let spoilerFixed = 0;
  const skipped: string[] = [];

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const slice = batch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (row) => ({
        row,
        result: await classifyBook(row.title, row.author),
      }))
    );

    for (const { row, result } of results) {
      const name = row.author ? `${row.title} — ${row.author}` : row.title;

      if (result.fiction == null && result.genre == null) {
        unknown++;
        console.log(`  --   ${name} — not recognised, left blank`);
        continue;
      }

      const patch = categoryWrite(result);
      const spoilerChanges = row.spoiler_free !== patch.spoiler_free;
      if (spoilerChanges) spoilerFixed++;

      console.log(
        `  ${WRITE ? "->" : "  "}   ${name} — ${describe(result.fiction, result.genre)}` +
          (spoilerChanges
            ? `  [spoiler switch ${row.spoiler_free} -> ${patch.spoiler_free}]`
            : "")
      );

      if (WRITE) {
        // Only write if genre_source still reads what it did when we picked this
        // book up, so a hand edit landing mid-run wins. Written as an equality on
        // the observed value rather than `.neq("genre_source", "manual")`, which
        // would match nothing at all: the column is null on every unclassified
        // book, and `null <> 'manual'` is null, not true. `.or()` isn't an option
        // either — PostgREST rejects it on an UPDATE with a misleading 42703.
        const write = db.from("reading_books").update(patch).eq("id", row.id);
        const { error: writeError } = await (row.genre_source == null
          ? write.is("genre_source", null)
          : write.eq("genre_source", row.genre_source));
        if (writeError) {
          skipped.push(`${name} — write failed (${writeError.message})`);
          continue;
        }
      }
      updated++;
    }
  }

  console.log(
    `\n${updated} book(s) ${WRITE ? "classified" : "would be classified"}, ` +
      `${spoilerFixed} spoiler switch(es) corrected, ` +
      `${unknown} not recognised, ${skipped.length} skipped.`
  );
  for (const s of skipped) console.log(`  skipped: ${s}`);

  // The unknowns are the useful output of a dry run: they're what a hand edit is
  // for, and they're the books the classifier will keep re-trying on every run.
  if (unknown > 0) {
    console.log(
      `\nThe ${unknown} unrecognised book(s) keep null columns on purpose, so a ` +
        `later run can try again. Their spoiler switch is unchanged: ` +
        `${spoilerDefaultFor(null) ? "protected" : "open"} is the safe default.`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
