import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reads for the parents' Tuttles pages. Everything goes through the caller's
 * cookie client: RLS lets owner/parent read every thread, message and photo,
 * and the middleware keeps everyone else off /tuttles in the first place.
 */

export type ThreadSummary = {
  id: string;
  title: string;
  /** True when there's no title yet and `title` is the first student message. */
  untitled: boolean;
  updatedAt: string;
  archived: boolean;
  messageCount: number;
};

export type StudentThreads = {
  studentId: string;
  name: string;
  threads: ThreadSummary[];
};

const PREVIEW = 90;

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW ? `${flat.slice(0, PREVIEW - 1).trimEnd()}…` : flat;
}

/** Every kid's threads, newest activity first, grouped by kid (most recently active kid first). */
export async function getThreadsByStudent(supabase: SupabaseClient): Promise<StudentThreads[]> {
  const [{ data: threads, error }, { data: members }] = await Promise.all([
    supabase
      .from("tutor_threads")
      .select("id, student_id, title, updated_at, archived_at, tutor_messages(count)")
      .order("updated_at", { ascending: false }),
    supabase.from("family_members").select("user_id, name"),
  ]);
  if (error) throw new Error(`tutor threads: ${error.message}`);
  const rows = threads ?? [];

  // Threads the chat route hasn't titled yet are named by their first message.
  const untitledIds = rows.filter((t) => !t.title).map((t) => t.id as string);
  const firstMessage = new Map<string, string>();
  if (untitledIds.length > 0) {
    const { data: msgs } = await supabase
      .from("tutor_messages")
      .select("thread_id, content, images, created_at")
      .in("thread_id", untitledIds)
      .eq("role", "student")
      .order("created_at", { ascending: true });
    for (const m of msgs ?? []) {
      if (firstMessage.has(m.thread_id)) continue;
      const text = preview(m.content ?? "");
      firstMessage.set(m.thread_id, text || ((m.images as string[] | null)?.length ? "Photo" : ""));
    }
  }

  const names = new Map((members ?? []).map((m) => [m.user_id as string, (m.name as string | null) ?? "Student"]));
  const groups = new Map<string, StudentThreads>();
  for (const t of rows) {
    const studentId = t.student_id as string;
    let group = groups.get(studentId);
    if (!group) {
      group = { studentId, name: names.get(studentId) ?? "Student", threads: [] };
      groups.set(studentId, group);
    }
    const counted = t.tutor_messages as unknown as { count: number }[] | null;
    const fallback = firstMessage.get(t.id) || "New chat";
    group.threads.push({
      id: t.id,
      title: t.title ?? fallback,
      untitled: !t.title,
      updatedAt: t.updated_at,
      archived: t.archived_at != null,
      messageCount: counted?.[0]?.count ?? 0,
    });
  }
  // Rows arrive newest first, so groups are already in most-recently-active order.
  return [...groups.values()];
}

export type ThreadMessage = {
  id: string;
  role: "student" | "tutor";
  content: string;
  createdAt: string;
  /** Signed URLs for the photos on a student message (1 hour). */
  images: { url: string; path: string }[];
};

export type ThreadDetail = {
  id: string;
  title: string | null;
  studentName: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  messages: ThreadMessage[];
};

const SIGNED_URL_SECONDS = 60 * 60;

export async function getThread(supabase: SupabaseClient, threadId: string): Promise<ThreadDetail | null> {
  const { data: thread } = await supabase
    .from("tutor_threads")
    .select("id, student_id, title, created_at, updated_at, archived_at")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return null;

  const [{ data: messages, error }, { data: member }] = await Promise.all([
    supabase
      .from("tutor_messages")
      .select("id, role, content, images, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true }),
    supabase.from("family_members").select("name").eq("user_id", thread.student_id).maybeSingle(),
  ]);
  if (error) throw new Error(`tutor messages: ${error.message}`);

  // One batch for every photo in the thread, signed server-side.
  const paths = [...new Set((messages ?? []).flatMap((m) => (m.images as string[] | null) ?? []))];
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data } = await supabase.storage.from("tuttles").createSignedUrls(paths, SIGNED_URL_SECONDS);
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
  }

  return {
    id: thread.id,
    title: thread.title,
    studentName: (member?.name as string | null) ?? "Student",
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    archived: thread.archived_at != null,
    messages: (messages ?? []).map((m) => ({
      id: m.id,
      role: m.role as "student" | "tutor",
      content: m.content ?? "",
      createdAt: m.created_at,
      images: ((m.images as string[] | null) ?? []).flatMap((path) => {
        const url = signed.get(path);
        return url ? [{ url, path }] : [];
      }),
    })),
  };
}

// --- Times -------------------------------------------------------------------
// Pages render on the server (UTC on Vercel), so times are formatted in the
// family's timezone explicitly.

const TZ = process.env.FAMILY_TIMEZONE || "America/Los_Angeles";

const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });

/** "3:42 PM" today, "Yesterday", "Tue", "Oct 12", "Oct 12, 2025". */
export function formatActivity(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const today = dayKey(now);
  const key = dayKey(d);
  if (key === today) return d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  if (key === yesterday) return "Yesterday";
  const ageDays = (now.getTime() - d.getTime()) / 86_400_000;
  if (ageDays < 6) return d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" });
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** "Thursday, Nov 6 · 3:42 PM" — the time label between turns in a thread. */
export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}
