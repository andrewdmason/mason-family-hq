import "server-only";

import {
  GMAIL_SEND_SCOPE,
  isDwdConfigured,
  mintDelegatedToken,
} from "@/lib/calendar/google-dwd";

/**
 * Sending mail as a member of the family, through the service account that
 * already drives their calendars.
 *
 * The alternative was a mail vendor: an account, DNS records, an API key, and
 * mail that arrives from a robot. This arrives from Andrew, in Jenny's actual
 * inbox, in a thread — which is what the message actually is. It is one extra
 * scope on credentials the app already holds.
 *
 * Fetch and crypto only, no SDK, matching the calendar clients next door.
 *
 * SETUP, and it cannot be done from here: the service account's client ID must
 * be re-authorized in Google Admin → Security → API controls → Domain-wide
 * delegation with the Gmail send scope listed alongside the calendar one.
 * Without it every send fails with `unauthorized_client`.
 */

const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

function base64url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** RFC 2047, so a subject with a curly quote or an em dash survives the wire. */
function encodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export type MailInput = {
  /** The member this is sent AS. Must be a real @mason.io user. */
  fromEmail: string;
  fromName?: string | null;
  toEmail: string;
  subject: string;
  text: string;
  html: string;
  /**
   * Groups a conversation's emails in Gmail. Stable per thread, so the second
   * note about a book lands under the first rather than starting a new
   * conversation in an inbox that already has one about it.
   */
  threadKey?: string | null;
};

/** Returns false when mail isn't configured, rather than throwing — local dev
 *  has no service account and should not fail a cron run over it. */
export async function sendMail(input: MailInput): Promise<boolean> {
  if (!isDwdConfigured()) return false;

  const token = await mintDelegatedToken(input.fromEmail, GMAIL_SEND_SCOPE);

  const boundary = `b${Buffer.from(input.subject).toString("hex").slice(0, 16)}`;
  const from = input.fromName
    ? `${encodeHeader(input.fromName)} <${input.fromEmail}>`
    : input.fromEmail;

  const headers = [
    `From: ${from}`,
    `To: ${input.toEmail}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (input.threadKey) {
    const ref = `<${input.threadKey}@mason.io>`;
    headers.push(`References: ${ref}`, `In-Reply-To: ${ref}`);
  }

  const raw = [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    input.text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    input.html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const res = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: base64url(raw) }),
  });

  if (!res.ok) {
    throw new Error(`Gmail send failed (${res.status}): ${await res.text()}`);
  }
  return true;
}
