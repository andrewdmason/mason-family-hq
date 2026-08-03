import { NextRequest, NextResponse } from "next/server";
import { resolveReadingScope } from "@/lib/reading/scope";
import { requireListening } from "@/lib/reading/audio/access";
import { READING_AUDIO_BUCKET } from "@/lib/reading/audio/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * When each sentence of a chapter is spoken, and what it covers in the book.
 *
 * Fetched alongside the audio and held in memory for the chapter being played.
 * A few kilobytes — sentence-level rather than per-character, which is what
 * keeps it small enough to sit beside the audio rather than being a second
 * download you have to think about.
 *
 * Kept out of the track list on purpose: the plan is polled while chapters are
 * being made, and there is no reason to re-send every chapter's timings on
 * every poll.
 */
export async function GET(
  req: NextRequest,
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
  const { client, userId } = scope;

  const { data: chapter, error } = await client
    .from("reading_audio_chapters")
    .select("timings_path, status, prepared_at")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .eq("chapter_index", chapterIndex)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!chapter || chapter.status !== "ready" || !chapter.timings_path) {
    return NextResponse.json({ error: "This chapter isn't voiced yet." }, { status: 404 });
  }

  const version = String(Date.parse(chapter.prepared_at as string));
  const etag = `"${version}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const signed = await client.storage
    .from(READING_AUDIO_BUCKET)
    .createSignedUrl(chapter.timings_path as string, 60);
  if (signed.error || !signed.data) {
    return NextResponse.json(
      { error: signed.error?.message ?? "Couldn't open this chapter's timings." },
      { status: 500 }
    );
  }

  const upstream = await fetch(signed.data.signedUrl);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Couldn't read this chapter's timings." }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ETag: etag,
      "Cache-Control": req.nextUrl.searchParams.has("v")
        ? "private, max-age=31536000, immutable"
        : "private, no-cache",
    },
  });
}
