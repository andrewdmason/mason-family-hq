import { NextResponse, type NextRequest } from "next/server";
import { authenticateReadingToken } from "@/lib/reading/token-auth";
import { saveArticleForUser } from "@/lib/reading/save-article";

/**
 * Token-authenticated capture endpoint for the reader's Chrome extension (no
 * browser session — exempted from auth middleware, authenticated with a personal
 * API token from /reader/settings).
 *
 * POST { url, html, title?, author?, siteName?, excerpt?, coverImageUrl? }
 *   → saves the cleaned article into the token owner's reader. Idempotent by
 *     canonical url per user: re-saving updates in place (201 created / 200
 *     updated). The server re-sanitizes the HTML regardless of any client-side
 *     cleaning.
 *
 * CORS: the extension calls cross-origin from a chrome-extension:// page, so the
 * preflight (OPTIONS) and responses echo that origin. No other origin is allowed.
 */

export const runtime = "nodejs";

function corsHeaders(origin: string | null): Record<string, string> {
  if (origin && origin.startsWith("chrome-extension://")) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
  }
  return {};
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}

export async function POST(request: NextRequest) {
  const cors = corsHeaders(request.headers.get("origin"));
  const json = (body: unknown, status: number) =>
    NextResponse.json(body, { status, headers: cors });

  const auth = await authenticateReadingToken(request);
  if (!auth) {
    return json(
      { error: "Unauthorized — send Authorization: Bearer <reading token>." },
      401
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const url = str(body.url)?.trim() ?? "";
  const html = str(body.html) ?? "";
  if (!url) return json({ error: "url is required." }, 400);
  if (!html.trim()) return json({ error: "html is required." }, 400);

  try {
    const result = await saveArticleForUser(auth.userId, {
      url,
      html,
      title: str(body.title),
      author: str(body.author),
      siteName: str(body.siteName) ?? str(body.site_name),
      excerpt: str(body.excerpt),
      coverImageUrl: str(body.coverImageUrl) ?? str(body.cover_image_url),
    });
    return json(
      { ok: true, ...result },
      result.status === "created" ? 201 : 200
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to save article.";
    return json({ error: message }, 400);
  }
}
