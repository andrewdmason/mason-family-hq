"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/members/auth";
import { getUserTimezone } from "@/lib/date-utils";
import {
  initiatePasswordLogin,
  respondMfaChallenge,
  type CognitoTokens,
  type MfaChallenge,
} from "@/lib/whoop/cognito";
import { IOS_APP_VERSION, IOS_BUILD_NUMBER } from "@/lib/whoop/device";

/** Resolve the owner's member email (the WHOOP connection is theirs). */
async function ownerEmail(): Promise<string> {
  const supabase = await createClient();
  const userId = await requireOwner(supabase);
  const { data } = await supabase
    .from("family_members")
    .select("email")
    .eq("user_id", userId)
    .single();
  return data!.email as string;
}

async function persistConnection(memberEmail: string, tokens: CognitoTokens): Promise<void> {
  const admin = createAdminClient();
  const tz = await getUserTimezone();
  await admin.from("whoop_connections").upsert(
    {
      member_email: memberEmail,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_expires_at: new Date(tokens.expiresAt).toISOString(),
      ios_app_version: IOS_APP_VERSION,
      ios_build_number: IOS_BUILD_NUMBER,
      time_zone: tz,
    },
    { onConflict: "member_email" },
  );
}

export type ConnectResult =
  | { status: "connected" }
  | { status: "mfa_required"; challenge: MfaChallenge; session: string }
  | { status: "error"; message: string };

/** Step 1: WHOOP email + password. Either connects, or asks for an MFA code. */
export async function connectWhoop(email: string, password: string): Promise<ConnectResult> {
  const memberEmail = await ownerEmail();
  try {
    const result = await initiatePasswordLogin(email.trim(), password);
    if ("tokens" in result) {
      await persistConnection(memberEmail, result.tokens);
      revalidatePath("/settings/whoop");
      return { status: "connected" };
    }
    return { status: "mfa_required", challenge: result.mfa.challenge, session: result.mfa.session };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Login failed" };
  }
}

/** Step 2: finish an MFA-challenged login with the user's code. The Cognito
 * session round-trips through the form (it's a short-lived, single-use token). */
export async function completeWhoopMfa(input: {
  email: string;
  session: string;
  challenge: MfaChallenge;
  code: string;
}): Promise<ConnectResult> {
  const memberEmail = await ownerEmail();
  try {
    const tokens = await respondMfaChallenge(
      input.email.trim(),
      { challenge: input.challenge, session: input.session },
      input.code,
    );
    await persistConnection(memberEmail, tokens);
    revalidatePath("/settings/whoop");
    return { status: "connected" };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Verification failed" };
  }
}

export async function disconnectWhoop(): Promise<void> {
  const memberEmail = await ownerEmail();
  const admin = createAdminClient();
  await admin.from("whoop_connections").delete().eq("member_email", memberEmail);
  revalidatePath("/settings/whoop");
}
