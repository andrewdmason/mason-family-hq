import { createAdminClient } from "@/lib/supabase/admin";
import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import {
  buildSystemPrompt,
  messagesAsAnthropicTurns,
  type AgentFiles,
  type CurrentUserIdentity,
} from "@/lib/journal/context";
import { WRITE_WRAP_TOOL, summaryStyleLine } from "@/lib/journal/wrap";
import { CONCISE_TITLE_GUIDANCE } from "@/lib/journal/opening-candidates";
import type { JournalMessage, MemberRole } from "@/lib/types";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * The author's context for a re-wrap, loaded with the service role so the owner
 * can regenerate any member's posts. This is the same material a live wrap
 * builds from `loadAgentFiles`/`loadCurrentUserIdentity`/`loadFamilyDoc`, but
 * scoped to an explicit user_id instead of the signed-in caller. Calendar,
 * timeline, and history are deliberately left out: a backfill summarizes a
 * finished transcript, so that ambient context adds latency without changing
 * the subtitle.
 */
async function loadAuthorContext(
  admin: Admin,
  userId: string
): Promise<{ files: AgentFiles; identity: CurrentUserIdentity; familyDoc: string }> {
  const [{ data: fileRows }, { data: member }, { data: family }] = await Promise.all([
    admin.from("journal_agent_files").select("name, content").eq("user_id", userId),
    admin.from("family_members").select("name, email, role").eq("user_id", userId).maybeSingle(),
    admin.from("journal_family").select("content").eq("id", 1).maybeSingle(),
  ]);

  const files: AgentFiles = { Interviewer: "", Present: "" };
  for (const row of (fileRows ?? []) as { name: keyof AgentFiles; content: string | null }[]) {
    files[row.name] = row.content ?? "";
  }
  return {
    files,
    identity: {
      name: (member?.name as string | null) ?? null,
      email: (member?.email as string | null) ?? null,
      role: (member?.role as MemberRole | null) ?? null,
    },
    familyDoc: (family?.content as string | null) ?? "",
  };
}

/**
 * Re-run the summary/pull_quote wrap for one closed standard entry using the new
 * visibility-branched style, in the entry author's own context. Returns true if
 * the entry's summary was rewritten. Skips non-standard or non-closed entries
 * and empty threads. Never touches the title.
 */
export async function backfillEntrySummary(entryId: string): Promise<boolean> {
  const admin = createAdminClient();

  const { data: entry } = await admin
    .from("journal_entries")
    .select("id, status, entry_type, visibility, user_id, entry_date")
    .eq("id", entryId)
    .single();
  if (!entry || entry.status !== "closed" || entry.entry_type !== "standard") {
    return false;
  }

  const { data: msgs } = await admin
    .from("journal_messages")
    .select("id, entry_id, role, content, created_at")
    .eq("entry_id", entryId)
    .order("created_at", { ascending: true });
  const thread = (msgs ?? []) as JournalMessage[];
  if (thread.length === 0) return false;

  const { files, identity, familyDoc } = await loadAuthorContext(
    admin,
    entry.user_id as string
  );

  const baseSystem = buildSystemPrompt(
    files,
    { recent: [], older: [] },
    entry.entry_date as string,
    null,
    null,
    familyDoc,
    null,
    { userIdentity: identity, includeTimeline: false, includeHistory: false }
  );
  const system =
    baseSystem +
    `\n\n=== Wrap pass ===\nThis entry is already written; you're only (re)writing its subtitle. ${summaryStyleLine(
      entry.visibility as string
    )}\n\nCall \`write_wrap\` exactly once to produce the summary (and an optional pull quote). Do not write a title.`;

  const turns = messagesAsAnthropicTurns(thread);
  if (turns.length === 0 || turns[turns.length - 1].role === "assistant") {
    turns.push({ role: "user", content: "(I'm done for today.)" });
  }

  const message = await anthropic().messages.create({
    model: JOURNAL_MODEL,
    max_tokens: 1024,
    system,
    tools: [WRITE_WRAP_TOOL],
    tool_choice: { type: "tool", name: WRITE_WRAP_TOOL.name },
    messages: turns,
  });

  let summary: string | null = null;
  let pullQuote: string | null = null;
  for (const block of message.content) {
    if (block.type !== "tool_use" || block.name !== WRITE_WRAP_TOOL.name) continue;
    const input = block.input as Record<string, unknown>;
    if (typeof input.summary === "string") summary = input.summary.trim();
    if (typeof input.pull_quote === "string") {
      const q = input.pull_quote.trim().replace(/^["“]|["”]$/g, "");
      pullQuote = q.length > 0 ? q : null;
    }
  }
  if (!summary) return false;

  await admin
    .from("journal_entries")
    .update({ summary, pull_quote: pullQuote, summary_stale: false })
    .eq("id", entryId);
  return true;
}

/**
 * Regenerate the short title of one question post from its opening question,
 * using the current sentence-case title guidance. Returns true if a title was
 * written. The title is derived from the question alone — exactly the material
 * the live picker had when it first titled the entry.
 */
export async function backfillQuestionTitle(entryId: string): Promise<boolean> {
  const admin = createAdminClient();

  const { data: entry } = await admin
    .from("journal_entries")
    .select("id, opening_question, entry_type")
    .eq("id", entryId)
    .single();
  const question = (entry?.opening_question as string | null)?.trim();
  if (!entry || entry.entry_type !== "standard" || !question) return false;

  const message = await anthropic().messages.create({
    model: JOURNAL_MODEL,
    max_tokens: 64,
    system:
      "You title a journal entry from the question it answers. " +
      CONCISE_TITLE_GUIDANCE +
      " Reply with ONLY the title — no preamble, no quotation marks.",
    messages: [{ role: "user", content: `Question: ${question}` }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  let title = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
  // Strip stray wrapping quotes / trailing sentence punctuation the model may add.
  title = title.replace(/^["“”']+/, "").replace(/["“”'.!?]+$/, "").trim();
  if (!title) return false;

  await admin.from("journal_entries").update({ title }).eq("id", entryId);
  return true;
}
