/**
 * Proves the highlight matcher against a real converted book.
 *
 * Pulls passages straight out of a book already in the library, mangles them the
 * way Amazon does — curly quotes, ellipses, collapsed whitespace, a clipped word
 * at either end — and checks the matcher puts them back exactly where they came
 * from. Anything less than an exact recovery of the original span is a failure,
 * because a highlight landing one character off is a highlight in the wrong
 * place forever.
 *
 *   npx tsx --env-file=.env.local --tsconfig scripts/tsconfig.json \
 *     scripts/import-highlights/verify-locate.mts [--book "<title fragment>"]
 */

import { createClient } from "@supabase/supabase-js";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import { buildIndex, locate, buildAnchor } from "./locate";

const SAMPLES_PER_BOOK = 60;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** Deterministic PRNG so a failure is reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The distortions a highlight picks up on the round trip through Amazon. */
const MANGLERS: { name: string; apply: (s: string) => string }[] = [
  { name: "verbatim", apply: (s) => s },
  {
    name: "curly quotes",
    apply: (s) => s.replace(/'/g, "’").replace(/"/g, "“"),
  },
  { name: "straightened", apply: (s) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"') },
  { name: "em dashes", apply: (s) => s.replace(/-/g, "—") },
  { name: "collapsed space", apply: (s) => s.replace(/\s+/g, " ") },
  { name: "nbsp", apply: (s) => s.replace(/ /g, " ") },
  { name: "ellipsis", apply: (s) => s.replace(/\.\.\./g, "…") },
  { name: "clipped ends", apply: (s) => s.replace(/^\S+\s/, "").replace(/\s\S+$/, "") },
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_PROD_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  const db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const titleFilter = arg("book");
  // Books only. An article's char_count is the length of its HTML rather than
  // its text, so it doesn't share the char space highlights are anchored in.
  let q = db
    .from("reading_book_content")
    .select("book_id, content_path, char_count, reading_books!inner(title, type)")
    .eq("status", "ready")
    .eq("reading_books.type", "book")
    .limit(titleFilter ? 3 : 6);
  if (titleFilter) q = q.ilike("reading_books.title", `%${titleFilter}%`);

  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  if (!rows?.length) throw new Error("No ready books found.");

  let totalOk = 0;
  let totalTried = 0;
  const failures: string[] = [];

  for (const row of rows) {
    const title = (row.reading_books as unknown as { title: string }).title;
    const dl = await db.storage
      .from(READING_BOOKS_BUCKET)
      .download(row.content_path as string);
    if (dl.error || !dl.data) {
      console.log(`  ?? ${title}: could not download content`);
      continue;
    }
    const index = buildIndex(await dl.data.text());

    // Sanity: the reconstructed char space must match what conversion recorded.
    if (index.text.length !== (row.char_count as number)) {
      failures.push(
        `${title}: char space is ${index.text.length}, database says ${row.char_count}`
      );
    }

    const random = rng(12345);
    let ok = 0;
    let tried = 0;

    for (let i = 0; i < SAMPLES_PER_BOOK; i++) {
      // Pick a real span out of a real paragraph.
      const block = index.blocks[Math.floor(random() * index.blocks.length)];
      if (!block || block.text.length < 80) continue;
      const len = 40 + Math.floor(random() * Math.min(200, block.text.length - 40));
      const offsetInBlock = Math.floor(random() * (block.text.length - len));
      const rawStart = block.charStart + offsetInBlock;
      const raw = index.text.slice(rawStart, rawStart + len);
      // A highlight is words, not whitespace: slicing at an arbitrary character
      // can catch a leading or trailing space that no real selection would carry,
      // so the span we expect back is the trimmed one.
      const lead = raw.length - raw.trimStart().length;
      const original = raw.trim();
      if (original.length < 32) continue;
      const start = rawStart + lead;
      const end = start + original.length;

      const mangler = MANGLERS[i % MANGLERS.length];
      const highlight = mangler.apply(original);

      tried++;
      const found = locate(index, highlight);
      if (!found) {
        failures.push(`${title} [${mangler.name}]: no match for "${short(original)}"`);
        continue;
      }

      // "clipped ends" deliberately removes words, so its span is legitimately
      // narrower; everything else must land on the exact original range.
      const exactExpected = mangler.name !== "clipped ends";
      const landedRight = exactExpected
        ? found.start === start && found.end === end
        : found.start >= start && found.end <= end;

      const anchor = buildAnchor(index, found);
      if (!anchor) {
        failures.push(`${title} [${mangler.name}]: no anchor for "${short(original)}"`);
        continue;
      }
      // The anchor must round-trip: block + offset has to name the same place.
      const viaBlock =
        index.blocks[anchor.anchor.blockIndex].charStart +
        (anchor.anchor.startOffset ?? 0);
      const anchorAgrees = viaBlock === anchor.anchorCharOffset;

      if (landedRight && anchorAgrees) ok++;
      else {
        failures.push(
          `${title} [${mangler.name}]: wanted ${start}-${end}, got ${found.start}-${found.end}` +
            (anchorAgrees ? "" : " (anchor disagrees with its own block)")
        );
      }
    }

    totalOk += ok;
    totalTried += tried;
    console.log(`  ${ok === tried ? "ok  " : "FAIL"} ${title}: ${ok}/${tried}`);
  }

  console.log(`\n${totalOk}/${totalTried} passages recovered exactly.`);
  if (failures.length) {
    console.log(`\nFirst failures:`);
    for (const f of failures.slice(0, 12)) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("Matcher verified.");
}

function short(s: string): string {
  return s.length > 48 ? `${s.slice(0, 48)}…` : s;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
