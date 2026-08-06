/**
 * One-time eBook library import — scan pass.
 *
 * Reads a Calibre export folder, works out what each book would become in the
 * Reader, and writes a manifest plus a human-readable report. Touches nothing:
 * no network writes, no database, no storage. The point is to see every
 * decision — and every failure — before anything lands in production.
 *
 * The expensive part is running each EPUB through the real converter, which is
 * exactly what makes the dry run worth doing: a book that fails here would have
 * failed on the site too, and now it fails on a laptop instead of in prod.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/import-ebooks/scan.mts \
 *     --dir ~/Downloads/eBooks [--existing <books.json>] [--limit N] [--only <substr>]
 */

import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { convertBookFile, ConversionError } from "@/lib/reading/convert";
import {
  WORDS_PER_PAGE,
  chapterSpans,
  contentWordCount,
} from "@/lib/reading/chapter-target";
import {
  readOpf,
  cleanTitle,
  looksSentenceCased,
  sameButForArticle,
  primaryAuthor,
  looksMiscased,
  type OpfMetadata,
} from "./opf";
import { matchOpenLibrary } from "./match";
import { shrinkCoverFile, shrinkCoverDataUrl } from "./cover";
import type { ExistingBook, ScannedBook } from "./types";

/** Supabase caps the books bucket at 100MB; anything larger can't be stored. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** How many books to convert at once. Conversion is CPU- and memory-hungry. */
const CONCURRENCY = 3;

function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** Group a flat Calibre export into one entry per book, keyed by filename stem. */
async function groupByStem(dir: string) {
  const names = await readdir(dir);
  const stems = new Map<string, Map<string, string>>();
  for (const name of names) {
    const ext = extname(name).toLowerCase();
    if (![".epub", ".opf", ".jpg", ".jpeg", ".kfx"].includes(ext)) continue;
    const stem = basename(name, extname(name));
    if (!stems.has(stem)) stems.set(stem, new Map());
    stems.get(stem)!.set(ext === ".jpeg" ? ".jpg" : ext, join(dir, name));
  }
  return stems;
}

/** Title+author key for spotting a book already in the library. */
function dupeKey(title: string, author: string | null): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/^(the|a|an) /, "")
      .trim();
  const surname = author ? norm(author).split(" ").pop() : "";
  return `${norm(title)}|${surname ?? ""}`;
}

async function run() {
  const dir = resolve(expandHome(arg("dir") ?? "~/Downloads/eBooks"));
  const existingPath = arg("existing");
  const limit = arg("limit") ? Number(arg("limit")) : Infinity;
  const only = arg("only");

  const existing: ExistingBook[] = existingPath
    ? JSON.parse(await readFile(expandHome(existingPath), "utf8"))
    : [];
  const existingByKey = new Map<string, ExistingBook>();
  for (const b of existing) existingByKey.set(dupeKey(b.title, b.author), b);

  const stems = await groupByStem(dir);
  const entries = [...stems.entries()]
    .filter(([, files]) => files.has(".opf") || files.has(".epub"))
    .filter(([stem]) => (only ? stem.toLowerCase().includes(only.toLowerCase()) : true))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, limit);

  console.log(`Scanning ${entries.length} books in ${dir}\n`);

  const results: ScannedBook[] = [];
  let done = 0;

  const worker = async (queue: [string, Map<string, string>][]) => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [stem, files] = next;
      const book = await scanOne(stem, files, existingByKey);
      results.push(book);
      done++;
      const flag = book.action === "skip" ? "SKIP" : book.action === "attach" ? "ATCH" : " ok ";
      console.log(
        `[${String(done).padStart(3)}/${entries.length}] ${flag}  ${book.title}` +
          (book.notes.length ? `  — ${book.notes[0]}` : "")
      );
    }
  };

  const queue = [...entries];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, () => worker(queue))
  );

  results.sort((a, b) => a.title.localeCompare(b.title));

  const outDir = resolve(".context");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "ebook-import-manifest.json"),
    JSON.stringify({ dir, scannedAt: null, books: results }, null, 2)
  );
  await writeFile(join(outDir, "ebook-import-report.md"), report(results, dir));

  console.log(`\nManifest → .context/ebook-import-manifest.json`);
  console.log(`Report   → .context/ebook-import-report.md`);
  console.log(summary(results));
}

async function scanOne(
  stem: string,
  files: Map<string, string>,
  existingByKey: Map<string, ExistingBook>
): Promise<ScannedBook> {
  const notes: string[] = [];
  const opfPath = files.get(".opf");
  const epubPath = files.get(".epub") ?? null;
  const jpgPath = files.get(".jpg") ?? null;

  const opf: OpfMetadata = opfPath
    ? await readOpf(opfPath)
    : { title: null, author: null, year: null, publisher: null, asin: null };

  // Fall back to the filename ("Title, The - Author") when there's no .opf.
  let rawTitle = opf.title;
  let rawAuthor = primaryAuthor(opf.author);
  if (!rawTitle) {
    const dash = stem.lastIndexOf(" - ");
    rawTitle = dash > 0 ? stem.slice(0, dash) : stem;
    rawAuthor = rawAuthor ?? primaryAuthor(dash > 0 ? stem.slice(dash + 3) : null);
    // Undo Calibre's "Book, The" sort form and its stand-in for a colon.
    rawTitle = rawTitle.replace(/^(.*), (The|A|An)$/i, "$2 $1").replace(/_\s*/g, ": ");
    notes.push("no .opf — metadata read from the filename");
  }

  const { title: fullTitle, short } = cleanTitle(rawTitle);
  const { match, score, via } = await matchOpenLibrary(fullTitle, short, rawAuthor);

  // Trust Open Library for identity (cover, ISBN, key) but not for presentation.
  // Its records are inconsistently cased, sometimes drop the leading article,
  // and sometimes name the wrong person of the same surname (Dune is filed under
  // the son, not the father). Calibre's metadata came off the actual purchase,
  // so it wins wherever it has an opinion.
  const local = short || fullTitle;
  const title =
    match &&
    !looksSentenceCased(match.title) &&
    !sameButForArticle(match.title, local) &&
    match.title.toLowerCase() !== local.toLowerCase()
      ? match.title
      : local;
  // Calibre normally wins, but not when its copy of the name got case-mangled
  // ("Gabriel GarcÍA MÁRquez") — then Open Library's spelling is the good one.
  const author =
    rawAuthor && !(looksMiscased(rawAuthor) && match?.author)
      ? rawAuthor
      : (match?.author ?? rawAuthor ?? null);
  if (!match) notes.push("no Open Library match — using the file's own metadata");
  if (!author) notes.push("author unknown");

  let coverImageUrl = match?.coverImageUrl ?? null;
  let coverSource = coverImageUrl ? "openlibrary" : "none";

  // Check both the chosen title and the bare local title — a book already on the
  // shelf may be filed under either.
  const duplicateOf =
    existingByKey.get(dupeKey(title, author)) ??
    existingByKey.get(dupeKey(short, author)) ??
    null;

  let epubBytes: number | null = null;
  let action = "create";
  let conversion: ScannedBook["conversion"] = null;

  if (!epubPath) {
    action = "skip";
    notes.push(
      files.has(".kfx")
        ? "only a Kindle .kfx file — no readable EPUB"
        : "no book file at all — only metadata"
    );
  } else {
    epubBytes = (await stat(epubPath)).size;
    if (epubBytes > MAX_UPLOAD_BYTES) {
      action = "skip";
      notes.push(
        `${(epubBytes / 1024 / 1024).toFixed(0)}MB — over the 100MB storage limit`
      );
    } else {
      const converted = await convertOne(epubPath);
      conversion = converted.summary;
      if (!conversion.ok) {
        action = "skip";
        notes.push(`conversion failed: ${conversion.error}`);
      } else if (conversion.wordCount < 2000) {
        notes.push(`only ${conversion.wordCount} words — check this one`);
      }
      // No hosted cover: fall back to the one inside the EPUB, shrunk so the
      // shelf doesn't have to download a full-size image per book.
      if (conversion.ok && !coverImageUrl && converted.coverDataUrl) {
        coverImageUrl = await shrinkCoverDataUrl(converted.coverDataUrl);
        if (coverImageUrl) coverSource = "epub";
      }
    }
  }

  // Still nothing: Calibre saved a cover next to the book.
  if (!coverImageUrl && jpgPath) {
    coverImageUrl = await shrinkCoverFile(jpgPath);
    if (coverImageUrl) coverSource = "local";
  }
  if (!coverImageUrl) {
    coverSource = "none";
    notes.push("no cover anywhere — the shelf will show a placeholder");
  }

  if (action !== "skip" && duplicateOf) {
    action = "attach";
    notes.push(`already in the library as "${duplicateOf.title}" (${duplicateOf.status})`);
  }
  if (action === "skip" && duplicateOf) {
    notes.push(`already in the library as "${duplicateOf.title}" (${duplicateOf.status})`);
  }

  return {
    stem,
    opf,
    title,
    author,
    year: match?.year ?? opf.year,
    isbn: match?.isbn ?? null,
    openlibraryKey: match?.key ?? null,
    coverImageUrl,
    coverSource,
    matchScore: Number(score.toFixed(2)),
    matchVia: via,
    epubPath,
    epubBytes,
    duplicateOf,
    action,
    notes,
    conversion,
  };
}

type ConvertOutcome = {
  summary: NonNullable<ScannedBook["conversion"]>;
  /** The EPUB's own cover at full size, before shrinking. */
  coverDataUrl: string | null;
};

async function convertOne(path: string): Promise<ConvertOutcome> {
  const empty = {
    charCount: 0,
    wordCount: 0,
    hasRealPages: false,
    pageCount: null,
    pageRows: 0,
    tocEntries: 0,
    totalPages: null,
    hasEpubCover: false,
  };
  try {
    const buffer = (await readFile(path)).buffer as ArrayBuffer;
    const result = await convertBookFile("epub", buffer);

    // Mirror what the site does after conversion: a chaptered EPUB with no real
    // page list gets a 280-words-per-page total, ignoring back matter.
    const spans = chapterSpans(result.toc, result.wordCount);
    const chaptered = !result.hasRealPages && result.wordCount > 0 && spans.length > 0;
    const totalPages = chaptered
      ? Math.ceil(contentWordCount(spans, result.wordCount) / WORDS_PER_PAGE)
      : result.pageCount;

    return {
      coverDataUrl: result.coverImageDataUrl,
      summary: {
        ok: true,
        error: null,
        charCount: result.charCount,
        wordCount: result.wordCount,
        hasRealPages: result.hasRealPages,
        pageCount: result.pageCount,
        pageRows: result.pages.length,
        tocEntries: result.toc.length,
        totalPages,
        hasEpubCover: !!result.coverImageDataUrl,
      },
    };
  } catch (err) {
    return {
      coverDataUrl: null,
      summary: {
        ok: false,
        ...empty,
        error:
          err instanceof ConversionError
            ? err.message
            : err instanceof Error
              ? `${err.name}: ${err.message}`
              : String(err),
      },
    };
  }
}

function summary(books: ScannedBook[]): string {
  const n = (f: (b: ScannedBook) => boolean) => books.filter(f).length;
  return [
    "",
    `  ${n((b) => b.action === "create")} new books to add`,
    `  ${n((b) => b.action === "attach")} files to attach to books already in the library`,
    `  ${n((b) => b.action === "skip")} skipped`,
    `  ${n((b) => b.coverSource === "openlibrary")} covers from Open Library, ` +
      `${n((b) => b.coverSource === "epub")} from inside the book file, ` +
      `${n((b) => b.coverSource === "local")} from a local image, ` +
      `${n((b) => b.coverSource === "none")} with none`,
    `  ${Math.round(
      books.reduce(
        (kb, b) =>
          kb + (b.coverImageUrl?.startsWith("data:") ? b.coverImageUrl.length / 1024 : 0),
        0
      )
    )}KB of inlined cover art across the whole shelf`,
    `  ${n((b) => !b.author)} with an unknown author`,
    "",
  ].join("\n");
}

function report(books: ScannedBook[], dir: string): string {
  const rows = (list: ScannedBook[]) =>
    list
      .map((b) => {
        const pages = b.conversion?.totalPages ?? "—";
        const words = b.conversion?.wordCount
          ? `${Math.round(b.conversion.wordCount / 1000)}k`
          : "—";
        const toc = b.conversion?.tocEntries ?? "—";
        return `| ${b.title} | ${b.author ?? "**?**"} | ${pages} | ${words} | ${toc} | ${b.coverSource} | ${b.notes.join("; ") || ""} |`;
      })
      .join("\n");

  const head =
    "| Title | Author | Pages | Words | Chapters | Cover | Notes |\n" +
    "| --- | --- | --- | --- | --- | --- | --- |";

  const create = books.filter((b) => b.action === "create");
  const attach = books.filter((b) => b.action === "attach");
  const skip = books.filter((b) => b.action === "skip");

  return [
    `# eBook import — dry run`,
    ``,
    `Source: \`${dir}\``,
    summary(books).trim(),
    ``,
    `## New books (${create.length})`,
    ``,
    head,
    rows(create),
    ``,
    `## Attach to a book already in the library (${attach.length})`,
    ``,
    head,
    rows(attach),
    ``,
    `## Skipped (${skip.length})`,
    ``,
    head,
    rows(skip),
    ``,
  ].join("\n");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
