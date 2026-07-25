import { NextRequest, NextResponse } from "next/server";
import { resolveReadingScope } from "@/lib/reading/scope";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";

export const runtime = "nodejs";

/**
 * The reflowed HTML of one book, at a URL that stays the same.
 *
 * It used to come straight from a signed storage URL minted per page view. That
 * is fine online and useless everywhere else: the URL changed every time, so the
 * browser cache never hit and a 1.1MB book was re-downloaded on every open; the
 * signature expired after an hour; and it was cross-origin, so the service
 * worker skipped it. A stable same-origin URL fixes all three at once and is
 * what makes offline reading possible at all.
 *
 * Self-scoped, like the reader itself — the kids' books are administered from
 * Bookshelf, never read here, so there is no member mode to support.
 *
 * Cached by content version rather than by time. `?v=` is the book's updated_at,
 * which changes only when the conversion rewrites the file, so a versioned URL
 * is immutable and a bare one revalidates against the ETag. That means both
 * `/reader/api/content/<id>?v=123` (what the page links to) and
 * `/reader/api/content/<id>` (what an explicit download asks for) are correct;
 * they just have different freshness rules.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;

  let scope;
  try {
    scope = await resolveReadingScope(null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Not authorized.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
  const { client, userId } = scope;

  const { data: content, error } = await client
    .from("reading_book_content")
    .select("content_path, status, updated_at")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!content || content.status !== "ready" || !content.content_path) {
    return NextResponse.json({ error: "No readable content." }, { status: 404 });
  }

  // The table's only writers are the upload/convert lifecycle, so updated_at
  // changes exactly when the bytes do — which is the whole requirement for a
  // cache key. A dedicated hash column would only save a redundant re-download
  // when a re-conversion happened to produce identical output.
  const version = String(Date.parse(content.updated_at as string));
  const etag = `"${version}"`;

  // Answer the revalidation before touching storage — this is the common case
  // for a bare URL once the book is already in the browser cache.
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  const signed = await client.storage
    .from(READING_BOOKS_BUCKET)
    .createSignedUrl(content.content_path as string, 60);
  if (signed.error || !signed.data) {
    return NextResponse.json(
      { error: signed.error?.message ?? "Couldn't open this book." },
      { status: 500 }
    );
  }

  const upstream = await fetch(signed.data.signedUrl);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Couldn't read this book." }, { status: 502 });
  }

  // Streamed rather than buffered: a book is upwards of a megabyte and there is
  // no reason for the function to hold all of it before sending any of it.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ETag: etag,
      // A versioned URL can never be stale by construction; a bare one has to
      // ask, which the 304 above makes cheap.
      "Cache-Control": req.nextUrl.searchParams.has("v")
        ? "private, max-age=31536000, immutable"
        : "private, no-cache",
      // Lets a download record which version it just stored without a second
      // request for the same information.
      "X-Content-Version": version,
    },
  });
}
