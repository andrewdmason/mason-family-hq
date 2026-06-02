import { NextRequest, NextResponse } from "next/server";
import { resolveReadingScope } from "@/lib/reading/scope";
import { convertBookFile, ConversionError } from "@/lib/reading/convert";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Convert an uploaded book file into reflowable HTML + a page map. Triggered
 * from the browser after upload, so it authenticates via the session cookies and
 * scopes to the right member (owner-on-behalf included). Always leaves the
 * content row in a terminal state (ready/failed) and returns JSON.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    bookId?: string;
    memberEmail?: string | null;
  } | null;
  const bookId = body?.bookId;
  if (!bookId) {
    return NextResponse.json({ error: "bookId required" }, { status: 400 });
  }

  let scope;
  try {
    scope = await resolveReadingScope(body?.memberEmail ?? null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Not authorized.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
  const { client, userId } = scope;

  const { data: content, error: loadError } = await client
    .from("reading_book_content")
    .select("source_path, source_format")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!content) {
    return NextResponse.json({ error: "No file to convert." }, { status: 404 });
  }

  const format = content.source_format as "pdf" | "epub";

  const fail = async (message: string) => {
    await client
      .from("reading_book_content")
      .update({ status: "failed", error_message: message })
      .eq("book_id", bookId)
      .eq("user_id", userId);
    return NextResponse.json({ error: message }, { status: 200 });
  };

  try {
    await client
      .from("reading_book_content")
      .update({ status: "processing", error_message: null })
      .eq("book_id", bookId)
      .eq("user_id", userId);

    const download = await client.storage
      .from(READING_BOOKS_BUCKET)
      .download(content.source_path);
    if (download.error || !download.data) {
      return await fail("Couldn't read the uploaded file.");
    }
    const buffer = await download.data.arrayBuffer();

    const result = await convertBookFile(format, buffer);

    const contentPath = `${userId}/${bookId}/content.html`;
    const upload = await client.storage
      .from(READING_BOOKS_BUCKET)
      .upload(contentPath, new Blob([result.html], { type: "text/html" }), {
        contentType: "text/html",
        upsert: true,
      });
    if (upload.error) {
      return await fail("Couldn't save the converted book.");
    }

    // Replace the page map: clear any stale rows, then insert the fresh ones.
    await client.from("reading_book_pages").delete().eq("book_id", bookId);
    if (result.pages.length > 0) {
      const rows = result.pages.map((p) => ({
        book_id: bookId,
        user_id: userId,
        page_number: p.pageNumber,
        anchor_id: p.anchorId,
        char_start: p.charStart,
        char_end: p.charEnd,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error: pageError } = await client
          .from("reading_book_pages")
          .insert(rows.slice(i, i + 500));
        if (pageError) return await fail(pageError.message);
      }
    }

    const { error: finalizeError } = await client
      .from("reading_book_content")
      .update({
        status: "ready",
        content_path: contentPath,
        page_count: result.pageCount,
        has_real_pages: result.hasRealPages,
        char_count: result.charCount,
        toc: result.toc,
        error_message: null,
      })
      .eq("book_id", bookId)
      .eq("user_id", userId);
    if (finalizeError) return await fail(finalizeError.message);

    return NextResponse.json({ status: "ready" });
  } catch (err) {
    const message =
      err instanceof ConversionError
        ? err.message
        : "Something went wrong while preparing this book.";
    if (!(err instanceof ConversionError)) {
      console.error("[reading/convert] failed:", err);
    }
    return await fail(message);
  }
}
