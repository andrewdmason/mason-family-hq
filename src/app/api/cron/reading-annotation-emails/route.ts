// Turning the shared-mark outbox into email.
//
// Every five minutes, but nothing written in the last few minutes is touched.
// That delay IS the batching: a flurry of typing in one conversation is still
// sitting unsent when the sweep next runs, so it goes out as one message rather
// than five. And anything already read in the app is dropped without sending at
// all, which is the difference between this feeling like a person telling you
// something and a mailing list.
//
// Auth matches the calendar sync next door: a bearer token equal to CRON_SECRET.

import { createAdminClient } from "@/lib/supabase/admin";
import { listRoster } from "@/lib/members/roster";
import { sendMail } from "@/lib/mail/gmail-dwd";
import { sharedMarkHref } from "@/lib/reading/links";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * How long a conversation has to be quiet before anybody is emailed about it.
 *
 * Long enough to collect a burst of typing, short enough that "I left you a
 * note" still arrives while you might do something about it.
 */
const QUIET_MINUTES = 3;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://family.mason.io";

function authorized(req: Request): boolean {
  const expected =
    process.env.CRON_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected) return false;
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return token === expected;
}

type Pending = {
  id: string;
  thread_id: string;
  recipient_user_id: string;
  actor_user_id: string;
  kind: string;
  created_at: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - QUIET_MINUTES * 60_000).toISOString();

  const { data: pendingRows } = await admin
    .from("reading_annotation_notifications")
    .select("id, thread_id, recipient_user_id, actor_user_id, kind, created_at")
    .is("emailed_at", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(500);

  const pending = (pendingRows ?? []) as Pending[];
  if (pending.length === 0) {
    return Response.json({ ok: true, groups: 0, sent: 0 });
  }

  // One email per person per conversation, however many lines went into it.
  const groups = new Map<string, Pending[]>();
  for (const p of pending) {
    const key = `${p.recipient_user_id}|${p.thread_id}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  const roster = await listRoster();
  const byUserId = new Map(roster.filter((m) => m.userId).map((m) => [m.userId!, m]));

  let sent = 0;
  let skippedRead = 0;

  for (const [, rows] of groups) {
    const { thread_id: threadId, recipient_user_id: recipientId } = rows[0];
    const newest = rows.reduce(
      (a, b) => (a.created_at > b.created_at ? a : b),
      rows[0]
    );

    const { data: participant } = await admin
      .from("reading_annotation_thread_participants")
      .select("last_read_at, muted, annotation_id")
      .eq("thread_id", threadId)
      .eq("user_id", recipientId)
      .maybeSingle();
    const p = participant as {
      last_read_at: string | null;
      muted: boolean;
      annotation_id: string | null;
    } | null;

    // They read it in the app before the sweep came round, or they left the
    // conversation. Claim the rows so they never come back, and send nothing.
    const alreadyRead =
      !p || p.muted || (p.last_read_at != null && p.last_read_at >= newest.created_at);
    if (alreadyRead) {
      await claim(admin, rows);
      skippedRead += 1;
      continue;
    }

    const recipient = byUserId.get(recipientId);
    const actor = byUserId.get(newest.actor_user_id);
    if (!recipient?.email || !actor?.email) {
      await claim(admin, rows);
      continue;
    }

    const { data: mark } = p.annotation_id
      ? await admin
          .from("reading_annotations")
          .select("quoted_text, book_id")
          .eq("id", p.annotation_id)
          .maybeSingle()
      : { data: null };
    const m = mark as { quoted_text: string | null; book_id: string } | null;

    const { data: book } = m
      ? await admin
          .from("reading_books")
          .select("title, author")
          .eq("id", m.book_id)
          .maybeSingle()
      : { data: null };
    const b = book as { title: string; author: string | null } | null;

    const { data: msgRows } = await admin
      .from("reading_annotation_messages")
      .select("content, user_id, role, created_at")
      .eq("thread_id", threadId)
      .neq("role", "notice")
      .gt("created_at", p.last_read_at ?? "1970-01-01")
      .order("created_at", { ascending: true })
      .limit(5);

    const said = ((msgRows ?? []) as { content: string; user_id: string }[]).filter(
      (x) => x.user_id !== recipientId
    );

    const actorName = (actor.name ?? "").trim().split(/\s+/)[0] || "Someone";
    const isMention = rows.some((r) => r.kind === "mention");
    const bookTitle = b?.title ?? "a book";
    const subject = isMention
      ? `${actorName} left you a note in ${bookTitle}`
      : `${actorName} replied about ${bookTitle}`;

    const url = `${APP_URL}${sharedMarkHref(threadId)}`;
    const quote = m?.quoted_text?.trim() ?? null;

    // No spoiler gate, deliberately. If the passage is ahead of where they are,
    // they can leave the email alone and meet the mark when they get there —
    // which was the decision, and hiding the quote would make the email useless
    // in the common case to protect the rare one.
    const lines = [
      isMention
        ? `${actorName} left you a note in ${bookTitle}${b?.author ? ` by ${b.author}` : ""}.`
        : `${actorName} replied in ${bookTitle}.`,
      "",
      ...(quote ? [`“${quote}”`, ""] : []),
      ...said.map((s) => s.content),
      "",
      `Open it in the book: ${url}`,
      "",
      "You can't reply to this email — the conversation lives in the book.",
    ];

    const html = [
      `<p>${escapeHtml(lines[0])}</p>`,
      ...(quote
        ? [
            `<blockquote style="margin:16px 0;padding-left:12px;border-left:3px solid #ddd;color:#444;font-style:italic">${escapeHtml(quote)}</blockquote>`,
          ]
        : []),
      ...said.map(
        (s) => `<p style="white-space:pre-wrap">${escapeHtml(s.content)}</p>`
      ),
      `<p><a href="${url}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:999px;text-decoration:none">Open it in the book</a></p>`,
      `<p style="color:#888;font-size:12px">You can't reply to this email — the conversation lives in the book.</p>`,
    ].join("\n");

    // Claimed BEFORE the send. At-most-once: losing one email costs a
    // notification, and sending the same one twice costs the credibility of
    // every notification after it.
    const claimed = await claim(admin, rows);
    if (claimed === 0) continue;

    try {
      const ok = await sendMail({
        fromEmail: actor.email,
        fromName: actor.name,
        toEmail: recipient.email,
        subject,
        text: lines.join("\n"),
        html,
        threadKey: `reading-thread-${threadId}`,
      });
      if (ok) sent += 1;
    } catch (err) {
      console.error("[reading-emails] send failed", err);
    }
  }

  return Response.json({
    ok: true,
    groups: groups.size,
    sent,
    skippedRead,
  });
}

/** Take the rows off the queue, and report how many were actually ours to take. */
async function claim(
  admin: ReturnType<typeof createAdminClient>,
  rows: Pending[]
): Promise<number> {
  const { data } = await admin
    .from("reading_annotation_notifications")
    .update({ emailed_at: new Date().toISOString() })
    .in(
      "id",
      rows.map((r) => r.id)
    )
    .is("emailed_at", null)
    .select("id");
  return (data ?? []).length;
}

export const GET = handle;
export const POST = handle;
