// Low-level private-API client: resolve a valid token + device identity for the
// member, send the request looking like the iOS app, and retry once on a 401
// after forcing a token refresh. Mirrors googleFetch's timeout + clear-error
// shape (src/lib/calendar/google.ts).

import {
  getValidWhoopConnection,
  forceRefreshWhoopConnection,
  type WhoopConnection,
} from "./auth";
import { deviceHeaders } from "./device";

export const WHOOP_BASE_URL = "https://api.prod.whoop.com";
const API_VERSION = "7";
const TIMEOUT_MS = 30_000;

async function rawFetch(
  conn: WhoopConnection,
  method: string,
  path: string,
  body: unknown,
): Promise<Response> {
  const url = new URL(WHOOP_BASE_URL + path);
  url.searchParams.set("apiVersion", API_VERSION);

  const headers: Record<string, string> = {
    ...deviceHeaders(conn.identity),
    authorization: `Bearer ${conn.accessToken}`,
  };
  let bodyString: string | undefined;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    bodyString = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url.toString(), {
      method,
      headers,
      signal: controller.signal,
      ...(bodyString !== undefined ? { body: bodyString } : {}),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`WHOOP API timeout after 30s: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Make a private-API call for the member. Returns parsed JSON (or undefined for
 * 204). Throws on non-2xx with a trimmed body. On 401, refreshes the token once
 * and retries — a second 401 means the refresh token is dead (reconnect needed).
 */
export async function whoopApi<T = unknown>(
  memberEmail: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  let conn = await getValidWhoopConnection(memberEmail);
  let res = await rawFetch(conn, method, path, body);

  if (res.status === 401) {
    conn = await forceRefreshWhoopConnection(memberEmail);
    res = await rawFetch(conn, method, path, body);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WHOOP API error ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
