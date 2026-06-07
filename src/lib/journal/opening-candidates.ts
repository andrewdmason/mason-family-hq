import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import {
  buildSystemPrompt,
  loadAgentFiles,
  loadCurrentUserIdentity,
  loadFamilyDoc,
  loadHistory,
  loadQuestionTypes,
  loadSettings,
} from "@/lib/journal/context";
import { loadCalendarBlock } from "@/lib/journal/calendar";
import type { CalendarWindow } from "@/lib/journal/calendar/types";
import {
  CURRENTLY_READING,
  FAMILY_FOLLOWUP,
  REMINISCENCE,
  specFor,
  suitsAudience,
} from "@/lib/journal/question-sources";
import type { CategoryContextSpec } from "@/lib/journal/question-sources";
import { formatNow, localDate, resolveTimezone } from "@/lib/date-utils";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import { loadTimeline, loadTimelineEntryById } from "@/lib/timeline/queries";
import { serializeTimelineForPrompt } from "@/lib/timeline/serialize";
import { formatTimelineRange, isUpcoming } from "@/lib/timeline/format";
import type {
  JournalOpeningCandidate,
  JournalQuestionType,
  ReadingBookStatus,
  ReadingRating,
  TimelineEntryWithPeople,
} from "@/lib/types";

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
              conciseTitle: {
                type: "string",
                description:
                  "A concise 2–5 word, lowercase noun-phrase title for an entry answering this question — what the writer might jot at the top of the page. No punctuation, no quotation marks. Concrete over abstract. e.g. for \"What did the morning after the permit feel like?\" → \"the morning after the permit\".",
              },
              visibility: {
                type: "string",
                enum: ["private", "family"],
                description:
                  "Where an entry answering this question would most naturally go: \"family\" if it's about a shared moment, event, or something the family would enjoy seeing (always for family-followup questions); \"private\" for intimate, introspective, or sensitive reflections. This only pre-selects a toggle the user can change — default to \"private\" when unsure.",
              },
            },
            required: ["text", "conciseTitle", "visibility"],
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
  /**
   * Set only for currently-reading: the in-progress book the question is
   * grounded in, so the picked candidate can be linked to it. Folded in by
   * withReadingSource and stamped onto each candidate by generateSlot.
   */
  readingBookId?: string;
  /**
   * Set only for reminiscence: the timeline event the question targets, so the
   * picked candidate can be linked to it. Folded in by withTimelineSource and
   * stamped onto each candidate by generateSlot.
   */
  timelineEntryId?: string;
  /**
   * Set only for recurring posts: the user-chosen context sources, overriding the
   * name-based default. generateSlot reads this in place of specFor(name).
   */
  spec?: CategoryContextSpec;
  /**
   * Set only for recurring posts: the rolling cadence in days. Scales the
   * calendar window so a weekly recap sees ~7 days back and a monthly one ~30.
   */
  recurrenceDays?: number;
};

/**
 * A recurring post's prompt is usually broad ("what's been interesting lately"),
 * so without steering the model drifts to generic Present-doc themes. This turns
 * the type's selected sources into an explicit instruction to ground the question
 * in real, specific material — the actual events on the calendar, prior entries
 * of this type — naming `recurrenceDays` so a monthly recap reaches across the
 * whole month. VOICE_NOTE already covers the "if a source is empty, ask a natural
 * question instead" fallback, so this never forces an invented detail.
 */
function recurringGroundingNote(
  spec: CategoryContextSpec,
  recurrenceDays: number | undefined
): string {
  const span = Math.min(recurrenceDays ?? 30, 92);
  const sources: string[] = [];
  if (spec.calendar === "recent")
    sources.push(`the actual events on their calendar over roughly the last ${span} days`);
  if (spec.calendar === "ahead") sources.push("what's actually coming up on their calendar");
  if (spec.typeHistory) sources.push("what they wrote in their previous posts of this kind");
  if (spec.history) sources.push("their recent journal entries");
  if (spec.past) sources.push("their life timeline");
  if (spec.family) sources.push("what family members have recently shared");
  if (spec.present) sources.push("their current life (the Present doc)");
  if (sources.length === 0) return "";
  return (
    ` Ground the question in something concrete and specific drawn from ${joinSources(sources)} — ` +
    "name an actual event, moment, or thing that happened, not a generic theme. " +
    "Survey what's there and pick something real worth reflecting on."
  );
}

/** Join clauses as "a", "a and b", or "a, b, and c". */
function joinSources(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * Build a `QuestionCategory` from a stored question type, folding the user's
 * free-text style note onto the locked base description. A recurring post carries
 * its stored `context_spec` so generateSlot scopes the prompt to its sources.
 */
export function questionTypeToCategory(t: JournalQuestionType): QuestionCategory {
  return {
    name: t.name,
    description: t.base_description + (t.style_note.trim() ? " " + t.style_note.trim() : ""),
    weight: t.weight,
    spec: t.context_spec ?? undefined,
    recurrenceDays: t.recurrence_days ?? undefined,
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
 * Who the user wants today's questions aimed at. "any" (the default) leaves the
 * model's per-question visibility guess untouched — the original behavior. The
 * picker lets the user opt into "family" (questions worth sharing) or "private"
 * (introspective, kept-to-themselves) instead.
 */
export type QuestionAudience = "any" | "family" | "private";

/**
 * The framing directive folded into a slot's prompt when the user has chosen an
 * audience. Empty for "any" so the default flow is byte-for-byte unchanged. The
 * visibility these ask for is also force-set on the candidate after generation
 * (see generateSlot) so the picked entry's share toggle matches — the prompt
 * note just keeps the *question itself* in the right register. It leans on
 * VOICE_NOTE's "quietly substitute" convention so an awkward type↔audience pair
 * (e.g. a deeply introspective category asked to suit the family) degrades into
 * a natural question rather than a forced one.
 */
export function audienceNote(audience: QuestionAudience): string {
  if (audience === "family") {
    return (
      "\n\nThe user wants today's questions aimed at their family journal — entries " +
      "they'd happily share. Frame the question around a shared moment, a person, an " +
      "event, or something the family would enjoy reading, and set its `visibility` to " +
      "\"family\". If this category is inherently private and can't be framed for " +
      "sharing, quietly ask a natural, share-friendly question instead."
    );
  }
  if (audience === "private") {
    return (
      "\n\nThe user wants today's questions aimed at their private journal — personal, " +
      "introspective, reflective, the kind of thing they'd keep to themselves. Set each " +
      "question's `visibility` to \"private\"."
    );
  }
  return "";
}

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

/**
 * The most recent entries other family members have shared to the family feed,
 * at summary level — for a recurring post whose spec opts into the `family`
 * source. Generalizes loadFamilyFollowupSource (which loads only the single most
 * recent) to a small set, so a recurring post can survey what the family's been
 * up to. Empty when no one else has shared anything.
 */
export async function loadFamilyRecentSource(
  limit = 3
): Promise<FamilyFollowupSource[]> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data: entries } = await supabase
    .from("journal_entries")
    .select("user_id, entry_date, title, summary, pull_quote")
    .eq("visibility", "family")
    .eq("status", "closed")
    .neq("user_id", userId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!entries || entries.length === 0) return [];

  const authorIds = [...new Set(entries.map((e) => e.user_id as string))];
  const { data: members } = await supabase
    .from("family_members")
    .select("user_id, name")
    .in("user_id", authorIds);
  const nameById = new Map(
    (members ?? []).map((m) => [m.user_id as string, (m.name as string | null) ?? null])
  );

  return entries.map((entry) => ({
    authorName: nameById.get(entry.user_id as string)?.trim() || "a family member",
    entry_date: entry.entry_date as string,
    title: (entry.title as string | null) ?? null,
    summary: (entry.summary as string | null) ?? null,
    pull_quote: (entry.pull_quote as string | null) ?? null,
  }));
}

/**
 * Fold a few recent family posts into the category description so a recurring
 * post can reference what the family's been doing lately, naming each author.
 */
function withFamilyRecentSource(
  category: QuestionCategory,
  sources: FamilyFollowupSource[]
): QuestionCategory {
  const lines = sources.map((s) => {
    const bits = [
      s.title ? `"${s.title}"` : null,
      s.summary,
      s.pull_quote ? `("${s.pull_quote}")` : null,
    ].filter(Boolean);
    return `- ${s.authorName} (${s.entry_date}): ${bits.join(" — ")}`;
  });
  return {
    ...category,
    description:
      `${category.description}\nRecent things family members have shared (summary-level — reference by name, don't invent beyond it):\n` +
      lines.join("\n"),
  };
}

type ReadingSource = {
  book_id: string;
  title: string;
  author: string | null;
  current_page: number;
  total_pages: number | null;
  status: ReadingBookStatus;
  rating: ReadingRating | null;
  finished_at: string | null;
};

const READING_SOURCE_COLUMNS =
  "id, title, author, current_page, total_pages, status, rating, finished_at";

function toReadingSource(row: Record<string, unknown>): ReadingSource {
  return {
    book_id: row.id as string,
    title: row.title as string,
    author: (row.author as string | null) ?? null,
    current_page: (row.current_page as number) ?? 0,
    total_pages: (row.total_pages as number | null) ?? null,
    status: row.status as ReadingBookStatus,
    rating: (row.rating as ReadingRating | null) ?? null,
    finished_at: (row.finished_at as string | null) ?? null,
  };
}

/**
 * The book to ground a daily currently-reading question in: the user's most
 * recently active in-progress book. "Most recently active" = the book with the
 * latest check-in, tie-broken by the most recently updated book (and so a book
 * just started, with no check-ins yet, can still win on updated_at). Null when
 * nothing is in progress — the currently-reading type is then dropped, exactly
 * like family-followup with no shared entry.
 */
export async function loadCurrentlyReadingSource(): Promise<ReadingSource | null> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data: books } = await supabase
    .from("reading_books")
    .select(`${READING_SOURCE_COLUMNS}, updated_at`)
    .eq("user_id", userId)
    .eq("status", "in_progress");
  if (!books || books.length === 0) return null;

  const bookIds = books.map((b) => b.id as string);
  const { data: checkins } = await supabase
    .from("reading_checkins")
    .select("book_id, checked_on")
    .eq("user_id", userId)
    .in("book_id", bookIds);

  // Latest check-in date per book stands in for "most recent reading activity".
  const lastCheckin = new Map<string, string>();
  for (const c of checkins ?? []) {
    const bookId = c.book_id as string;
    const on = c.checked_on as string;
    const prev = lastCheckin.get(bookId);
    if (!prev || on > prev) lastCheckin.set(bookId, on);
  }

  const chosen = books.slice().sort((a, b) => {
    const ca = lastCheckin.get(a.id as string) ?? "";
    const cb = lastCheckin.get(b.id as string) ?? "";
    if (ca !== cb) return ca < cb ? 1 : -1;
    const ua = (a.updated_at as string) ?? "";
    const ub = (b.updated_at as string) ?? "";
    return ua < ub ? 1 : -1;
  })[0];

  return toReadingSource(chosen);
}

/**
 * One specific book to ground a question in, whatever its status — used by the
 * "Reflect in journal" entry point on the Reading list, where the user picks the
 * book (including one they finished a while ago). Null when the book doesn't
 * exist or isn't theirs.
 */
export async function loadBookSource(bookId: string): Promise<ReadingSource | null> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data: book } = await supabase
    .from("reading_books")
    .select(READING_SOURCE_COLUMNS)
    .eq("user_id", userId)
    .eq("id", bookId)
    .maybeSingle();
  return book ? toReadingSource(book) : null;
}

function readingByline(source: ReadingSource): string {
  return source.author ? ` by ${source.author}` : "";
}

function readingWhere(source: ReadingSource): string {
  if (source.total_pages && source.total_pages > 0) {
    return ` (around page ${source.current_page} of ${source.total_pages})`;
  }
  return source.current_page > 0 ? ` (around page ${source.current_page})` : "";
}

/** A sentence placing the book in their reading life, by status. */
function readingStateClause(source: ReadingSource): string {
  const book = `"${source.title}"${readingByline(source)}`;
  switch (source.status) {
    case "in_progress":
      return `The book they're reading right now is ${book}${readingWhere(source)}.`;
    case "paused":
      return `They started ${book} but have set it aside for now${readingWhere(source)}.`;
    case "archive":
      return source.finished_at
        ? `They finished reading ${book} (on ${source.finished_at}).`
        : `They've finished reading ${book}.`;
    case "queued":
      return `${book} is on their to-read list — they haven't started it yet.`;
    default:
      return `The book is ${book}.`;
  }
}

/** Their verdict on the book, when they've rated it. */
function readingRatingClause(rating: ReadingRating | null): string {
  switch (rating) {
    case "loved":
      return " They loved it.";
    case "liked":
      return " They liked it.";
    case "neutral":
      return " They felt lukewarm about it.";
    case "disliked":
      return " They didn't really like it.";
    case "didnt_finish":
      return " They set it down without finishing.";
    default:
      return "";
  }
}

/**
 * Fold a specific book — its state in their reading life and their verdict on it
 * — into the category description so the model asks a question grounded in it,
 * and stamp the book id onto the category so generateSlot can link the picked
 * candidate to it. Adapts to whether they're mid-read (mind spoilers) or finished
 * (ask looking back).
 */
function withReadingSource(
  category: QuestionCategory,
  source: ReadingSource
): QuestionCategory {
  const finished = source.status === "archive";
  const midRead = source.status === "in_progress" || source.status === "paused";
  const guidance =
    "If you genuinely know this book, ground the question in something specific to it — a particular " +
    "character and their predicament, a central theme or argument, the author's preoccupations or style, " +
    "a real moment in it. The more it could only be asked about THIS book, the better. Actively avoid " +
    "questions that would fit any book — 'is there a character you relate to?', 'what's it left you with?' " +
    "are exactly the generic shapes to skip." +
    (finished
      ? " They've already finished it, so ask looking back — what stuck with them, what they made of it, " +
        "how it sits with them now, and let their verdict color the tone."
      : "") +
    (midRead ? " Mind where they are in it so you don't spoil what's ahead." : "") +
    " Only if you're truly not confident about this book's contents should you fall back to asking what drew " +
    "them to it — and even then, keep it concrete, never invent plot details you're unsure of.";
  return {
    ...category,
    readingBookId: source.book_id,
    description: `${category.description} ${readingStateClause(source)}${readingRatingClause(
      source.rating
    )} ${guidance}`,
  };
}

const PROMINENCE_WEIGHT: Record<string, number> = { major: 3, medium: 2, minor: 1 };

/**
 * Pick one under-elaborated timeline event for a reminiscence question. Prefer
 * events the user hasn't written about yet (linkedCount 0), falling back to
 * lightly-covered ones; never future events. Among the pool, sample weighted by
 * prominence so the big milestones get drawn out first, with randomness for
 * variety across days. Null when there's nothing left to elaborate (the type is
 * then dropped from the day's mix, exactly like family-followup / currently-reading).
 */
export function pickReminiscenceTarget(
  entries: TimelineEntryWithPeople[],
  today: string,
  rand: () => number = Math.random
): TimelineEntryWithPeople | null {
  const past = entries.filter((e) => !isUpcoming(e, today));
  let pool = past.filter((e) => e.linkedCount === 0);
  if (pool.length === 0) pool = past.filter((e) => e.linkedCount <= 1);
  if (pool.length === 0) return null;

  const total = pool.reduce((s, e) => s + (PROMINENCE_WEIGHT[e.prominence] ?? 1), 0);
  let r = rand() * total;
  for (const e of pool) {
    r -= PROMINENCE_WEIGHT[e.prominence] ?? 1;
    if (r <= 0) return e;
  }
  return pool[pool.length - 1];
}

/**
 * Fold a specific timeline event into the category description so the model asks
 * a concrete question about it, and stamp its id onto the category so generateSlot
 * can link the picked candidate to it.
 */
function withTimelineSource(
  category: QuestionCategory,
  entry: TimelineEntryWithPeople
): QuestionCategory {
  const when = formatTimelineRange(entry);
  const where = entry.location ? `, ${entry.location}` : "";
  const people =
    entry.mentions.length > 0
      ? ` People who were part of it: ${entry.mentions.map((m) => m.name).join(", ")}.`
      : "";
  return {
    ...category,
    timelineEntryId: entry.id,
    description:
      `${category.description} Center the question on this specific event from the user's life — draw them out on it, don't just restate it: ` +
      `"${entry.title}" (${when}${where}). ${entry.description}${people} ` +
      "Ask one warm, specific question inviting them to tell the story or reflect on what it meant. Never mention that it came from a timeline or that you were told to ask about it.",
  };
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
  clientTz?: string,
  forcedBookId?: string | null,
  forcedTimelineEntryId?: string | null,
  audience: QuestionAudience = "any"
): Promise<JournalOpeningCandidate[]> {
  const tz = await resolveTimezone(clientTz);
  const today = localDate(new Date(), tz);
  const nowLabel = formatNow(new Date(), tz);

  const [
    questionTypes,
    settings,
    familySource,
    readingSource,
    files,
    userIdentity,
    recentlyShown,
    familyDoc,
    timelineEntries,
  ] = await Promise.all([
    loadQuestionTypes(),
    loadSettings(),
    loadFamilyFollowupSource(),
    // A book-reflection entry grounds in its specific book; the daily flow auto-
    // picks the most recently active in-progress book.
    forcedBookId ? loadBookSource(forcedBookId) : loadCurrentlyReadingSource(),
    loadAgentFiles(),
    loadCurrentUserIdentity(),
    loadRecentlyShown(today),
    loadFamilyDoc(),
    // The user's own timeline: serialized as life context for the prompt, and
    // mined for one under-elaborated event for reminiscence to target.
    loadTimeline("mine", { ownLinksOnly: true }),
  ]);

  const n = settings.questions_per_day;
  const timelineBlock = serializeTimelineForPrompt(timelineEntries, today);
  const reminiscenceTarget = pickReminiscenceTarget(timelineEntries, today);

  // Lazy, deduped loaders: history is fetched at most once and reused; each
  // calendar window is fetched at most once even when several slots want it.
  let historyPromise: ReturnType<typeof loadHistory> | null = null;
  const historyFor = () => (historyPromise ??= loadHistory(today, entryId));
  // Keyed by window + span: recurring posts scale the calendar to their cadence,
  // so a weekly and a monthly slot mustn't share one cached block.
  const calendarCache = new Map<string, Promise<string | null>>();
  const calendarFor = (window: CalendarWindow, spanDays?: number) => {
    const key = `${window}:${spanDays ?? ""}`;
    let p = calendarCache.get(key);
    if (!p) {
      p = loadCalendarBlock(today, tz, window, spanDays);
      calendarCache.set(key, p);
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
    // A recurring post carries its own spec; everything else is name-based.
    const spec = category?.spec ?? specFor(category?.name);
    const wantHistory = spec.history || !!spec.typeHistory;
    const [calendarBlock, history] = await Promise.all([
      spec.calendar === "none"
        ? Promise.resolve(null)
        : calendarFor(spec.calendar, category?.recurrenceDays),
      // typeHistory-only narrows history to this type's prior posts; turning on
      // general history (or any built-in) broadens to the full recent history.
      spec.typeHistory && !spec.history && category?.name
        ? loadHistory(today, entryId, 7, category.name)
        : wantHistory
          ? historyFor()
          : Promise.resolve(EMPTY_HISTORY),
    ]);

    const system =
      buildSystemPrompt(
        files,
        history,
        today,
        calendarBlock,
        nowLabel,
        familyDoc,
        timelineBlock,
        {
          includePresent: spec.present,
          includeTimeline: spec.past,
          includeHistory: wantHistory,
          userIdentity,
        }
      ) +
      "\n" +
      buildCategoryInstruction(count, category, siblingNames, rejected, recentlyShown) +
      audienceNote(audience);

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
      questions?: { text?: unknown; conciseTitle?: unknown; visibility?: unknown }[];
    };
    const parsed = (input.questions ?? [])
      .map((q) => ({
        text: typeof q.text === "string" ? q.text.trim() : "",
        // A short title for the entry, stripped of any stray trailing punctuation.
        conciseTitle:
          typeof q.conciseTitle === "string"
            ? q.conciseTitle.trim().replace(/[.!?]+$/, "")
            : null,
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
    // family post — regardless of what the model suggested. Otherwise, when the
    // user has chosen an audience, force the visibility to match so the picked
    // entry's share toggle lines up; "any" keeps the model's per-question guess.
    return parsed.map((q) => ({
      text: q.text,
      conciseTitle: q.conciseTitle,
      type: category?.name ?? null,
      visibility:
        category?.name === FAMILY_FOLLOWUP
          ? "family"
          : audience === "family"
            ? "family"
            : audience === "private"
              ? "private"
              : q.visibility,
      // currently-reading carries the book it's grounded in, so picking it links
      // the entry to that book (withReadingSource set readingBookId).
      reading_book_id: category?.readingBookId ?? null,
      // reminiscence carries the timeline event it targets, so picking it links
      // the entry to that event (withTimelineSource set timelineEntryId).
      timeline_entry_id: category?.timelineEntryId ?? null,
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
    if (cat && cat.name === CURRENTLY_READING && readingSource) {
      cat = withReadingSource(cat, readingSource);
    }
    if (cat && cat.name === REMINISCENCE && reminiscenceTarget) {
      cat = withTimelineSource(cat, reminiscenceTarget);
    }
    // A recurring post whose spec opts into family context: fold in a few recent
    // family posts (deferred until we know the type wants them).
    if (cat?.spec?.family) {
      const familyPosts = await loadFamilyRecentSource();
      if (familyPosts.length > 0) cat = withFamilyRecentSource(cat, familyPosts);
    }
    // Steer a recurring post to ground its question in its selected sources
    // (calendar events, prior posts of this type, …) rather than generic themes.
    if (cat?.spec) {
      cat = {
        ...cat,
        description: cat.description + recurringGroundingNote(cat.spec, cat.recurrenceDays),
      };
    }
    // Unknown forced category falls back to an untyped varied set.
    return generateSlot(n, cat, []);
  }

  // A reflection started from the Reading list ("Reflect in journal" on a book):
  // force currently-reading grounded in that specific book, whatever its status
  // (finished, paused, …) — even if the type is disabled in the daily mix.
  if (forcedBookId && readingSource) {
    const t = questionTypes.find((q) => q.name === CURRENTLY_READING);
    const base = t
      ? questionTypeToCategory(t)
      : { name: CURRENTLY_READING, description: "", weight: 0 };
    return generateSlot(n, withReadingSource(base, readingSource), []);
  }

  // A reflection started from a timeline event ("Reflect on this"): force
  // reminiscence grounded in that specific event — even if reminiscence is
  // disabled in the mix or the event isn't on the user's own timeline.
  if (forcedTimelineEntryId) {
    const target =
      timelineEntries.find((e) => e.id === forcedTimelineEntryId) ??
      (await loadTimelineEntryById(forcedTimelineEntryId));
    if (target) {
      const t = questionTypes.find((q) => q.name === REMINISCENCE);
      const base = t
        ? questionTypeToCategory(t)
        : { name: REMINISCENCE, description: "", weight: 0 };
      return generateSlot(n, withTimelineSource(base, target), []);
    }
  }

  // Normal morning: sample N distinct categories and generate each in its own
  // scoped call, in parallel.
  const enabled = questionTypes
    .filter((t) => t.enabled && t.weight > 0)
    // Recurring posts are deliberate-only — never in the random daily mix.
    .filter((t) => t.recurrence_days == null)
    // Keep types out of an audience they don't suit: inherently-private types
    // (a book reflection, an intimate introspection) never get framed for the
    // family journal, and the always-shared family-followup never surfaces in a
    // private set. "any" (the default) keeps the full pool.
    .filter((t) => suitsAudience(t.name, audience))
    // Drop family-followup from the pool entirely when no other member has
    // shared anything, so the sampler never picks a slot it can't fill.
    .filter((t) => t.name !== FAMILY_FOLLOWUP || familySource !== null)
    // Likewise drop currently-reading when no book is in progress to ground it.
    .filter((t) => t.name !== CURRENTLY_READING || readingSource !== null)
    // And drop reminiscence when there's no under-elaborated event to target.
    .filter((t) => t.name !== REMINISCENCE || reminiscenceTarget !== null)
    .map(questionTypeToCategory);
  const sampled = sampleQuestionMix(enabled, n).map((c) => {
    if (c.name === FAMILY_FOLLOWUP && familySource) return withFamilySource(c, familySource);
    if (c.name === CURRENTLY_READING && readingSource) return withReadingSource(c, readingSource);
    if (c.name === REMINISCENCE && reminiscenceTarget) return withTimelineSource(c, reminiscenceTarget);
    return c;
  });

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
