// Domain-wide delegation (DWD) for writing to the kids' Google calendars.
//
// The importer materializes TeamSnap/ICS events onto each kid's own Google
// calendar (oscar@mason.io, …). Doing that "as the kid" via per-user OAuth would
// require every kid to sign in and keep a refresh token alive — fragile for users
// who never open the app. Instead, because @mason.io is a Google Workspace we
// administer, a single service account with domain-wide delegation can impersonate
// any user in the domain for the calendar scope, authorized once in the Admin
// console. No kid sign-in, no per-kid tokens.
//
// This mints a delegated access token for a target user via the JWT-bearer flow
// (sign a JWT asserting `sub`, exchange it for an access token). Kept fetch- and
// crypto-based to match the rest of the calendar clients (no SDK).
//
// Required env (service account JSON, server-only):
//   GOOGLE_SA_CLIENT_EMAIL  — the service account's client_email
//   GOOGLE_SA_PRIVATE_KEY   — its private_key (PEM; literal "\n" newlines are ok)

import { createSign } from "node:crypto";

// Inlined (not imported from ./google) so the credential layer has no import
// cycle with the client that consumes it.
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

// Per-subject token cache for the life of the server process. Tokens are valid
// ~1h; refresh within a 5-minute buffer (mirrors getValidGoogleToken).
const cache = new Map<string, { token: string; expiresAt: number }>();

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function serviceAccount(): { clientEmail: string; privateKey: string } {
  const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_SA_PRIVATE_KEY;
  if (!clientEmail || !rawKey) {
    throw new Error(
      "Domain-wide delegation is not configured (set GOOGLE_SA_CLIENT_EMAIL and GOOGLE_SA_PRIVATE_KEY).",
    );
  }
  // Env vars commonly store the PEM with escaped newlines; normalize them.
  const privateKey = rawKey.includes("\\n")
    ? rawKey.replace(/\\n/g, "\n")
    : rawKey;
  return { clientEmail, privateKey };
}

/** Whether DWD is configured. Lets the importer stay dormant until setup is done. */
export function isDwdConfigured(): boolean {
  return !!(process.env.GOOGLE_SA_CLIENT_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY);
}

/** A valid calendar access token that acts AS `subjectEmail` (an @mason.io user),
 * via the service account's domain-wide delegation. Cached per subject. */
export async function mintDelegatedToken(subjectEmail: string): Promise<string> {
  const bufferMs = 5 * 60 * 1000;
  const cached = cache.get(subjectEmail);
  if (cached && cached.expiresAt - bufferMs > Date.now()) {
    return cached.token;
  }

  const { clientEmail, privateKey } = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: clientEmail,
      sub: subjectEmail,
      scope: CALENDAR_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = base64url(
    createSign("RSA-SHA256").update(signingInput).sign(privateKey),
  );
  const assertion = `${signingInput}.${signature}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Google delegated token request timed out after 15s");
    }
    throw err;
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Delegated token request failed for ${subjectEmail}: ${text.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cache.set(subjectEmail, {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  });
  return json.access_token;
}
