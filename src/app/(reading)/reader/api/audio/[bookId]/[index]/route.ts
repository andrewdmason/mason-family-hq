import { NextRequest, NextResponse } from "next/server";
import { resolveReadingScope } from "@/lib/reading/scope";
import { requireListening } from "@/lib/reading/audio/access";
import { AUDIO_MIME, READING_AUDIO_BUCKET } from "@/lib/reading/audio/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A chapter's audio, at a URL that stays the same.
 *
 * The same reasoning as the book-content route, and one addition that matters
 * more here: RANGE REQUESTS. An <audio> element doesn't download a file and
 * play it, it asks for byte ranges — that's how scrubbing works, and on iOS
 * Safari a response that ignores Range simply won't play at all. So the range
 * header is forwarded upstream and the 206 comes back untouched.
 *
 * Same-origin and stable rather than a signed storage URL minted per play, for
 * the same three reasons as the book text: a URL that changes defeats the
 * browser cache, a signature expires mid-chapter, and a cross-origin URL is
 * invisible to the service worker. A chapter is twenty to forty megabytes —
 * re-downloading it because you scrubbed backwards would be the whole feature's
 * reputation.
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
    .select("audio_path, status, prepared_at")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .eq("chapter_index", chapterIndex)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!chapter || chapter.status !== "ready" || !chapter.audio_path) {
    return NextResponse.json({ error: "This chapter isn't voiced yet." }, { status: 404 });
  }

  // Audio is written once and never edited, so prepared_at changes exactly when
  // the bytes do — re-voicing a book rewrites it and moves the tag with it.
  const version = String(Date.parse(chapter.prepared_at as string));
  const etag = `"${version}"`;
  // Only answer a revalidation for a whole-file request. A range request with a
  // matching ETag is the player asking for a specific slice it doesn't have;
  // a 304 there reads as "you already have it" and playback stalls.
  const range = req.headers.get("range");
  if (!range && req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const signed = await client.storage
    .from(READING_AUDIO_BUCKET)
    .createSignedUrl(chapter.audio_path as string, 60);
  if (signed.error || !signed.data) {
    return NextResponse.json(
      { error: signed.error?.message ?? "Couldn't open this chapter." },
      { status: 500 }
    );
  }

  const upstream = await fetch(signed.data.signedUrl, {
    headers: range ? { Range: range } : undefined,
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Couldn't read this chapter." }, { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": AUDIO_MIME,
    ETag: etag,
    // Tells the player it may seek at all. Without it Safari downloads the whole
    // chapter before the first word and the scrubber does nothing.
    "Accept-Ranges": "bytes",
    "Cache-Control": req.nextUrl.searchParams.has("v")
      ? "private, max-age=31536000, immutable"
      : "private, no-cache",
  });
  for (const header of ["content-length", "content-range"] as const) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers });
}
