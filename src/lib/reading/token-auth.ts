import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Authenticate a request to the reading ingest endpoint with a personal API
 * token (mirrors the todo ingest auth, migration 00140). The raw bearer token is
 * SHA-256 hashed and matched against reading_api_tokens; the token's member is
 * then resolved to a user_id, since saved articles are stamped with user_id.
 * Verified with the service-role client (no browser session in an extension
 * request).
 */
export type ReadingTokenContext = {
  memberEmail: string;
  userId: string;
};

export async function authenticateReadingToken(
  request: Request
): Promise<ReadingTokenContext | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const admin = createAdminClient();

  const { data: tokenRow } = await admin
    .from("reading_api_tokens")
    .select("id, member_email")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!tokenRow) return null;

  const { data: member } = await admin
    .from("family_members")
    .select("user_id")
    .eq("email", tokenRow.member_email)
    .maybeSingle();
  if (!member?.user_id) return null;

  // Best-effort last-used stamp; don't fail the request if it errors.
  await admin
    .from("reading_api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenRow.id);

  return {
    memberEmail: tokenRow.member_email as string,
    userId: member.user_id as string,
  };
}
