import { NextRequest, NextResponse } from "next/server";
import {
  loadHashedBook,
  PlainAccessError,
  resolvePlainBook,
} from "@/lib/reading/plain/access";
import { ensurePlainChapters } from "@/lib/reading/plain/plan";
import { translateChapter } from "@/lib/reading/plain/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Translate one chapter, live.
 *
 * The long one: a chapter is a few model calls run in parallel, each thinking
 * before it writes, which is why chunks are sized to fit comfortably inside
 * this ceiling. Safe to call twice — a chapter already being translated answers
 * "preparing" rather than paying again, and a chapter already ready answers the
 * same, because either way the caller's next move is to ask the plan route.
 */
export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ bookId: string; index: string }> }
) {
  const { bookId, index } = await params;
  const chapterIndex = Number(index);
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0) {
    return NextResponse.json({ error: "No such chapter." }, { status: 400 });
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
    const chapters = await ensurePlainChapters(
      access.admin,
      access.hash,
      book.blocks,
      book.toc,
      book.title
    );
    if (!chapters.some((c) => c.index === chapterIndex)) {
      return NextResponse.json({ error: "No such chapter." }, { status: 400 });
    }
    const outcome = await translateChapter(access.admin, book, chapterIndex);
    return NextResponse.json({ status: outcome });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't translate this chapter.";
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
