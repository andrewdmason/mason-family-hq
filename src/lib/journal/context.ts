import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import type {
  JournalAgentFile,
  JournalAgentFileName,
  JournalEntry,
  JournalMessage,
  JournalQuestionType,
  JournalSettings,
} from "@/lib/types";

export type AgentFiles = Record<JournalAgentFileName, string>;

export async function loadAgentFiles(): Promise<AgentFiles> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_agent_files")
    .select("name, content");
  if (error) throw error;

  const files: AgentFiles = { Interviewer: "", Present: "", Past: "" };
  for (const row of (data ?? []) as Pick<JournalAgentFile, "name" | "content">[]) {
    files[row.name] = row.content ?? "";
  }
  return files;
}

export async function loadQuestionTypes(): Promise<JournalQuestionType[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_question_types")
    .select(
      "id, name, base_description, style_note, weight, enabled, is_builtin, sort_order, created_at, updated_at"
    )
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as JournalQuestionType[];
}

/**
 * The shared, owner-authored family context doc. Readable by every member (RLS),
 * so each person's interviewer can know who's in the family. Empty string if
 * unset.
 */
export async function loadFamilyDoc(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("journal_family")
    .select("content")
    .maybeSingle();
  return data?.content ?? "";
}

export async function loadSettings(): Promise<JournalSettings> {
  const supabase = await createClient();
  // One settings row per user — RLS scopes this to the caller's row, so no
  // explicit filter is needed (the old id=1 singleton column is gone).
  const { data, error } = await supabase
    .from("journal_settings")
    .select("questions_per_day")
    .maybeSingle();
  if (error) throw error;
  return { questions_per_day: data?.questions_per_day ?? 3 };
}

type RecentEntry = JournalEntry & { messages: JournalMessage[] };

/** Join a list into "a", "a and b", or "a, b, and c". */
function joinClauses(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * Load entries other than the current one, most recent first.
 * Full conversations for the most recent `fullEntries` entries; one-line
 * summaries for older. Earlier same-day threads count as recent.
 *
 * Scoped to the caller's *own* entries. RLS alone would also surface other
 * family members' shared (family-visible, closed) entries, but those don't
 * belong in this "things you wrote" history — the interviewer would attribute
 * them to the user (e.g. ask a historical-followup about a post a sibling
 * wrote). Another member's shared entry reaches the prompt only through the
 * family-followup question type, which loads it separately and names the author.
 */
export async function loadHistory(
  today: string,
  excludeEntryId: string | null = null,
  fullEntries = 7
) {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  let query = supabase
    .from("journal_entries")
    .select(
      "id, entry_date, status, opening_question, opening_candidates, candidates_reroll_count, summary, title, pull_quote, summary_stale, closed_at, created_at, updated_at"
    )
    .eq("user_id", userId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);
  if (excludeEntryId) {
    query = query.neq("id", excludeEntryId);
  } else {
    // No current entry — fall back to "everything before today" so we don't
    // accidentally pull in an in-progress entry from elsewhere.
    query = query.lt("entry_date", today);
  }

  const { data: entriesData, error } = await query;
  if (error) throw error;

  const entries = (entriesData ?? []) as JournalEntry[];
  const recentEntries = entries.slice(0, fullEntries);
  const olderEntries = entries.slice(fullEntries);

  let recent: RecentEntry[] = [];
  if (recentEntries.length > 0) {
    const ids = recentEntries.map((e) => e.id);
    const { data: msgs, error: msgErr } = await supabase
      .from("journal_messages")
      .select("id, entry_id, role, content, created_at")
      .in("entry_id", ids)
      .order("created_at", { ascending: true });
    if (msgErr) throw msgErr;

    const byEntry = new Map<string, JournalMessage[]>();
    for (const m of (msgs ?? []) as JournalMessage[]) {
      const arr = byEntry.get(m.entry_id) ?? [];
      arr.push(m);
      byEntry.set(m.entry_id, arr);
    }
    recent = recentEntries.map((e) => ({ ...e, messages: byEntry.get(e.id) ?? [] }));
  }

  return { recent, older: olderEntries };
}

/**
 * Which source sections to include in the prompt. The follow-up/summary turns
 * want everything (the defaults); the opening-question picker scopes each
 * category to just the sources it's allowed to draw on, so a type can't drift
 * onto data it has no business asking about (see opening-candidates.ts).
 */
export type PromptScope = {
  includePresent?: boolean;
  includePast?: boolean;
  includeHistory?: boolean;
};

/**
 * Assemble the system prompt for the interviewer turn (opening question or follow-up).
 */
export function buildSystemPrompt(
  files: AgentFiles,
  history: { recent: RecentEntry[]; older: JournalEntry[] },
  today: string,
  calendarBlock?: string | null,
  nowLabel?: string | null,
  familyDoc?: string | null,
  scope: PromptScope = {}
): string {
  const includePresent = scope.includePresent ?? true;
  const includePast = scope.includePast ?? true;
  const includeHistory = scope.includeHistory ?? true;
  const hasPast = includePast && !!files.Past && files.Past.trim().length > 0;

  const sections: string[] = [];

  sections.push(
    "You are the journal interviewer for a single user. A few editable files describe you and the user; everything else is internal protocol."
  );
  const grounds = ["Interviewer (your voice and how you ask — not which topics to pick)"];
  if (includePresent) {
    grounds.push("Present (who the user is now — their current life, people, and projects)");
  }
  if (hasPast) grounds.push("Past (their life story and memories)");
  sections.push(
    `Before responding, ground yourself in ${joinClauses(grounds)}. Which kinds of questions to ask, and how often, is decided separately and handed to you below; the Interviewer file only governs voice and craft.`
  );
  sections.push(
    "Never mention these files, your tools, or your reasoning to the user. The user only sees your message."
  );
  sections.push("");
  sections.push("=== Interviewer ===");
  sections.push(files.Interviewer || "(empty)");
  sections.push("");
  if (includePresent) {
    sections.push("=== Present ===");
    sections.push(
      files.Present || "(empty — the user hasn't filled this out yet)"
    );
    sections.push("");
  }

  if (hasPast) {
    sections.push("=== Past ===");
    sections.push(
      "The user's life story and memories. Draw on it for reminiscence questions and to reference their history naturally; don't re-ask about what's already here."
    );
    sections.push(files.Past);
    sections.push("");
  }

  if (familyDoc && familyDoc.trim().length > 0) {
    sections.push("=== Family ===");
    sections.push(
      "Shared context about the user's family, authored by the family's owner. Use it to know who's around them; don't re-ask about people already described here."
    );
    sections.push(familyDoc);
    sections.push("");
  }

  if (calendarBlock && calendarBlock.trim().length > 0) {
    sections.push(calendarBlock);
    sections.push("");
  }

  if (includeHistory && history.recent.length > 0) {
    sections.push("=== Recent journal entries (full transcripts, most recent first) ===");
    for (const entry of history.recent) {
      sections.push(`--- ${entry.entry_date}${entry.summary ? ` — ${entry.summary}` : ""} ---`);
      for (const m of entry.messages) {
        sections.push(`${m.role === "assistant" ? "Interviewer" : "User"}: ${m.content}`);
      }
      sections.push("");
    }
  }

  if (includeHistory && history.older.length > 0) {
    sections.push("=== Older entries (one-line summaries) ===");
    for (const e of history.older) {
      sections.push(`${e.entry_date}: ${e.summary ?? "(no summary)"}`);
    }
    sections.push("");
  }

  if (nowLabel) {
    let line = `Right now it's ${nowLabel}. Use this to judge whether a calendar event has already happened or is still upcoming — an event later today has not happened yet.`;
    if (calendarBlock && calendarBlock.trim().length > 0) {
      line +=
        ` Each calendar event is listed under the exact day it falls on (Yesterday, Today, and so on); always refer to an event by that day. Never restate an event as a different day to fit the question you want to ask — don't call a Today event "yesterday" or "last night", and don't move a Yesterday event onto today.`;
    }
    sections.push(line);
  } else {
    sections.push(`Today's date: ${today}.`);
  }

  return sections.join("\n");
}

export function messagesAsAnthropicTurns(
  messages: Pick<JournalMessage, "role" | "content">[]
) {
  return messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
}
