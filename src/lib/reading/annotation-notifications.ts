import "server-only";

import type { createClient } from "@/lib/supabase/server";
import type { JournalNotification } from "@/lib/types";
import { listRoster } from "@/lib/members/roster";
import { sharedMarkHref } from "@/lib/reading/links";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Bell items for shared marks: conversations in a book with something in them
 * you haven't read.
 *
 * Same shape as the todos and journal sources so the header can merge them
 * without knowing what any of them are.
 *
 * Deliberately derived on every render rather than read from the outbox. The
 * outbox is about EMAIL — what has been sent, what must not be sent twice — and
 * a bell that read from it would go quiet the moment an email went out, which is
 * backwards. What belongs in the bell is simply "is there something here I
 * haven't seen", and the participant row already knows.
 */
export async function getAnnotationNotifications(
  supabase: Supabase,
  userId: string
): Promise<JournalNotification[]> {
  const { data: mine } = await supabase
    .from("reading_annotation_thread_participants")
    .select("thread_id, annotation_id, last_read_at")
    .eq("user_id", userId)
    .eq("muted", false);

  const rows = (mine ?? []) as {
    thread_id: string;
    annotation_id: string | null;
    last_read_at: string | null;
  }[];
  if (rows.length === 0) return [];

  // Only conversations somebody ELSE is in. A thread of one is every ordinary
  // mark in the library, and there are thousands of them.
  const { data: rosterRows } = await supabase
    .from("reading_annotation_thread_participants")
    .select("thread_id, user_id")
    .in(
      "thread_id",
      rows.map((r) => r.thread_id)
    );

  const counts = new Map<string, string[]>();
  for (const r of (rosterRows ?? []) as { thread_id: string; user_id: string }[]) {
    counts.set(r.thread_id, [...(counts.get(r.thread_id) ?? []), r.user_id]);
  }
  const shared = rows.filter((r) => (counts.get(r.thread_id) ?? []).length > 1);
  if (shared.length === 0) return [];

  const { data: msgRows } = await supabase
    .from("reading_annotation_messages")
    .select("thread_id, user_id, role, content, created_at")
    .in(
      "thread_id",
      shared.map((r) => r.thread_id)
    )
    .neq("user_id", userId)
    .neq("role", "notice")
    .order("created_at", { ascending: false });

  const msgs = (msgRows ?? []) as {
    thread_id: string;
    user_id: string;
    content: string;
    created_at: string;
  }[];

  const placedIds = shared
    .map((r) => r.annotation_id)
    .filter((id): id is string => id != null);

  const { data: markRows } = placedIds.length
    ? await supabase
        .from("reading_annotations")
        .select("id, thread_id, quoted_text, book_id")
        .in("id", placedIds)
    : { data: [] };

  const marks = new Map(
    ((markRows ?? []) as {
      id: string;
      thread_id: string;
      quoted_text: string | null;
      book_id: string;
    }[]).map((m) => [m.thread_id, m])
  );

  const bookIds = [...new Set([...marks.values()].map((m) => m.book_id))];
  const { data: bookRows } = bookIds.length
    ? await supabase.from("reading_books").select("id, title").in("id", bookIds)
    : { data: [] };
  const titles = new Map(
    ((bookRows ?? []) as { id: string; title: string }[]).map((b) => [b.id, b.title])
  );

  const roster = await listRoster();
  const nameOf = (uid: string) => {
    const m = roster.find((r) => r.userId === uid);
    return (m?.name ?? "").trim().split(/\s+/)[0] || "Someone";
  };

  const items: JournalNotification[] = [];
  for (const r of shared) {
    const since = r.last_read_at;
    const unread = msgs.filter(
      (m) => m.thread_id === r.thread_id && (!since || m.created_at > since)
    );
    if (unread.length === 0) continue;

    const mark = marks.get(r.thread_id);
    const title =
      mark?.quoted_text?.trim().slice(0, 90) ??
      (mark ? titles.get(mark.book_id) : null) ??
      "A shared passage";
    const who = nameOf(unread[0].user_id);
    const book = mark ? titles.get(mark.book_id) : null;

    // Being brought into a conversation is not "12 new messages", even though
    // twelve of them are technically unread — you have just been handed the
    // whole thing. Who invited you is the useful fact; the count only starts
    // meaning something once you have read it once.
    const invited = since == null;

    items.push({
      id: `reading-thread-${r.thread_id}`,
      title,
      reason:
        invited || unread.length === 1
          ? `${who}${book ? ` in ${book}` : ""}`
          : `${unread.length} new${book ? ` in ${book}` : ""}`,
      href: sharedMarkHref(r.thread_id),
    });
  }

  return items.slice(0, 10);
}
