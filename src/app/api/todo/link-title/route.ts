import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Resolves a URL to its page title for the notes editor's link paste
 * (see src/components/todos/link-paste.ts): og:title, falling back to
 * <title>. Best-effort by design — any failure returns { title: null }
 * and the editor keeps showing the raw URL as the link text.
 *
 * Session-authenticated (middleware redirects anonymous callers, and we
 * re-check here) so this can't be used as an open fetch proxy, and private
 * hosts are refused for the same reason.
 */

const FETCH_TIMEOUT_MS = 5000;
// Titles live in <head>; this comfortably covers bloated head sections
// without ever pulling down a whole page.
const MAX_BYTES = 256 * 1024;
const MAX_TITLE_LENGTH = 200;

function parseAllowedUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (host.includes(":")) return null; // raw IPv6
  const octets = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (octets) {
    const [a, b] = [Number(octets[1]), Number(octets[2])];
    const isPrivate =
      a === 0 || a === 10 || a === 127 || a === 169 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
    if (isPrivate) return null;
  }
  return url;
}

/** Read the response body only until </title> shows up (or the cap). */
async function readHead(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let html = "";
  while (html.length < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    if (html.includes("</title>")) break;
  }
  void reader.cancel().catch(() => {});
  return html.slice(0, MAX_BYTES);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function extractTitle(html: string): string | null {
  // og:title first (usually the cleaner, site-suffix-free name), then <title>.
  const og =
    html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  const raw = og?.[1] ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (!raw) return null;
  const title = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (!title) return null;
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = parseAllowedUrl(request.nextUrl.searchParams.get("url") ?? "");
  if (!url) {
    return NextResponse.json({ title: null });
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
      headers: {
        // Some sites refuse requests without a browsery UA.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("html")) {
      return NextResponse.json({ title: null });
    }
    const title = extractTitle(await readHead(res));
    return NextResponse.json(
      { title },
      // Same link re-pasted soon after (or in another task) skips the refetch.
      { headers: { "Cache-Control": "private, max-age=3600" } }
    );
  } catch {
    return NextResponse.json({ title: null });
  }
}
