import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TEAMSNAP_AUTH_URL, getTeamsnapMe } from "@/lib/calendar/teamsnap";

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const back = (err?: string) =>
    NextResponse.redirect(
      `${origin}/calendar${err ? `?teamsnap_error=${err}` : ""}`,
    );

  if (error) return back(error);
  if (!code || !state) return back("missing_params");

  const storedState = request.cookies.get("teamsnap_oauth_state")?.value;
  if (!storedState || storedState !== state) return back("invalid_state");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  // The connecting member's email is the key for the connection row.
  const { data: member } = await supabase
    .from("family_members")
    .select("email")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member?.email) return back("no_member");

  const redirectUri = `${origin}/api/teamsnap/callback`;
  const tokenRes = await fetch(`${TEAMSNAP_AUTH_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: process.env.TEAMSNAP_CLIENT_ID!,
      client_secret: process.env.TEAMSNAP_CLIENT_SECRET!,
    }),
  });

  if (!tokenRes.ok) {
    console.error("TeamSnap token exchange failed:", await tokenRes.text());
    return back("token_exchange");
  }

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  let teamsnapUserId: number | null = null;
  try {
    teamsnapUserId = (await getTeamsnapMe(tokens.access_token)).id;
  } catch (err) {
    console.error("Failed to fetch TeamSnap profile:", err);
  }

  const tokenExpiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  const admin = createAdminClient();
  const { error: upsertError } = await admin.from("teamsnap_connections").upsert(
    {
      member_email: member.email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      token_expires_at: tokenExpiresAt,
      teamsnap_user_id: teamsnapUserId,
    },
    { onConflict: "member_email" },
  );

  if (upsertError) {
    console.error("Failed to store TeamSnap connection:", upsertError);
    return back("storage");
  }

  const response = NextResponse.redirect(`${origin}/calendar`);
  response.cookies.set("teamsnap_oauth_state", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
