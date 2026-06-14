import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseUrl, supabaseAnonKey } from "./config";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (
    !user &&
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
    !request.nextUrl.pathname.startsWith("/api/agent")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.redirect(url);
  }

  // The practice book is owner-only. Resolve the role from the membership table
  // (authoritative, and /practice is owner-only/low-traffic so the extra lookup
  // is negligible). RLS scopes the read to the caller's own row.
  if (user && request.nextUrl.pathname.startsWith("/practice")) {
    const { data: membership } = await supabase
      .from("family_members")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (membership?.role !== "owner") {
      const url = request.nextUrl.clone();
      url.pathname = "/home";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
