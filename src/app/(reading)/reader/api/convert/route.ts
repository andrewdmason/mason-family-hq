import { NextRequest, NextResponse } from "next/server";
import { resolveReadingScope } from "@/lib/reading/scope";
import { convertBookFile, ConversionError } from "@/lib/reading/convert";
import { ensureStretchQuiz } from "@/lib/reading/ensure-stretch-quiz";
import { readingIncrement } from "@/lib/reading/advance";
import { resolveNextTarget } from "@/lib/reading/next-target";
import {
  WORDS_PER_PAGE,
  chapterSpans,
  contentWordCount,
} from "@/lib/reading/chapter-target";
import { readingTargetDueDateKey } from "@/lib/reading/target-due";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { createHash } from "node:crypto";
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
  const { client, userId, email } = scope;

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
  // A correlation tag so every line for one conversion can be grepped together.
  const tag = `[reading/convert] book=${bookId} fmt=${format}`;
  const log = (msg: string, extra?: Record<string, unknown>) =>
    console.log(`${tag} ${msg}`, extra ? JSON.stringify(extra) : "");

  const fail = async (message: string) => {
    await client
      .from("reading_book_content")
      .update({ status: "failed", error_message: message })
      .eq("book_id", bookId)
      .eq("user_id", userId);
    return NextResponse.json({ error: message }, { status: 200 });
  };

  try {
    log("start");
    await client
      .from("reading_book_content")
      .update({ status: "processing", error_message: null })
      .eq("book_id", bookId)
      .eq("user_id", userId);

    const download = await client.storage
      .from(READING_BOOKS_BUCKET)
      .download(content.source_path);
    if (download.error || !download.data) {
      log("download failed", { error: download.error?.message ?? null });
      return await fail("Couldn't read the uploaded file.");
    }
    const buffer = await download.data.arrayBuffer();
    log("downloaded", { bytes: buffer.byteLength });

    const result = await convertBookFile(format, buffer);
    log("converted", {
      pageCount: result.pageCount,
      hasRealPages: result.hasRealPages,
      charCount: result.charCount,
      pages: result.pages.length,
    });

    const contentPath = `${userId}/${bookId}/content.html`;
    // Recorded now, while the bytes are in hand. Two books with the same hash
    // have the same character space, which is what lets a shared mark's position
    // move between copies untouched — see migration 00182.
    const contentHash = createHash("sha256").update(result.html).digest("hex");
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
        content_hash: contentHash,
        page_count: result.pageCount,
        has_real_pages: result.hasRealPages,
        char_count: result.charCount,
        word_count: result.wordCount,
        toc: result.toc,
        error_message: null,
      })
      .eq("book_id", bookId)
      .eq("user_id", userId);
    if (finalizeError) return await fail(finalizeError.message);

    // The text now exists: if this book is being actively read toward a target,
    // prepare its stretch quiz so it's ready when they reach it. Best-effort —
    // never fail the conversion over quiz generation.
    try {
      const { data: book } = await client
        .from("reading_books")
        .select("status, current_page, target_page, target_locked, total_pages, cover_image_url")
        .eq("id", bookId)
        .eq("user_id", userId)
        .maybeSingle();
      // An EPUB's embedded cover fills in for books with no cover yet (e.g.
      // uploaded without an Open Library match). Never clobber a cover the
      // user already has.
      if (result.coverImageDataUrl && book && !book.cover_image_url) {
        const { error: coverError } = await client
          .from("reading_books")
          .update({ cover_image_url: result.coverImageDataUrl })
          .eq("id", bookId)
          .eq("user_id", userId);
        if (coverError) {
          log("cover update failed", { error: coverError.message });
        } else {
          log("cover set from epub");
        }
      }

      // Where the reader's active goal ends — the range a prepared quiz covers.
      let throughPage = (book?.target_page as number | null) ?? null;

      // A synthetic-page EPUB with real chapters: define this book's page space
      // as 280-word pages (so a "page" matches a printed one, not the EPUB's
      // font-dependent reflow), and snap the active goal to a chapter.
      const spans = chapterSpans(result.toc, result.wordCount);
      const chaptered =
        book && !result.hasRealPages && result.wordCount > 0 && spans.length > 0;
      if (chaptered) {
        // Length is the story, not the file — trailing previews/back matter don't
        // count toward the page total or the "finished" line.
        const wordPages = Math.ceil(
          contentWordCount(spans, result.wordCount) / WORDS_PER_PAGE
        );
        const bookUpdate: Record<string, unknown> = { total_pages: wordPages };
        if (book.status === "in_progress" && !book.target_locked) {
          const increment = await readingIncrement(client, email);
          const next = await resolveNextTarget(
            client,
            userId,
            { id: bookId, total_pages: wordPages },
            book.current_page as number,
            increment
          );
          const tz = await getUserTimezone();
          const today = localDate(new Date(), tz);
          bookUpdate.target_page = next.targetPage;
          bookUpdate.target_chapter = next.targetChapter;
          bookUpdate.target_due =
            next.targetPage != null ? readingTargetDueDateKey(today) : null;
          throughPage = next.targetPage;
        }
        const { error: pageError } = await client
          .from("reading_books")
          .update(bookUpdate)
          .eq("id", bookId)
          .eq("user_id", userId);
        if (pageError) log("page space update failed", { error: pageError.message });
      }

      if (book?.status === "in_progress" && throughPage != null) {
        const current = book.current_page as number;
        await ensureStretchQuiz(
          scope,
          bookId,
          current > 1 ? current : null,
          throughPage
        );
      }
    } catch (err) {
      console.error("[reading/convert] stretch quiz prep failed:", err);
    }

    log("ready");
    return NextResponse.json({ status: "ready" });
  } catch (err) {
    const message =
      err instanceof ConversionError
        ? err.message
        : "Something went wrong while preparing this book.";
    // A ConversionError is an expected, user-facing outcome (e.g. a scanned
    // PDF); everything else is a bug worth the full stack. Log both so a failed
    // book always leaves a breadcrumb, and include the error name + stack since
    // the bare message ("Setting up fake worker failed") hides the real cause.
    console.error(`${tag} failed`, {
      expected: err instanceof ConversionError,
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return await fail(message);
  }
}
