import { createClient } from "@/lib/supabase/server";
import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import {
  buildSystemPrompt,
  loadAgentFiles,
  loadCurrentUserIdentity,
  loadTimelineBlock,
  loadFamilyDoc,
  loadHistory,
  messagesAsAnthropicTurns,
} from "@/lib/journal/context";
import { loadCalendarBlock } from "@/lib/journal/calendar";
import { formatNow, getUserTimezone, localDate } from "@/lib/date-utils";
import type { JournalMessage } from "@/lib/types";

const TOOLS = [
  {
    name: "write_wrap",
    description:
      "Wrap today's entry. Produces two things at once:\n\n" +
      "• `summary`: the entry's subtitle in the journal list — make it read well at a glance. Its STYLE depends on whether this entry is SHARED with the family or PERSONAL to the writer (you are told which in the wrap instructions below):\n" +
      "    – SHARED → one evocative sentence in the spirit of a New Yorker article's subtitle. Set the scene, or name the turning point of what happened; present or timeless tense. Do NOT narrate the conversation ('Talked about…', 'Described…', 'Reflected on…', 'Recounted…'). Use people's real first names — never 'a boy', 'an engineer', 'a fifth grader'. One sentence; leave a little unsaid. e.g. \"The umpire never showed, so Sebastian and Theo stepped behind the plate — and an ordinary Saturday turned into the season's best.\"\n" +
      "    – PERSONAL → a short, semicolon-separated list of the topics and ideas the writer moved through. NOT a sentence — a list. Sentence case (capitalize the first word of each item; keep proper nouns). At most 4 items. Use real first names. e.g. \"Saying 'retired' out loud; The fear of the label; Fading anxiety about unproductive days; A growing allergy to busywork\".\n\n" +
      "• `pull_quote` (optional): a short verbatim line — 5 to 18 words — taken from something the user actually said in the conversation. Pick the most striking, vulnerable, or specific moment. Do not paraphrase. Do not include attribution. Skip entirely if the user didn't say anything worth pulling (e.g. mostly one-word answers, dismissed without engaging).\n\n" +
      "Do NOT write a title — the writer titles the entry themselves.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: { type: "string" },
        pull_quote: { type: "string" },
      },
      required: ["summary"],
    },
  },
  {
    name: "suggest_profile_update",
    description:
      "Propose a SINGLE change to the user's Present profile doc. The user reviews your suggestion as a toast and decides whether to apply it; you never edit a file yourself.\n\n" +
      "Present — who the user is NOW: their current life, the people around them, projects, interests, routines. (Biographical history lives in the user's timeline, which they maintain separately — don't try to record past events here.)\n\n" +
      "The bar is HIGH. Only suggest a change when today's conversation revealed something FUNDAMENTAL and durable about their present: a new project, role, or commitment; a significant life/work/relationship change; or a fact already in the Present doc that is now stale and should be corrected or removed.\n\n" +
      "Do NOT suggest a change for: every person mentioned, passing moods, one-off events, minor details, or anything already captured in the Present doc. Most entries warrant no suggestion at all — when in doubt, don't call this tool.\n\n" +
      "Call it at most ONCE. Never propose changes to the Interviewer file.\n\n" +
      "Fields:\n" +
      "  • change_type: 'add' (append new text), 'edit' (replace existing text), or 'remove' (delete existing text).\n" +
      "  • For 'edit'/'remove', `find` must be an exact, unique substring of the Present doc.\n" +
      "  • For 'add'/'edit', `replace` is the new text (a short markdown line/sentence in the doc's style).\n" +
      "  • summary: one short sentence, phrased as a question the user can accept or wave off (e.g. 'Want me to note that you've started teaching a weekly chamber-music class?').",
    input_schema: {
      type: "object" as const,
      properties: {
        change_type: { type: "string", enum: ["add", "edit", "remove"] },
        find: {
          type: "string",
          description: "Exact existing substring to edit or remove. Omit for 'add'.",
        },
        replace: {
          type: "string",
          description: "New text for 'add' or 'edit'. Omit for 'remove'.",
        },
        summary: {
          type: "string",
          description: "One short sentence, phrased as a question, shown to the user in the toast.",
        },
      },
      required: ["change_type", "summary"],
    },
  },
];

export type WrapResult =
  | { ok: true; summary: string | null; suggestionCreated: boolean }
  | { ok: false; error: string; status: number };

/**
 * Generate the summary/pull_quote wrap for a closed entry and write it to the
 * DB. The title is the writer's own and is never touched. Idempotent — safe to
 * re-run, which is how the regenerate action recovers entries whose original
 * fire-and-forget wrap never landed (and backfills summaries on older posts).
 */
export async function runWrap(entryId: string): Promise<WrapResult> {
  const supabase = await createClient();

  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .select("id, entry_date, status, summary, title, user_id, visibility")
    .eq("id", entryId)
    .single();
  if (entryErr || !entry) {
    return { ok: false, error: "entry not found", status: 404 };
  }
  // The entry is flipped to "closed" by the closeEntry action before the
  // wrap pass runs, so the journal list can show its "generating" state.
  if (entry.status !== "closed") {
    return { ok: false, error: "entry is not closed", status: 409 };
  }

  const { data: msgs, error: msgsErr } = await supabase
    .from("journal_messages")
    .select("id, entry_id, role, content, created_at")
    .eq("entry_id", entryId)
    .order("created_at", { ascending: true });
  if (msgsErr) {
    return { ok: false, error: msgsErr.message, status: 500 };
  }
  const thread = (msgs ?? []) as JournalMessage[];
  if (thread.length === 0) {
    return { ok: false, error: "cannot close empty entry", status: 400 };
  }

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);
  const [files, userIdentity, history, calendarBlock, familyDoc, timelineBlock] = await Promise.all([
    loadAgentFiles(),
    loadCurrentUserIdentity(),
    loadHistory(today, entryId),
    loadCalendarBlock(today, tz),
    loadFamilyDoc(),
    loadTimelineBlock(today),
  ]);
  const baseSystem = buildSystemPrompt(
    files,
    history,
    today,
    calendarBlock,
    formatNow(new Date(), tz),
    familyDoc,
    timelineBlock,
    { userIdentity }
  );

  // Recently dismissed suggestions — so the model doesn't re-raise something
  // the user has already waved off.
  const { data: dismissed } = await supabase
    .from("journal_profile_suggestions")
    .select("summary")
    .eq("status", "dismissed")
    .order("resolved_at", { ascending: false })
    .limit(20);
  const dismissedBlock =
    dismissed && dismissed.length > 0
      ? `\n\nThe user has already declined these suggestions — do not raise them again:\n${dismissed
          .map((d: { summary: string }) => `- ${d.summary}`)
          .join("\n")}`
      : "";

  // The summary's style branches on who the entry is for: a SHARED entry gets a
  // New Yorker-style scene/turn subtitle; a PERSONAL one gets a semicolon list of
  // topics. Tell the model which this is so it picks the right style.
  const styleLine =
    entry.visibility === "family"
      ? "This entry is SHARED with the family — write its `summary` in the SHARED style (a New Yorker-style subtitle)."
      : "This entry is PERSONAL to the writer — write its `summary` in the PERSONAL style (a semicolon-separated list of topics).";

  const system =
    baseSystem +
    `\n\n=== Wrap pass ===
The user has finished today's entry. ${styleLine}

1. Call \`write_wrap\` exactly once. It produces a summary and (optionally) a verbatim pull quote from something the user said. See the tool description for the bar on each. Do not write a title — the user titles the entry themselves.

2. Then, only if warranted, call \`suggest_profile_update\` exactly once to propose a single change to the user's Present doc (their current life). The bar is high — see the tool description. Most entries warrant no suggestion. You never edit any file yourself; the user reviews the suggestion as a toast and decides. Never propose Interviewer changes. Do not propose anything already captured in the Present doc.${dismissedBlock}

After your tool calls, you may stop. The user does not see the wrap output.`;

  const turns = messagesAsAnthropicTurns(thread);
  // Anthropic requires the messages array to end with a user turn. If the
  // user closed without replying to the AI's last question, append a
  // synthetic closer so the wrap pass can run.
  if (turns.length === 0 || turns[turns.length - 1].role === "assistant") {
    turns.push({ role: "user", content: "(I'm done for today.)" });
  }

  const client = anthropic();
  let result;
  try {
    result = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 2048,
      system,
      tools: TOOLS,
      // Force a tool call. The system prompt is the empathetic interviewer
      // persona; with the default "auto" the model can answer a heavy entry
      // with caring prose instead of calling write_wrap, leaving the entry
      // with no summary. "any" still allows suggest_profile_update alongside it.
      tool_choice: { type: "any" },
      messages: turns,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[journal/wrap] Anthropic call failed:", msg);
    return { ok: false, error: `Claude call failed: ${msg}`, status: 502 };
  }

  let summary: string | null = null;
  let pullQuote: string | null = null;
  let suggestion: {
    target_doc: "Present";
    change_type: "add" | "edit" | "remove";
    find: string | null;
    replace: string | null;
    summary: string;
  } | null = null;

  for (const block of result.content) {
    if (block.type !== "tool_use") continue;
    const input = block.input as Record<string, unknown>;
    if (block.name === "write_wrap") {
      if (typeof input.summary === "string") summary = input.summary.trim();
      if (typeof input.pull_quote === "string") {
        const q = input.pull_quote.trim().replace(/^["“]|["”]$/g, "");
        pullQuote = q.length > 0 ? q : null;
      }
    } else if (block.name === "suggest_profile_update") {
      const changeType = input.change_type;
      const sugSummary =
        typeof input.summary === "string" ? input.summary.trim() : "";
      const find = typeof input.find === "string" ? input.find : null;
      const replace = typeof input.replace === "string" ? input.replace : null;
      // Present is the only profile doc now (biographical history moved to the
      // timeline), so suggestions always target it.
      const targetDoc = "Present" as const;
      // Only keep a well-formed suggestion: a summary, a valid type, and the
      // fields that type requires.
      const validType =
        changeType === "add" || changeType === "edit" || changeType === "remove";
      const hasRequiredFields =
        (changeType === "add" && !!replace) ||
        (changeType === "edit" && !!find && replace !== null) ||
        (changeType === "remove" && !!find);
      // Keep only the first suggestion if the model called the tool twice.
      if (sugSummary && validType && hasRequiredFields && !suggestion) {
        suggestion = {
          target_doc: targetDoc,
          change_type: changeType,
          find,
          replace,
          summary: sugSummary,
        };
      }
    }
  }

  // write_wrap requires a summary, so a missing one means the model never called
  // it. Treat that as a failure rather than silently writing nothing — otherwise
  // the entry lands in the list with no subtitle and no signal to the user.
  if (!summary) {
    console.error(
      "[journal/wrap] model returned no write_wrap call for entry",
      entryId
    );
    return {
      ok: false,
      error: "the model didn't produce a summary — try again",
      status: 502,
    };
  }

  // The title is the writer's own — the wrap never touches it. We only write the
  // summary (the list subtitle) and the optional pull quote.
  const update: Record<string, unknown> = { summary_stale: false };
  if (summary !== null) update.summary = summary;
  // pull_quote can be set to null explicitly when the AI chose not to surface one
  update.pull_quote = pullQuote;
  await supabase.from("journal_entries").update(update).eq("id", entryId);

  // Record at most one profile-update suggestion for the user to accept or
  // dismiss via a toast. We never modify the User doc here. Guard against
  // re-closing the same entry (or a wrap regenerate) re-raising a suggestion
  // the user may have already dismissed: skip if any row already exists for
  // this entry.
  let suggestionCreated = false;
  if (suggestion) {
    const { data: prior } = await supabase
      .from("journal_profile_suggestions")
      .select("id")
      .eq("source_entry_id", entryId)
      .limit(1);
    if (!prior || prior.length === 0) {
      await supabase.from("journal_profile_suggestions").insert({
        source_entry_id: entryId,
        user_id: entry.user_id,
        status: "pending",
        target_doc: suggestion.target_doc,
        change_type: suggestion.change_type,
        find: suggestion.find,
        replace: suggestion.replace,
        summary: suggestion.summary,
      });
      suggestionCreated = true;
    }
  }

  return { ok: true, summary, suggestionCreated };
}
