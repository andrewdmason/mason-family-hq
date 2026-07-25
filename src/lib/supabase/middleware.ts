import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseUrl, supabaseAnonKey } from "./config";
import {
  READER_PLACE_COOKIE,
  readerPlaceForPath,
  serializeReaderPlace,
} from "@/lib/reading/last-place";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getClaims() verifies the JWT locally via the Web Crypto API + a cached JWKS
  // when the project uses asymmetric signing keys (the default for new Supabase
  // projects), so the auth gate no longer pays a network round-trip to the auth
  // server on every request — that round-trip ran before any byte could stream,
  // so it was pure latency on every page load. It still refreshes the session and
  // writes refreshed cookies via the setAll callback above, exactly like
  // getUser() did. With symmetric (legacy) keys it transparently falls back to a
  // getUser() call, so this is never slower than before. `sub` is the user id.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? null;

  if (
    !userId &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    // The family-status feed is intentionally public (no login) so the family
    // assistant can read it on a schedule — see src/app/family-status/route.ts.
    !request.nextUrl.pathname.startsWith("/family-status") &&
    // The cron sync endpoint authenticates itself with a bearer secret (it's
    // called by pg_cron, which has no session) — see
    // src/app/api/cron/calendar-sync/route.ts.
    !request.nextUrl.pathname.startsWith("/api/cron") &&
    // The todo ingest endpoint authenticates with a personal API token (it's
    // called by the Apple Reminders Shortcut and Raycast, which have no
    // session) — see src/app/api/todo/ingest/route.ts.
    !request.nextUrl.pathname.startsWith("/api/todo/ingest") &&
    // The reading ingest endpoint authenticates with a personal API token (it's
    // called by the Chrome article-capture extension, which has no session) —
    // see src/app/api/reading/ingest/route.ts.
    !request.nextUrl.pathname.startsWith("/api/reading/ingest") &&
    // The agent API authenticates with a bearer secret (it's called by the
    // family assistant, which has no session) — see src/lib/agent/auth.ts.
    !request.nextUrl.pathname.startsWith("/api/agent") &&
    // The practice-session result callback authenticates with WORKER_SECRET
    // (it's POSTed by the Modal alignment worker, which has no session) — see
    // src/app/practice/session/api/callback/route.ts.
    !request.nextUrl.pathname.startsWith("/practice/session/api/callback")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (userId && request.nextUrl.pathname.startsWith("/login")) {
    // getClaims() above only proves the JWT is locally valid — the server-side
    // session can be dead (local Supabase reset, revoked session), and a user
    // in that state MUST be able to reach /login to re-authenticate, or they
    // are trapped: every page's own getUser() fails while this bounce keeps
    // turning them away. Verify with the auth server before bouncing; the
    // network call runs only on /login requests, so the every-request fast
    // path stays offline.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const url = request.nextUrl.clone();
      url.pathname = "/home";
      return NextResponse.redirect(url);
    }
  }

  // Two role-gated apps: the practice book is owner-only, and Reader is the
  // parents' e-reader (the kids' reading lives in Bookshelf, which is open to
  // everyone). Resolve the role from the membership table (authoritative, and
  // both are low-traffic so the extra lookup is negligible). RLS scopes the
  // read to the caller's own row.
  const gated = userId
    ? (["/practice", "/reader"] as const).find((prefix) =>
        request.nextUrl.pathname.startsWith(prefix)
      )
    : undefined;
  if (gated) {
    const { data: membership } = await supabase
      .from("family_members")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();
    const allowed =
      gated === "/practice"
        ? membership?.role === "owner"
        : membership?.role === "owner" || membership?.role === "parent";
    if (!allowed) {
      const url = request.nextUrl.clone();
      // Send kids to their own reading rather than a bare dashboard.
      url.pathname = gated === "/reader" ? "/books" : "/home";
      return NextResponse.redirect(url);
    }
  }

  // Remember which Reader screen you're on, so opening /reader returns you to
  // it. This is the only hook that can write a cookie on a plain navigation.
  //
  // Prefetches are excluded: Next fetches <Link> targets ahead of the click, so
  // counting them would move your place to a book you merely hovered over.
  // Real client-side navigations send `RSC` but not `Next-Router-Prefetch`.
  if (
    userId &&
    request.method === "GET" &&
    !request.headers.has("Next-Router-Prefetch")
  ) {
    const place = readerPlaceForPath(request.nextUrl.pathname);
    if (place) {
      supabaseResponse.cookies.set(
        READER_PLACE_COOKIE,
        serializeReaderPlace(place),
        {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/reader",
          maxAge: 60 * 60 * 24 * 365,
        }
      );
    }
  }

  return supabaseResponse;
}
