import { NextRequest, NextResponse } from "next/server";
import {
  loadHashedBook,
  PlainAccessError,
  resolvePlainBook,
} from "@/lib/reading/plain/access";
import { isTranslatable } from "@/lib/reading/plain/chunk";
import { PLAIN_CHUNK_CHARS } from "@/lib/reading/plain/constants";
import {
  chapterIndexForBlock,
  derivePlainChapters,
  readChapters,
  readPlainBlocks,
} from "@/lib/reading/plain/plan";
import { translatePeek } from "@/lib/reading/plain/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The plain face of a few paragraphs, on demand — the selection peek.
 *
 * Bounded on purpose. The range is capped at one chunk's worth of text so this
 * cannot become a back door to translating a whole book without the cost
 * confirmation, paragraphs already stored are never re-sent, and the exact
 * range is claimed so two identical taps pay once. What it makes is stored
 * (the next peek is instant; a later whole-chapter run skips it) but chapter
 * rows are never created or touched: a peek must not make a book look enabled.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;
  const body = (await req.json().catch(() => ({}))) as { from?: unknown; to?: unknown };
  const from = Number(body.from);
  const to = Number(body.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from) {
    return NextResponse.json({ error: "Bad paragraph range." }, { status: 400 });
  }

  let access;
  try {
    access = await resolvePlainBook(bookId);
  } catch (err) {
    if (err instanceof PlainAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  try {
    const book = await loadHashedBook(access);
    if (to > book.blocks.length) {
      return NextResponse.json({ error: "Bad paragraph range." }, { status: 400 });
    }
    const chars = book.blocks
      .slice(from, to)
      .filter(isTranslatable)
      .reduce((sum, b) => sum + b.text.length, 0);
    if (chars > PLAIN_CHUNK_CHARS) {
      return NextResponse.json(
        { error: "That's more than a peek. Turn on Plain English for the whole book instead." },
        { status: 400 }
      );
    }

    // A chapter index for the stored rows: from the plan when it exists, from
    // the same derivation when it doesn't — without writing rows either way.
    const stored = await readChapters(access.admin, access.hash);
    const chapters =
      stored.length > 0 ? stored : derivePlainChapters(book.blocks, book.toc, book.title);
    const chapterIndex = chapterIndexForBlock(chapters, from) ?? 0;
    const chapterTitle = chapters.find((c) => c.index === chapterIndex)?.title ?? book.title;

    const outcome = await translatePeek(
      access.admin,
      book,
      chapterIndex,
      chapterTitle,
      from,
      to
    );
    const blocks = await readPlainBlocks(access.admin, access.hash, from, to);
    return NextResponse.json({ status: outcome, blocks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't translate this passage.";
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
