import { createAdminClient } from "@/lib/supabase/admin";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import { countWords, sanitizeArticleHtml } from "@/lib/reading/article-sanitize";

/**
 * Save a captured web article into a member's reader. Called from the token-
 * authenticated ingest route (no user session), so it uses the service-role
 * client and stamps the trusted user_id resolved from the token.
 *
 * Idempotent by canonical URL per user (a partial unique index on articles, see
 * migration 00141): re-saving the same URL refreshes the existing item and its
 * stored HTML rather than creating a duplicate. The cleaned HTML lands in the
 * existing reading-books bucket and the content row is marked ready immediately —
 * articles skip the PDF/EPUB conversion step entirely.
 */
export type ArticleIngestPayload = {
  url: string;
  title?: string | null;
  author?: string | null;
  siteName?: string | null;
  excerpt?: string | null;
  coverImageUrl?: string | null;
  html: string;
};

export type SaveArticleResult = {
  id: string;
  status: "created" | "updated";
};

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function saveArticleForUser(
  userId: string,
  payload: ArticleIngestPayload
): Promise<SaveArticleResult> {
  const url = payload.url?.trim();
  if (!url) throw new Error("url is required.");

  const cleanHtml = sanitizeArticleHtml(payload.html ?? "");
  if (!cleanHtml.trim()) {
    throw new Error("Article content was empty after sanitizing.");
  }

  const host = hostFromUrl(url);
  const title = payload.title?.trim() || host || url;
  const author = payload.author?.trim() || null;
  const siteName = payload.siteName?.trim() || host || null;
  const excerpt = payload.excerpt?.trim() || null;
  const coverImageUrl = payload.coverImageUrl?.trim() || null;
  const wordCount = countWords(cleanHtml);

  const admin = createAdminClient();

  // Idempotent by (user_id, source_url) for articles.
  const { data: existing, error: lookupError } = await admin
    .from("reading_books")
    .select("id")
    .eq("user_id", userId)
    .eq("type", "article")
    .eq("source_url", url)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);

  let bookId: string;
  let status: "created" | "updated";

  if (existing) {
    bookId = existing.id as string;
    const { error } = await admin
      .from("reading_books")
      .update({
        title,
        author,
        site_name: siteName,
        excerpt,
        word_count: wordCount,
        cover_image_url: coverImageUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bookId);
    if (error) throw new Error(error.message);
    status = "updated";
  } else {
    const { data: inserted, error } = await admin
      .from("reading_books")
      .insert({
        user_id: userId,
        type: "article",
        title,
        author,
        source_url: url,
        site_name: siteName,
        excerpt,
        word_count: wordCount,
        cover_image_url: coverImageUrl,
        status: "in_progress",
        current_page: 0,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      throw new Error(error?.message ?? "Failed to save article.");
    }
    bookId = inserted.id as string;
    status = "created";
  }

  // Store the cleaned HTML where the reader expects converted content, and mark
  // it ready (no conversion step for articles).
  const contentPath = `${userId}/${bookId}/content.html`;
  const { error: uploadError } = await admin.storage
    .from(READING_BOOKS_BUCKET)
    .upload(contentPath, Buffer.from(cleanHtml, "utf-8"), {
      contentType: "text/html",
      upsert: true,
    });
  if (uploadError) throw new Error(uploadError.message);

  const { error: contentError } = await admin.from("reading_book_content").upsert(
    {
      book_id: bookId,
      user_id: userId,
      source_format: "article",
      source_path: contentPath,
      content_path: contentPath,
      status: "ready",
      error_message: null,
      page_count: null,
      has_real_pages: false,
      char_count: cleanHtml.length,
    },
    { onConflict: "book_id" }
  );
  if (contentError) throw new Error(contentError.message);

  return { id: bookId, status };
}
