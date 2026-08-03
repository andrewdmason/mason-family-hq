import { NextRequest, NextResponse } from "next/server";
import { resolveReadingScope } from "@/lib/reading/scope";
import { requireListening } from "@/lib/reading/audio/access";
import { synthesizeChapter } from "@/lib/reading/audio/synthesize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Voice one chapter.
 *
 * The long one. Cleaning the text and narrating it takes tens of seconds for a
 * normal chapter, which is why chapters are capped at a size that fits inside
 * this ceiling (MAX_CHAPTER_CHARS) rather than being sent to a worker service.
 *
 * Safe to call twice. A chapter already being prepared answers immediately with
 * "preparing" rather than starting a second, separately-billed synthesis — which
 * is the difference between an impatient double-tap costing nothing and costing
 * another few dollars.
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

  let scope;
  try {
    await requireListening();
    scope = await resolveReadingScope(null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Not authorized.";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  try {
    const result = await synthesizeChapter(
      scope.client,
      scope.userId,
      bookId,
      chapterIndex
    );
    // Null means someone else holds the chapter, or it was already done. Either
    // way the answer for the caller is the same: ask again shortly.
    if (!result) return NextResponse.json({ status: "preparing" });
    return NextResponse.json({
      status: "ready",
      durationMs: result.durationMs,
      billedChars: result.billedChars,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't prepare this chapter.";
    return NextResponse.json({ status: "failed", error: message }, { status: 500 });
  }
}
