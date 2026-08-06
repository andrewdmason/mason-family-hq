/**
 * Pull the full Readwise highlight export to disk.
 *
 * Read-only: the export endpoint is the only thing this touches. Saving the raw
 * response means every later pass — matching, locating, importing — runs against
 * a fixed snapshot instead of re-hitting the API, so a re-run can't drift.
 *
 *   npx tsx --env-file=.env.local --tsconfig scripts/tsconfig.json \
 *     scripts/import-highlights/fetch.mts
 */

import { writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";

const EXPORT_URL = "https://readwise.io/api/v2/export/";

export type ReadwiseHighlight = {
  id: number;
  text: string;
  location: number | null;
  location_type: string | null;
  note: string | null;
  color: string | null;
  highlighted_at: string | null;
  created_at: string | null;
  is_deleted?: boolean;
  is_favorite?: boolean;
  tags?: { name: string }[];
};

export type ReadwiseBook = {
  user_book_id: number;
  title: string;
  author: string | null;
  readable_title: string | null;
  source: string | null;
  category: string | null;
  asin: string | null;
  cover_image_url: string | null;
  readwise_url: string | null;
  highlights: ReadwiseHighlight[];
};

async function main() {
  const token = process.env.READWISE_TOKEN;
  if (!token) throw new Error("READWISE_TOKEN is required (put it in .env.local).");

  const books: ReadwiseBook[] = [];
  let cursor: string | null = null;
  let page = 0;

  for (;;) {
    const url = new URL(EXPORT_URL);
    if (cursor) url.searchParams.set("pageCursor", cursor);

    const res = await fetch(url, { headers: { Authorization: `Token ${token}` } });

    // Readwise throttles hard on large libraries and says how long to wait.
    if (res.status === 429) {
      const wait = Number(res.headers.get("Retry-After") ?? 30);
      console.log(`  rate limited, waiting ${wait}s…`);
      await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Readwise returned ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as {
      results: ReadwiseBook[];
      nextPageCursor: string | null;
    };
    books.push(...data.results);
    page++;
    console.log(
      `  page ${page}: ${data.results.length} books, ${books.length} total`
    );

    cursor = data.nextPageCursor;
    if (!cursor) break;
  }

  const outDir = resolve(".context");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "readwise-export.json"),
    JSON.stringify({ books }, null, 2)
  );

  const highlights = books.reduce((n, b) => n + b.highlights.length, 0);
  const byCategory = new Map<string, number>();
  for (const b of books) {
    byCategory.set(b.category ?? "unknown", (byCategory.get(b.category ?? "unknown") ?? 0) + 1);
  }

  console.log(`\n${books.length} sources, ${highlights} highlights`);
  for (const [cat, n] of [...byCategory].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${n}`);
  }
  console.log(`\nSaved → .context/readwise-export.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
