import "server-only";

import { after } from "next/server";
import { anthropic } from "@/lib/journal/anthropic";
import { CONCISE_TITLE_GUIDANCE } from "@/lib/journal/opening-candidates";
import { createAdminClient } from "@/lib/supabase/admin";
import { READER_CHAT_FAST_MODEL } from "@/lib/reading/chat-prompt";

/**
 * A name for a conversation in the margin.
 *
 * The notepad shows a conversation as a single line wearing its name — "Why
 * the maestro is late" — and the marks list leads with it. The name comes
 * from here: made from the reader's opening line the moment a thread starts
 * (so the block settles a second or two after Enter), and remade after each
 * reply from somebody OTHER than the reader — the AI, or a person they
 * brought in — since that is when the conversation moves.
 *
 * Remade, but not restlessly. A name that changes on every turn is worse
 * than a stale one, because the outline stops being a landmark: the model is
 * shown the current name and told to return it unchanged unless the subject
 * has genuinely shifted. And a name the reader wrote themselves (title_pinned)
 * is never touched at all.
 *
 * Every entry point fails soft. A missing key, a rate limit, a malformed
 * reply: logged, and the thread keeps whatever name it had. A conversation
 * with no name is a conversation showing its first question, which is what
 * it showed before names existed.
 */

/** Longer than a line of the notepad can show; anything past this is cut. */
const TITLE_MAX_CHARS = 60;

/** How many turns the model is shown when renaming. Recent ones say where it went. */
const TRANSCRIPT_TURNS = 8;
const TURN_MAX_CHARS = 1500;

const TITLE_TOOL = {
  name: "set_thread_title",
  description:
    "Name a conversation a reader is having in the margin of a book — with the " +
    "book's AI, or with a family member they showed the passage to.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description:
          `${CONCISE_TITLE_GUIDANCE} Name what the conversation is ABOUT — the ` +
          "question or the idea — never the book or the act of asking " +
          '("A question about…", "Discussion of…" are wrong). Max 60 characters.',
      },
    },
    required: ["title"],
  },
};

export type TitleTurn = { role: "user" | "assistant" | "note"; content: string };

/**
 * The name, from the opening and whatever has been said since. Null when
 * nothing usable came back.
 */
export async function generateThreadTitle(input: {
  opening: string;
  transcript: TitleTurn[];
  current: string | null;
}): Promise<string | null> {
  const opening = input.opening.trim();
  if (!opening && input.transcript.length === 0) return null;

  const lines: string[] = [];
  if (input.current) {
    lines.push(
      `Current title: "${input.current}"`,
      "Return it exactly unchanged unless the subject of the conversation has genuinely shifted since it was named.",
      ""
    );
  }
  if (opening) lines.push("The reader opened with:", opening, "");
  if (input.transcript.length > 0) {
    lines.push("The conversation since:");
    for (const t of input.transcript) {
      const who = t.role === "assistant" ? "AI" : t.role === "note" ? "Reader (note)" : "Reader";
      lines.push(`${who}: ${clip(t.content, TURN_MAX_CHARS)}`);
    }
  }

  try {
    const message = await anthropic().messages.create({
      model: READER_CHAT_FAST_MODEL,
      max_tokens: 128,
      system:
        "You name conversations a reader is having in the margin of a book. " +
        "Call set_thread_title exactly once.",
      tools: [TITLE_TOOL],
      tool_choice: { type: "tool", name: TITLE_TOOL.name },
      messages: [{ role: "user", content: lines.join("\n") }],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;
    const raw = (toolUse.input as { title?: unknown }).title;
    return cleanTitle(typeof raw === "string" ? raw : "");
  } catch (err) {
    console.error(
      "[reader/thread-title] Anthropic call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

/** A title as it may be stored: trimmed, unquoted, no end punctuation, cut to fit. */
export function cleanTitle(raw: string): string | null {
  let t = raw.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").replace(/[.。]+$/, "").trim();
  if (!t) return null;
  if (t.length > TITLE_MAX_CHARS) t = `${t.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`;
  return t;
}

function clip(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Name, or rename, a thread — reading what it needs and writing the result.
 *
 * On the admin client: this runs after the response, outside any request's
 * session, and the thread may belong to a conversation the reader was
 * brought into rather than one they made. Nothing is exposed by that — the
 * only thing written is a name, onto a row that already exists.
 *
 * `seed` is the opening line when the caller has it in hand and the message
 * hasn't landed yet (an Ask's first message goes out from the thread itself,
 * after the row is made).
 */
export async function refreshThreadTitle(
  threadId: string,
  opts: { seed?: string | null } = {}
): Promise<void> {
  try {
    const db = createAdminClient();
    const { data: thread } = await db
      .from("reading_annotation_threads")
      .select("title, title_pinned")
      .eq("id", threadId)
      .maybeSingle();
    if (!thread) return;
    const row = thread as { title: string | null; title_pinned: boolean };
    if (row.title_pinned) return;

    const { data: rows } = await db
      .from("reading_annotation_messages")
      .select("role, content, created_at")
      .eq("thread_id", threadId)
      .in("role", ["user", "assistant", "note"])
      .order("created_at", { ascending: true });
    const messages = ((rows ?? []) as { role: string; content: string }[]).map((m) => ({
      role: (m.role === "assistant" ? "assistant" : m.role === "note" ? "note" : "user") as TitleTurn["role"],
      content: m.content,
    }));

    const seed = opts.seed?.trim() || null;
    const firstOwn = messages.find((m) => m.role !== "assistant")?.content ?? null;
    const opening = seed ?? firstOwn ?? "";
    // The opening is said once, above; the transcript is what came after it.
    const rest = firstOwn && !seed ? messages.slice(1) : messages;
    const transcript = rest.slice(-TRANSCRIPT_TURNS);

    const title = await generateThreadTitle({ opening, transcript, current: row.title });
    if (!title || title === row.title) return;

    // Pinned in the meantime — the reader typed a name while this ran — and
    // theirs wins. The filter makes the race harmless.
    await db
      .from("reading_annotation_threads")
      .update({ title })
      .eq("id", threadId)
      .eq("title_pinned", false);
  } catch (err) {
    console.error(
      "[reader/thread-title] couldn't name the thread:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Name the thread behind the response, so the reader isn't kept waiting on
 * a name they haven't asked for. The same shape thread-mentions.ts uses:
 * `after` inside a request, inline when there is no request to be after.
 */
export function scheduleTitleRefresh(threadId: string, opts: { seed?: string | null } = {}): void {
  const work = () => refreshThreadTitle(threadId, opts);
  try {
    after(work);
  } catch {
    void work();
  }
}
