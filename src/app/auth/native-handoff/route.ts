import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseUrl, supabaseAnonKey } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";

// Signs a native family app's web view in to the website. The Reader iOS app
// shows the website's own reading screen in a web view; it posts its signed-in
// Supabase access token here (a form POST the web view itself makes, so the
// response's cookies land in the web view) and is redirected to `next` signed
// in.
//
// The web view gets a session of its own rather than a copy of the app's:
// Supabase rotates refresh tokens and revokes the whole session when a used
// one is replayed, so two clients sharing one session would sign each other
// out. A magic link minted for the same account (never emailed) is verified
// here instead, the way dev-login does it.
//
// Under /auth, so the middleware lets it through without a cookie session.
export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  const form = await request.formData();
  const accessToken = String(form.get("access_token") ?? "");
  const next = safeNext(String(form.get("next") ?? "/reader"));

  const admin = createAdminClient();
  const {
    data: { user },
  } = accessToken
    ? await admin.auth.getUser(accessToken)
    : { data: { user: null } };
  if (!user?.email) {
    return NextResponse.redirect(`${origin}/login?error=auth`, 303);
  }

  // Same allowlist as sign-in: only family members get a website session.
  const { data: member } = await admin
    .from("family_members")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.redirect(`${origin}/login?error=unauthorized`, 303);
  }

  const { data: link, error: linkError } =
    await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  if (linkError || !link) {
    return NextResponse.redirect(`${origin}/login?error=auth`, 303);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        );
      },
    },
  });
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (verifyError) {
    return NextResponse.redirect(`${origin}/login?error=auth`, 303);
  }

  // 303 so the web view follows with a GET.
  return NextResponse.redirect(`${origin}${next}`, 303);
}

// Only paths on this site: never an absolute or protocol-relative URL.
function safeNext(next: string): string {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/reader";
}
