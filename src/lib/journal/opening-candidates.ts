import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import {
  buildSystemPrompt,
  loadAgentFiles,
  loadFamilyDoc,
  loadHistory,
  loadQuestionTypes,
  loadSettings,
} from "@/lib/journal/context";
import { loadCalendarBlock } from "@/lib/journal/calendar";
import type { CalendarWindow } from "@/lib/journal/calendar/types";
import { FAMILY_FOLLOWUP, specFor } from "@/lib/journal/question-sources";
import { formatNow, localDate, resolveTimezone } from "@/lib/date-utils";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import type { JournalOpeningCandidate, JournalQuestionType } from "@/lib/types";

export const OPENING_CANDIDATES_TOOL_NAME = "propose_questions";

/**
 * The candidate tool's shape depends on how many questions the user wants each
 * day, so we build it per request rather than as a module constant.
 */
export function buildOpeningCandidatesTool(n: number) {
  return {
    name: OPENING_CANDIDATES_TOOL_NAME,
    description:
      `Propose exactly ${n} opening question(s) for today's journal entry. The ` +
      "user will see all of them and pick the one they want to answer.",
    input_schema: {
      type: "object" as const,
      properties: {
        questions: {
          type: "array",
          minItems: n,
          maxItems: n,
          description: `Exactly ${n} genuinely different question(s).`,
          items: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description:
                  "ONLY the question itself as the user will read it, in your voice — one or two sentences. Never include your reasoning, the category name, or any explanation of how or why you chose it or whether a constraint could be met.",
              },
              visibility: {
                type: "string",
                enum: ["private", "family"],
                description:
                  "Where an entry answering this question would most naturally go: \"family\" if it's about a shared moment, event, or something the family would enjoy seeing (always for family-followup questions); \"private\" for intimate, introspective, or sensitive reflections. This only pre-selects a toggle the user can change — default to \"private\" when unsure.",
              },
            },
            required: ["text", "visibility"],
          },
        },
      },
      required: ["questions"],
    },
  };
}

/**
 * Window (in days) of recently-shown-but-not-picked questions fed back to the
 * model as a soft avoid.
 */
const RECENTLY_SHOWN_DAYS = 14;

export type QuestionCategory = {
  name: string;
  description: string;
  weight: number;
};

/**
 * Build a `QuestionCategory` from a stored question type, folding the user's
 * free-text style note onto the locked base description.
 */
export function questionTypeToCategory(t: JournalQuestionType): QuestionCategory {
  return {
    name: t.name,
    description: t.base_description + (t.style_note.trim() ? " " + t.style_note.trim() : ""),
    weight: t.weight,
  };
}

/**
 * Weighted sample without replacement. The LLM is bad at honouring a
 * probability distribution across N=3 picks (it converges on the top-K
 * categories every morning), so we do the sampling in code and just tell the
 * model which three categories it got today.
 */
export function sampleQuestionMix(
  categories: QuestionCategory[],
  n: number,
  rand: () => number = Math.random
): QuestionCategory[] {
  const pool = categories.slice();
  const picks: QuestionCategory[] = [];
  while (picks.length < n && pool.length > 0) {
    const total = pool.reduce((s, c) => s + c.weight, 0);
    if (total <= 0) break;
    let r = rand() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    picks.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picks;
}

const VOICE_NOTE =
  "Each question should still sound like you (see the Interviewer file): one or two sentences, warm, like a friend texting in the morning. Each question's text is exactly what the user reads — never narrate your reasoning, name the category, or explain your choice inside it. A category's extra instructions are soft preferences: if one can't be satisfied from the available context, quietly ask a natural question of that category instead — never write about the conflict or that you're skipping or substituting anything. For each question, also set its `visibility` (see the tool): \"family\" for shared/social/event questions or anything drawn from another member's shared entry, \"private\" otherwise.";

/**
 * Build the picker instruction for a single slot. Each slot is generated in its
 * own model call against a prompt scoped to just that category's sources, so the
 * instruction only ever describes one category (or an untyped fallback). `count`
 * is the number of questions this call should return — 1 for a normal per-slot
 * call, N for a forced single-category reroll, N for the untyped fallback.
 */
export function buildCategoryInstruction(
  count: number,
  category: QuestionCategory | undefined,
  siblingNames: string[],
  rejected: string[],
  recentlyShown: string[] = []
): string {
  const lines: string[] = ["", "=== Today's question picker ==="];
  if (category) {
    lines.push(
      count > 1
        ? `Propose exactly ${count} opening question(s) by calling the \`propose_questions\` tool, all in this single category — genuinely different angles on it, not restatements of one question:`
        : "Propose exactly one opening question by calling the `propose_questions` tool, in this category:",
      `- ${category.name} — ${category.description}`
    );
    if (siblingNames.length > 0) {
      lines.push(
        `The user will also see question(s) of these other kinds today: ${siblingNames.join(", ")}. Keep yours clearly distinct in topic and mood — don't collapse into the same domain as those.`
      );
    }
  } else {
    lines.push(
      `Propose exactly ${count} opening question(s) for the user to choose from by calling the \`propose_questions\` tool. Make them genuinely different in mood and angle — never variations of one question, never the same domain twice.`
    );
  }
  lines.push(VOICE_NOTE);
  if (rejected.length > 0) {
    lines.push(
      "",
      "The user just rejected the questions below and wants a different set. Do not repeat them, anything close in shape, or anything in the same domain:",
      ...rejected.map((q, i) => `${i + 1}. ${q}`)
    );
  }
  if (recentlyShown.length > 0) {
    lines.push(
      "",
      "The questions below were shown to the user on recent days and not chosen. Don't repeat any of them word-for-word, but the underlying topics are fine to revisit if today's context makes them relevant:",
      ...recentlyShown.map((q, i) => `${i + 1}. ${q}`)
    );
  }
  return lines.join("\n");
}

/**
 * Load the distinct questions the picker showed but the user didn't choose,
 * within the last `RECENTLY_SHOWN_DAYS` days.
 */
export async function loadRecentlyShown(today: string): Promise<string[]> {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - RECENTLY_SHOWN_DAYS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_skipped_questions")
    .select("question")
    .gte("skipped_on", cutoffDate);
  if (error) throw error;

  return [...new Set((data ?? []).map((r) => r.question as string))];
}

type FamilyFollowupSource = {
  authorName: string;
  entry_date: string;
  title: string | null;
  summary: string | null;
  pull_quote: string | null;
};

/**
 * The most recent entry another family member has shared to the family feed
 * (closed + visibility 'family', authored by someone else), at summary level —
 * title, summary, pull_quote, and author name. The family-followup question type
 * references this so the interviewer can ask the user about it. Null when no
 * other member has shared anything (the type then no-ops / is dropped).
 */
export async function loadFamilyFollowupSource(): Promise<FamilyFollowupSource | null> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data: entry } = await supabase
    .from("journal_entries")
    .select("user_id, entry_date, title, summary, pull_quote")
    .eq("visibility", "family")
    .eq("status", "closed")
    .neq("user_id", userId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!entry) return null;

  const { data: member } = await supabase
    .from("family_members")
    .select("name")
    .eq("user_id", entry.user_id)
    .maybeSingle();

  return {
    authorName: member?.name?.trim() || "a family member",
    entry_date: entry.entry_date as string,
    title: (entry.title as string | null) ?? null,
    summary: (entry.summary as string | null) ?? null,
    pull_quote: (entry.pull_quote as string | null) ?? null,
  };
}

/**
 * Fold a family-followup source's summary-level content into the category
 * description so the model can reference the other member's entry by name.
 */
function withFamilySource(
  category: QuestionCategory,
  source: FamilyFollowupSource
): QuestionCategory {
  const parts = [
    `Another family member, ${source.authorName}, recently shared an entry to the family feed (${source.entry_date}). Reference it by their name and ask the user a warm question about it. Use only this summary-level content — do not invent details beyond it:`,
    source.title ? `- Title: ${source.title}` : null,
    source.summary ? `- Summary: ${source.summary}` : null,
    source.pull_quote ? `- A line they wrote: "${source.pull_quote}"` : null,
  ].filter(Boolean);
  return { ...category, description: `${category.description} ${parts.join("\n")}` };
}

const EMPTY_HISTORY = { recent: [], older: [] } as Awaited<ReturnType<typeof loadHistory>>;

/**
 * Generate the day's varied opening-question candidates for an entry.
 * `rejected` lists questions the user already turned down (from prior rerolls)
 * so the model avoids repeating them. When `forcedCategoryName` is given, all
 * candidates are produced in that single question type (the user asked for a
 * specific kind), even if that type is currently disabled.
 *
 * Each candidate is generated in its own model call against a prompt scoped to
 * just that category's sources (see CONTEXT_SPECS), so a type can't drift onto
 * data it has no business asking about. The calls run in parallel.
 *
 * `clientTz` is the caller's IANA timezone, sent with the request so date
 * reasoning doesn't depend on the tz cookie having been written yet (it's set
 * client-side after mount, so it can be missing on a fresh session — which makes
 * the day boundary fall back to UTC and mislabels evening events as "yesterday").
 */
export async function generateCandidates(
  entryId: string,
  rejected: string[],
  forcedCategoryName?: string,
  clientTz?: string
): Promise<JournalOpeningCandidate[]> {
  const tz = await resolveTimezone(clientTz);
  const today = localDate(new Date(), tz);
  const nowLabel = formatNow(new Date(), tz);

  const [questionTypes, settings, familySource, files, recentlyShown, familyDoc] =
    await Promise.all([
      loadQuestionTypes(),
      loadSettings(),
      loadFamilyFollowupSource(),
      loadAgentFiles(),
      loadRecentlyShown(today),
      loadFamilyDoc(),
    ]);

  const n = settings.questions_per_day;

  // Lazy, deduped loaders: history is fetched at most once and reused; each
  // calendar window is fetched at most once even when several slots want it.
  let historyPromise: ReturnType<typeof loadHistory> | null = null;
  const historyFor = () => (historyPromise ??= loadHistory(today, entryId));
  const calendarCache = new Map<CalendarWindow, Promise<string | null>>();
  const calendarFor = (window: CalendarWindow) => {
    let p = calendarCache.get(window);
    if (!p) {
      p = loadCalendarBlock(today, tz, window);
      calendarCache.set(window, p);
    }
    return p;
  };

  const client = anthropic();

  // Generate one slot: `count` questions in a single category (or untyped),
  // against a prompt holding only that category's allowed sources.
  async function generateSlot(
    count: number,
    category: QuestionCategory | undefined,
    siblingNames: string[]
  ): Promise<JournalOpeningCandidate[]> {
    const spec = specFor(category?.name);
    const [calendarBlock, history] = await Promise.all([
      spec.calendar === "none" ? Promise.resolve(null) : calendarFor(spec.calendar),
      spec.history ? historyFor() : Promise.resolve(EMPTY_HISTORY),
    ]);

    const system =
      buildSystemPrompt(files, history, today, calendarBlock, nowLabel, familyDoc, {
        includePresent: spec.present,
        includePast: spec.past,
        includeHistory: spec.history,
      }) +
      "\n" +
      buildCategoryInstruction(count, category, siblingNames, rejected, recentlyShown);

    const message = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 1024,
      system,
      tools: [buildOpeningCandidatesTool(count)],
      tool_choice: { type: "tool", name: OPENING_CANDIDATES_TOOL_NAME },
      messages: [{ role: "user", content: "It's morning. Propose today's questions." }],
    });

    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("model did not return question candidates");
    }
    const input = toolUse.input as {
      questions?: { text?: unknown; visibility?: unknown }[];
    };
    const parsed = (input.questions ?? [])
      .map((q) => ({
        text: typeof q.text === "string" ? q.text.trim() : "",
        // Sharing is opt-in: any unexpected value falls back to private.
        visibility: (q.visibility === "family" ? "family" : "private") as
          | "family"
          | "private",
      }))
      .filter((q) => q.text.length > 0);
    if (parsed.length !== count) {
      throw new Error(`expected ${count} question candidate(s), got ${parsed.length}`);
    }
    // A family-followup question is always shared — it's about another member's
    // family post — regardless of what the model suggested.
    return parsed.map((q) => ({
      text: q.text,
      type: category?.name ?? null,
      visibility: category?.name === FAMILY_FOLLOWUP ? "family" : q.visibility,
    }));
  }

  // Forced single category (a reroll asking for one specific kind): N questions,
  // one call, scoped to that category.
  if (forcedCategoryName) {
    const t = questionTypes.find((q) => q.name === forcedCategoryName);
    let cat = t ? questionTypeToCategory(t) : undefined;
    if (cat && cat.name === FAMILY_FOLLOWUP && familySource) {
      cat = withFamilySource(cat, familySource);
    }
    // Unknown forced category falls back to an untyped varied set.
    return generateSlot(n, cat, []);
  }

  // Normal morning: sample N distinct categories and generate each in its own
  // scoped call, in parallel.
  const enabled = questionTypes
    .filter((t) => t.enabled && t.weight > 0)
    // Drop family-followup from the pool entirely when no other member has
    // shared anything, so the sampler never picks a slot it can't fill.
    .filter((t) => t.name !== FAMILY_FOLLOWUP || familySource !== null)
    .map(questionTypeToCategory);
  const sampled = sampleQuestionMix(enabled, n).map((c) =>
    c.name === FAMILY_FOLLOWUP && familySource ? withFamilySource(c, familySource) : c
  );

  // If sampling can't fill every slot (too few enabled types), fall back to a
  // single untyped call for the whole set rather than leaving slots empty.
  if (sampled.length !== n) {
    return generateSlot(n, undefined, []);
  }

  const names = sampled.map((c) => c.name);
  const perSlot = await Promise.all(
    sampled.map((cat, i) =>
      generateSlot(
        1,
        cat,
        names.filter((_, j) => j !== i)
      )
    )
  );
  return perSlot.flat();
}
