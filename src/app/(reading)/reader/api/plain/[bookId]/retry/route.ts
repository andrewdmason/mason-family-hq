import { NextRequest, NextResponse } from "next/server";
import { PlainAccessError, resolvePlainBook } from "@/lib/reading/plain/access";
import { retryChapter } from "@/lib/reading/plain/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Give a failed chapter another go.
 *
 * Just the reset: the chapter goes back to pending, and the caller fires the
 * prepare route as it would for any untranslated chapter it has reached.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;
  const body = (await req.json().catch(() => ({}))) as { chapterIndex?: unknown };
  const chapterIndex = Number(body.chapterIndex);
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

  await retryChapter(access.admin, access.hash, chapterIndex);
  return NextResponse.json({ ok: true });
}
