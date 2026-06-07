// Connection management for the WHOOP private-API integration: persist tokens +
// device identity in whoop_connections (keyed by member_email), and hand out a
// valid access token on demand, refreshing within ~60s of expiry. Mirrors the
// shape of getValidGoogleToken (src/lib/calendar/google.ts), but auth is WHOOP's
// Cognito flow rather than OAuth redirect. All DB access is service-role.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  refreshCognitoSession,
  decodeJwtExp,
  type CognitoTokens,
} from "./cognito";
import type { DeviceIdentity } from "./device";

const REFRESH_BUFFER_MS = 60 * 1000;

export interface WhoopConnection {
  memberEmail: string;
  accessToken: string;
  identity: DeviceIdentity;
}

interface ConnectionRow {
  member_email: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
  installation_identifier: string;
  ios_app_version: string | null;
  ios_build_number: string | null;
  time_zone: string | null;
}

function toIdentity(row: ConnectionRow): DeviceIdentity {
  return {
    installationId: row.installation_identifier.toUpperCase(),
    timeZone: row.time_zone || "America/Los_Angeles",
    iosAppVersion: row.ios_app_version,
    iosBuildNumber: row.ios_build_number,
  };
}

// Single-flight: dedupe concurrent refreshes for the same member so two pushes
// don't both spend the (possibly one-time-use) refresh token.
const inflight = new Map<string, Promise<WhoopConnection>>();

/** True if the member has a WHOOP connection at all. */
export async function hasWhoopConnection(memberEmail: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("whoop_connections")
    .select("member_email")
    .eq("member_email", memberEmail)
    .maybeSingle();
  return !!data;
}

/**
 * A valid access token + device identity for the member, refreshing if the
 * stored token is missing or within 60s of expiry. Throws if there's no
 * connection or the refresh token is no longer accepted (the caller surfaces
 * that as a failed sync with a reconnect prompt).
 */
export async function getValidWhoopConnection(memberEmail: string): Promise<WhoopConnection> {
  const existing = inflight.get(memberEmail);
  if (existing) return existing;

  const work = (async (): Promise<WhoopConnection> => {
    const supabase = createAdminClient();
    const { data: row, error } = await supabase
      .from("whoop_connections")
      .select(
        "member_email, access_token, refresh_token, token_expires_at, installation_identifier, ios_app_version, ios_build_number, time_zone",
      )
      .eq("member_email", memberEmail)
      .single<ConnectionRow>();
    if (error || !row) throw new Error("No WHOOP connection found");

    const expiresMs = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
    if (row.access_token && expiresMs - REFRESH_BUFFER_MS > Date.now()) {
      return { memberEmail, accessToken: row.access_token, identity: toIdentity(row) };
    }

    const refreshed = await refreshCognitoSession(row.refresh_token);
    await persistTokens(memberEmail, refreshed);
    return { memberEmail, accessToken: refreshed.accessToken, identity: toIdentity(row) };
  })();

  inflight.set(memberEmail, work);
  try {
    return await work;
  } finally {
    inflight.delete(memberEmail);
  }
}

/**
 * Force a refresh regardless of cached expiry — used after a 401, where the
 * access token is expired beyond the normal buffer. Returns the fresh connection.
 */
export async function forceRefreshWhoopConnection(memberEmail: string): Promise<WhoopConnection> {
  const supabase = createAdminClient();
  const { data: row, error } = await supabase
    .from("whoop_connections")
    .select(
      "member_email, access_token, refresh_token, token_expires_at, installation_identifier, ios_app_version, ios_build_number, time_zone",
    )
    .eq("member_email", memberEmail)
    .single<ConnectionRow>();
  if (error || !row) throw new Error("No WHOOP connection found");
  const refreshed = await refreshCognitoSession(row.refresh_token);
  await persistTokens(memberEmail, refreshed);
  return { memberEmail, accessToken: refreshed.accessToken, identity: toIdentity(row) };
}

/** Write refreshed/initial tokens back to the connection row. */
export async function persistTokens(memberEmail: string, tokens: CognitoTokens): Promise<void> {
  const supabase = createAdminClient();
  const expiresAt = new Date(
    tokens.expiresAt || decodeJwtExp(tokens.accessToken) * 1000,
  ).toISOString();
  await supabase
    .from("whoop_connections")
    .update({
      access_token: tokens.accessToken,
      // WHOOP usually doesn't rotate the refresh token; only overwrite if a new
      // one came back (refreshCognitoSession falls back to the old one).
      refresh_token: tokens.refreshToken,
      token_expires_at: expiresAt,
    })
    .eq("member_email", memberEmail);
}
