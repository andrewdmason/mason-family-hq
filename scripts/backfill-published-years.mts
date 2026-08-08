/**
 * Fill in the publication year on books that arrived without one.
 *
 * The column has existed since 00085, but only two of the six ways a book gets
 * onto a shelf ever set it: the Open Library typeahead and the bulk Calibre
 * import. Everything typed in by hand, handed over by a family member, or taken
 * from a recommendation landed with the year blank — about a third of the shelf.
 * Now that the queue and the recommendation card print the year next to the
 * author, those books read as though nobody knows when they came out.
 *
 * Resolution asks the same classifier every add path now runs, and falls back to
 * Open Library for books it doesn't recognise. That order is measured, not
 * assumed: on eighteen books with hand-checked dates the model got eighteen
 * right, while the catalogue's `first_publish_year` got seven — it reports the
 * earliest edition record it holds, so Klara and the Sun comes back 2019 and The
 * Alchemist 2010.
 *
 * Which is also why --force exists. The years already on the shelf came from
 * that same catalogue, or from an ebook file's own dc:date (the printing you
 * downloaded, not the book's first appearance), so plenty of them are wrong in
 * exactly this way. --force re-dates every book, not just the blank ones; the
 * dry run shows each change before you commit to it.
 *
 * Idempotent and safe to interrupt: a book neither pass recognises is left alone
 * for a later run. Articles are skipped — a saved web page has a date, not an era.
 *
 * Defaults to a dry run. Reads the service key from .env.local (gitignored)
 * rather than the command line, so it stays out of shell history:
 *
 *   npx tsx --env-file=.env.local --tsconfig scripts/tsconfig.json \
 *     scripts/backfill-published-years.mts [--email andrew@mason.io] [--write] [--limit N] [--force]
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyBook } from "@/lib/reading/classify-book";
import { metaFromSearch } from "@/lib/reading/book-lookup";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const WRITE = flag("write");
const FORCE = flag("force");
const LIMIT = Number(arg("limit") ?? "0") || null;

/** How many books to resolve at once. Politeness to Open Library, not a limit. */
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
  published_year: number | null;
};

type Resolved = { year: number | null; via: "ai" | "catalogue" | null };

/** The classifier first, the catalogue only for books it doesn't recognise. */
async function resolveYear(row: Row): Promise<Resolved> {
  const classified = await classifyBook(row.title, row.author);
  if (classified.publishedYear) {
    return { year: classified.publishedYear, via: "ai" };
  }
  const fromCatalogue = (await metaFromSearch(row.title, row.author))
    .publishedYear;
  return fromCatalogue
    ? { year: fromCatalogue, via: "catalogue" }
    : { year: null, via: null };
}

async function main() {
  const db = client();
  const email = arg("email");

  let query = db
    .from("reading_books")
    .select("id, title, author, published_year")
    .eq("type", "book")
    .order("title");

  // Without --force this is a fill-the-blanks pass and nothing already dated is
  // touched; with it, every book is re-dated from the better source.
  if (!FORCE) query = query.is("published_year", null);

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

  console.log(
    `${rows.length} book(s) to date` +
      (FORCE ? " (--force: re-dating books that already have a year)" : "") +
      "." +
      (WRITE ? "" : " DRY RUN — pass --write to apply.")
  );

  const batch = LIMIT ? rows.slice(0, LIMIT) : rows;
  let updated = 0;
  let unchanged = 0;
  let unknown = 0;
  const skipped: string[] = [];

  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const slice = batch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async (row) => ({ row, resolved: await resolveYear(row) }))
    );

    for (const { row, resolved } of results) {
      const name = row.author ? `${row.title} — ${row.author}` : row.title;
      if (resolved.year == null) {
        unknown++;
        console.log(`  --   ${name} — no year found, left as is`);
        continue;
      }
      if (resolved.year === row.published_year) {
        unchanged++;
        continue;
      }

      // On a re-date, the old year is the interesting half of the line.
      const change =
        row.published_year == null
          ? `${resolved.year}`
          : `${row.published_year} -> ${resolved.year}`;
      console.log(`  ${WRITE ? "->" : "  "}   ${name} — ${change} (${resolved.via})`);

      if (WRITE) {
        // Only write if the year still reads what it did when this book was
        // picked up, so a hand edit landing mid-run wins over this pass.
        const write = db
          .from("reading_books")
          .update({ published_year: resolved.year })
          .eq("id", row.id);
        const { error: writeError } = await (row.published_year == null
          ? write.is("published_year", null)
          : write.eq("published_year", row.published_year));
        if (writeError) {
          skipped.push(`${name} — write failed (${writeError.message})`);
          continue;
        }
      }
      updated++;
    }
  }

  console.log(
    `\n${updated} book(s) ${WRITE ? "dated" : "would be dated"}, ` +
      `${unchanged} already right, ${unknown} not found, ${skipped.length} skipped.`
  );
  for (const s of skipped) console.log(`  skipped: ${s}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
