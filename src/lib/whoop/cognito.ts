// WHOOP auth via WHOOP's own Cognito proxy at /auth-service/v3/whoop/. WHOOP's
// backend fills in the real ClientId + SECRET_HASH and forwards to AWS Cognito,
// so we pass ClientId="" and just impersonate the iOS AWS Swift SDK headers to
// pass Cloudflare. Adapted from github.com/briangaoo/totem (src/whoop/cognito.ts).
//
//   1. InitiateAuth with USER_PASSWORD_AUTH
//   2. If an MFA challenge fires → RespondToAuthChallenge with the code
//   3. AccessToken (24h JWT) + RefreshToken (~30d) from AuthenticationResult
//   4. Refresh: InitiateAuth with REFRESH_TOKEN_AUTH (no MFA)

import { randomUUID } from "node:crypto";

const ENDPOINT = "https://api.prod.whoop.com/auth-service/v3/whoop/";
const USER_AGENT =
  "aws-sdk-swift/1.5.86 ua/2.1 api/cognito_identity_provider#1.5.86 os/ios#26.3.1 lang/swift#5.10 m/D,N,Z,b";

const MFA_CHALLENGES = ["SMS_MFA", "SOFTWARE_TOKEN_MFA", "EMAIL_OTP"] as const;
export type MfaChallenge = (typeof MFA_CHALLENGES)[number];

interface AuthenticationResult {
  AccessToken: string;
  RefreshToken?: string; // omitted on refresh-token flow
  IdToken: string;
  ExpiresIn: number;
  TokenType: string;
}

interface CognitoResponse {
  AuthenticationResult?: AuthenticationResult;
  ChallengeName?: string;
  Session?: string;
  ChallengeParameters?: Record<string, string>;
}

export interface CognitoTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  expiresAt: number; // epoch ms
}

/** When an MFA code is required to finish a login. */
export interface MfaRequired {
  challenge: MfaChallenge;
  session: string;
}

export function decodeJwtExp(jwt: string): number {
  const parts = jwt.split(".");
  if (parts.length < 2) return 0;
  const seg = parts[1]!;
  const padded = seg.padEnd(seg.length + ((4 - (seg.length % 4)) % 4), "=");
  try {
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as {
      exp?: number;
    };
    return payload.exp ?? 0;
  } catch {
    return 0;
  }
}

async function callCognito(
  target: "InitiateAuth" | "RespondToAuthChallenge",
  body: object,
): Promise<CognitoResponse> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": `AWSCognitoIdentityProviderService.${target}`,
      "amz-sdk-request": "attempt=1; max=1",
      "amz-sdk-invocation-id": randomUUID(),
      "user-agent": USER_AGENT,
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 200);
    try {
      const j = JSON.parse(text) as { message?: string; __type?: string };
      detail = `${j.__type ?? "error"}: ${j.message ?? text}`;
    } catch {
      // not JSON
    }
    throw new Error(`WHOOP auth ${target} failed (${response.status}): ${detail}`);
  }
  return JSON.parse(text) as CognitoResponse;
}

function tokensFromAuth(ar: AuthenticationResult, fallbackRefresh?: string): CognitoTokens {
  return {
    accessToken: ar.AccessToken,
    refreshToken: ar.RefreshToken ?? fallbackRefresh ?? "",
    idToken: ar.IdToken,
    expiresAt: decodeJwtExp(ar.AccessToken) * 1000,
  };
}

/**
 * Step 1: email/password login. Returns tokens directly, or an MfaRequired when
 * WHOOP challenges for a code (caller then calls respondMfaChallenge).
 */
export async function initiatePasswordLogin(
  email: string,
  password: string,
): Promise<{ tokens: CognitoTokens } | { mfa: MfaRequired }> {
  const init = await callCognito("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: email, PASSWORD: password },
    ClientId: "",
  });
  if (init.AuthenticationResult) {
    return { tokens: tokensFromAuth(init.AuthenticationResult) };
  }
  if (init.ChallengeName && (MFA_CHALLENGES as readonly string[]).includes(init.ChallengeName)) {
    if (!init.Session) throw new Error("WHOOP MFA challenge missing Session token");
    return { mfa: { challenge: init.ChallengeName as MfaChallenge, session: init.Session } };
  }
  throw new Error(`Unexpected WHOOP challenge: ${init.ChallengeName ?? "<none>"}`);
}

const MFA_CODE_KEY: Record<MfaChallenge, string> = {
  SMS_MFA: "SMS_MFA_CODE",
  SOFTWARE_TOKEN_MFA: "SOFTWARE_TOKEN_MFA_CODE",
  EMAIL_OTP: "EMAIL_OTP_CODE",
};

/** Step 2: answer an MFA challenge with the user's code. */
export async function respondMfaChallenge(
  email: string,
  mfa: MfaRequired,
  code: string,
): Promise<CognitoTokens> {
  const resp = await callCognito("RespondToAuthChallenge", {
    ClientId: "",
    ChallengeName: mfa.challenge,
    Session: mfa.session,
    ChallengeResponses: {
      USERNAME: email,
      [MFA_CODE_KEY[mfa.challenge]]: code.trim(),
    },
  });
  if (!resp.AuthenticationResult) {
    throw new Error("WHOOP MFA verification did not return tokens");
  }
  return tokensFromAuth(resp.AuthenticationResult);
}

/**
 * Mint a fresh access token from the long-lived refresh token. No MFA needed.
 * WHOOP usually does NOT rotate the refresh token, so we reuse the existing one
 * unless a new one comes back.
 */
export async function refreshCognitoSession(refreshToken: string): Promise<CognitoTokens> {
  const resp = await callCognito("InitiateAuth", {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    AuthParameters: { REFRESH_TOKEN: refreshToken },
    ClientId: "",
  });
  if (!resp.AuthenticationResult) {
    throw new Error("WHOOP token refresh did not return tokens");
  }
  return tokensFromAuth(resp.AuthenticationResult, refreshToken);
}
