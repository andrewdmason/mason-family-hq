import { NextRequest, NextResponse } from "next/server";
import { resolveReadingScope } from "@/lib/reading/scope";
import { requireListening } from "@/lib/reading/audio/access";
import { getAudioPlan } from "@/lib/reading/audio/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A book's track list: what the chapters are, which of them are voiced, and
 * what listening to it has cost so far.
 *
 * The first request for a book derives the chapters and stores them, so this
 * can be slow once and is fast forever after. Self-scoped like the rest of the
 * reader — listening is an adults-only feature on your own books.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;

  let scope;
  try {
    await requireListening();
    scope = await resolveReadingScope(null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Not authorized.";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  try {
    const plan = await getAudioPlan(scope.client, scope.userId, bookId);
    if (!plan) {
      return NextResponse.json(
        { error: "This book can't be listened to yet." },
        { status: 404 }
      );
    }
    return NextResponse.json(plan, {
      // Chapter statuses change as they're prepared, so this is never cacheable
      // — the player polls it while a chapter is being made.
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't work out the chapters.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
