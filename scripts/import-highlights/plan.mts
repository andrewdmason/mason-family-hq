/**
 * Work out where every Readwise highlight would land, and write a plan.
 *
 * Two joins have to happen. Readwise book -> library book, which is exact when
 * both sides know the Amazon ID (Readwise records it; the Calibre files carried
 * one too) and falls back to title+author otherwise. Then highlight text ->
 * character range inside the converted book, which is the matcher in locate.ts.
 *
 * Writes a plan and a report; touches nothing. Also answers the separate
 * question of which heavily-highlighted books aren't in the library at all.
 *
 *   npx tsx --env-file=.env.local --tsconfig scripts/tsconfig.json \
 *     scripts/import-highlights/plan.mts
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import { buildIndex, locate, buildAnchor } from "./locate";
import type { ReadwiseBook, ReadwiseHighlight } from "./fetch.mts";
import type { ScannedBook } from "../import-ebooks/types";

const EMAIL = "andrew@mason.io";

type LibraryBook = {
  id: string;
  title: string;
  author: string | null;
  status: string;
  contentStatus: string | null;
  contentPath: string | null;
};

export type PlannedHighlight = {
  readwiseId: number;
  text: string;
  note: string | null;
  color: string | null;
  highlightedAt: string | null;
  /** exact | trimmed | partial, or null when it couldn't be placed. */
  how: string | null;
  charOffset: number | null;
  anchor: unknown | null;
  quotedText: string | null;
};

export type PlannedBook = {
  readwiseTitle: string;
  readwiseAuthor: string | null;
  asin: string | null;
  bookId: string | null;
  libraryTitle: string | null;
  matchedVia: string | null;
  /** importable | no-file | not-in-library */
  state: string;
  total: number;
  located: number;
  highlights: PlannedHighlight[];
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(the|a|an) /, "")
    .trim();
}

function titleKey(title: string, author: string | null): string {
  const surname = author ? norm(author).split(" ").pop() : "";
  // Drop a subtitle: Readwise keeps publisher subtitles the library strips.
  const bare = norm(title.split(/\s*[:(]\s*/)[0]);
  return `${bare}|${surname ?? ""}`;
}

async function loadLibrary(db: SupabaseClient): Promise<LibraryBook[]> {
  const { data: user } = await db
    .from("family_members")
    .select("user_id")
    .eq("email", EMAIL)
    .maybeSingle();
  const userId = user?.user_id as string;

  const { data, error } = await db
    .from("reading_books")
    .select("id, title, author, status, type, reading_book_content(status, content_path)")
    .eq("user_id", userId)
    .or("type.is.null,type.eq.book");
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => {
    // One-to-one on the primary key, so PostgREST embeds an object here rather
    // than the array a one-to-many would give.
    const content = r.reading_book_content as unknown as
      | { status: string; content_path: string | null }
      | { status: string; content_path: string | null }[]
      | null;
    const c = Array.isArray(content) ? (content[0] ?? null) : content;
    return {
      id: r.id as string,
      title: r.title as string,
      author: (r.author as string | null) ?? null,
      status: r.status as string,
      contentStatus: c?.status ?? null,
      contentPath: c?.content_path ?? null,
    };
  });
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_PROD_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  const db = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { books: readwise } = JSON.parse(
    await readFile(resolve(".context/readwise-export.json"), "utf8")
  ) as { books: ReadwiseBook[] };

  // The eBook scan recorded each file's Amazon ID next to the title it became,
  // which is what lets a Readwise book match a library book exactly.
  const manifest = JSON.parse(
    await readFile(resolve(".context/ebook-import-manifest.json"), "utf8")
  ) as { books: ScannedBook[] };
  const titleForAsin = new Map<string, string>();
  for (const b of manifest.books) {
    if (b.opf.asin) titleForAsin.set(b.opf.asin.toUpperCase(), b.title);
  }

  const library = await loadLibrary(db);
  const byTitleKey = new Map<string, LibraryBook>();
  const byExactTitle = new Map<string, LibraryBook>();
  for (const b of library) {
    byTitleKey.set(titleKey(b.title, b.author), b);
    byExactTitle.set(norm(b.title), b);
  }

  const planned: PlannedBook[] = [];
  const indexCache = new Map<string, Awaited<ReturnType<typeof loadIndex>>>();

  for (const rw of readwise) {
    if (rw.category !== "books") continue;
    const live = rw.highlights.filter((h) => !h.is_deleted && h.text?.trim());
    if (live.length === 0) continue;

    // ASIN first (exact), then title+author, then bare title.
    let match: LibraryBook | null = null;
    let via: string | null = null;
    const asin = rw.asin?.toUpperCase() ?? null;
    if (asin && titleForAsin.has(asin)) {
      const t = titleForAsin.get(asin)!;
      match = byExactTitle.get(norm(t)) ?? null;
      if (match) via = "amazon id";
    }
    if (!match) {
      match = byTitleKey.get(titleKey(rw.title, rw.author)) ?? null;
      if (match) via = "title + author";
    }
    if (!match) {
      match = byExactTitle.get(norm(rw.title.split(/\s*[:(]\s*/)[0])) ?? null;
      if (match) via = "title";
    }

    const entry: PlannedBook = {
      readwiseTitle: rw.title,
      readwiseAuthor: rw.author,
      asin,
      bookId: match?.id ?? null,
      libraryTitle: match?.title ?? null,
      matchedVia: via,
      state: !match
        ? "not-in-library"
        : match.contentStatus === "ready"
          ? "importable"
          : "no-file",
      total: live.length,
      located: 0,
      highlights: [],
    };

    if (entry.state === "importable" && match?.contentPath) {
      let index = indexCache.get(match.id);
      if (!index) {
        index = await loadIndex(db, match.contentPath);
        indexCache.set(match.id, index);
      }
      if (index) {
        // Highlights come in reading order, so each search starts where the last
        // one landed — which is what disambiguates a phrase that recurs.
        let cursor = 0;
        const ordered = [...live].sort(
          (a, b) => (a.location ?? 0) - (b.location ?? 0)
        );
        for (const h of ordered) {
          const at = locate(index, h.text, cursor);
          const built = at ? buildAnchor(index, at) : null;
          if (at && built) {
            cursor = at.start;
            entry.located++;
            entry.highlights.push(toPlanned(h, at.how, built));
          } else {
            entry.highlights.push(toPlanned(h, null, null));
          }
        }
      }
    } else {
      for (const h of live) entry.highlights.push(toPlanned(h, null, null));
    }

    planned.push(entry);
    if (entry.state === "importable") {
      console.log(
        `  ${entry.located === entry.total ? "ok  " : "part"} ${entry.libraryTitle}: ${entry.located}/${entry.total}`
      );
    }
  }

  const outDir = resolve(".context");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "highlight-plan.json"),
    JSON.stringify({ books: planned }, null, 2)
  );
  await writeFile(join(outDir, "highlight-report.md"), report(planned));

  const importable = planned.filter((p) => p.state === "importable");
  const missing = planned.filter((p) => p.state === "not-in-library");
  const noFile = planned.filter((p) => p.state === "no-file");
  const sum = (list: PlannedBook[], f: (p: PlannedBook) => number) =>
    list.reduce((n, p) => n + f(p), 0);

  console.log(
    [
      ``,
      `  ${importable.length} books in the library can take highlights`,
      `  ${sum(importable, (p) => p.located)} of ${sum(importable, (p) => p.total)} highlights located`,
      `  ${noFile.length} books are on the shelf but have no readable file (${sum(noFile, (p) => p.total)} highlights)`,
      `  ${missing.length} books aren't in the library at all (${sum(missing, (p) => p.total)} highlights)`,
      ``,
      `Plan   → .context/highlight-plan.json`,
      `Report → .context/highlight-report.md`,
    ].join("\n")
  );
}

function toPlanned(
  h: ReadwiseHighlight,
  how: string | null,
  built: { anchor: unknown; anchorCharOffset: number; quotedText: string } | null
): PlannedHighlight {
  return {
    readwiseId: h.id,
    text: h.text,
    note: h.note?.trim() || null,
    color: h.color ?? null,
    highlightedAt: h.highlighted_at ?? null,
    how,
    charOffset: built?.anchorCharOffset ?? null,
    anchor: built?.anchor ?? null,
    quotedText: built?.quotedText ?? null,
  };
}

async function loadIndex(db: SupabaseClient, path: string) {
  const dl = await db.storage.from(READING_BOOKS_BUCKET).download(path);
  if (dl.error || !dl.data) return null;
  return buildIndex(await dl.data.text());
}

function report(planned: PlannedBook[]): string {
  const importable = planned
    .filter((p) => p.state === "importable")
    .sort((a, b) => b.total - a.total);
  const noFile = planned
    .filter((p) => p.state === "no-file")
    .sort((a, b) => b.total - a.total);
  const missing = planned
    .filter((p) => p.state === "not-in-library")
    .sort((a, b) => b.total - a.total);

  const lines: string[] = ["# Kindle highlights — dry run", ""];

  lines.push(`## Ready to import (${importable.length} books)`, "");
  lines.push("| Book | Highlights | Located | Matched by |", "| --- | --- | --- | --- |");
  for (const p of importable) {
    lines.push(
      `| ${p.libraryTitle} | ${p.total} | ${p.located}${p.located < p.total ? ` (${p.total - p.located} missed)` : ""} | ${p.matchedVia} |`
    );
  }

  lines.push("", `## On the shelf, but no readable file (${noFile.length})`, "");
  lines.push("| Book | Highlights |", "| --- | --- |");
  for (const p of noFile) lines.push(`| ${p.libraryTitle} | ${p.total} |`);

  lines.push("", `## Not in the library at all (${missing.length})`, "");
  lines.push("| Book | Author | Highlights |", "| --- | --- | --- |");
  for (const p of missing) {
    lines.push(`| ${p.readwiseTitle} | ${p.readwiseAuthor ?? "?"} | ${p.total} |`);
  }

  const misses = importable.flatMap((p) =>
    p.highlights
      .filter((h) => h.how === null)
      .map((h) => `- **${p.libraryTitle}** — ${h.text.slice(0, 140).replace(/\n/g, " ")}`)
  );
  if (misses.length) {
    lines.push("", `## Highlights that couldn't be placed (${misses.length})`, "");
    lines.push(...misses.slice(0, 60));
  }

  return lines.join("\n") + "\n";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
