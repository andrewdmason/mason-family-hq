"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getIsOwner, requireUserId } from "@/lib/members/auth";
import { resolveSettingsScope } from "@/lib/journal/scope";
import { todayLocal } from "@/lib/journal/today";
import { runWrap } from "@/lib/journal/wrap";
import { summarizeRecap } from "@/lib/journal/recap-summary";
import { candidateByText, candidateTexts, normalizeCandidates } from "@/lib/journal/candidates";
import { applyProfileDocChange } from "@/lib/journal/profile-suggestions";
import { runEntryPhotoGeneration } from "@/lib/journal/generated-photo";
import type { CategoryContextSpec } from "@/lib/journal/question-sources";
import type {
  JournalAgentFileName,
  JournalInlineComment,
  JournalInlineCommentWithAuthor,
  JournalMediaType,
  JournalPhotoSource,
  JournalOpeningCandidate,
  JournalProfileSuggestion,
  JournalQuestionType,
  JournalVisibility,
} from "@/lib/types";

/** The zen timer's five-minute minimum — kept in sync with timer-context.tsx. */
const TIMER_DURATION_MS = 5 * 60 * 1000;

/**
 * Whether an open entry's writing session is effectively over: its five-minute
 * timer has elapsed. The timer anchors to when "write freely" was clicked
 * (`freeform_started_at`) or, for a picked question, to the opening message's
 * timestamp. An entry that was never started has no anchor and is not done.
 */
async function entrySessionDone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entry: { id: string; freeform_started_at: string | null }
): Promise<boolean> {
  let anchor = entry.freeform_started_at;
  if (!anchor) {
    const { data: firstMsg } = await supabase
      .from("journal_messages")
      .select("created_at")
      .eq("entry_id", entry.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    anchor = firstMsg?.created_at ?? null;
  }
  if (!anchor) return false;
  return Date.now() - new Date(anchor).getTime() >= TIMER_DURATION_MS;
}

/**
 * Delete abandoned entries: open entries from a past day that were never
 * started (no opening question picked, no freeform writing) and have no photos.
 * These are rows left behind by visiting /journal/new without writing — an
 * entry row is inserted on page load, so navigating away leaves an empty one.
 * Today's empty entry is kept so it can be resumed by getOrCreateTodayEntry.
 */
async function pruneAbandonedEntries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  today: string
): Promise<void> {
  const { data: stale } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("status", "open")
    .is("opening_question", null)
    .is("freeform_started_at", null)
    .neq("entry_date", today);
  if (!stale || stale.length === 0) return;

  const ids = stale.map((r) => r.id as string);
  const { data: photoRows } = await supabase
    .from("journal_entry_photos")
    .select("entry_id")
    .in("entry_id", ids);
  const withPhotos = new Set((photoRows ?? []).map((r) => r.entry_id as string));

  const toDelete = ids.filter((id) => !withPhotos.has(id));
  if (toDelete.length > 0) {
    await supabase.from("journal_entries").delete().in("id", toDelete);
  }
}

export async function getOrCreateTodayEntry(): Promise<{
  id: string;
  status: "open" | "closed";
  visibility: JournalVisibility;
  opening_question: string | null;
  opening_candidates: JournalOpeningCandidate[] | null;
  candidates_reroll_count: number;
  freeform_started_at: string | null;
  title: string | null;
}> {
  const supabase = await createClient();
  const date = await todayLocal();
  const columns =
    "id, status, visibility, opening_question, opening_candidates, candidates_reroll_count, freeform_started_at, title";

  await pruneAbandonedEntries(supabase, date);

  // Most recent *open* entry for today. /journal/new resumes an in-progress
  // thread, but only while its writing session is still live: a finished
  // entry whose timer has elapsed (but which was never formally closed)
  // should not be resumed — "+ new entry" creates a fresh one instead.
  const { data: existing } = await supabase
    .from("journal_entries")
    .select(columns)
    .eq("entry_date", date)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && !(await entrySessionDone(supabase, existing))) {
    return {
      id: existing.id,
      status: existing.status as "open" | "closed",
      visibility: existing.visibility as JournalVisibility,
      opening_question: existing.opening_question,
      opening_candidates: normalizeCandidates(existing.opening_candidates),
      candidates_reroll_count: existing.candidates_reroll_count,
      freeform_started_at: existing.freeform_started_at,
      title: existing.title,
    };
  }

  const userId = await requireUserId(supabase);
  const { data: created, error } = await supabase
    .from("journal_entries")
    .insert({ entry_date: date, status: "open", user_id: userId })
    .select(columns)
    .single();
  if (error || !created) {
    throw new Error(error?.message ?? "failed to create entry");
  }
  return {
    id: created.id,
    status: created.status as "open" | "closed",
    visibility: created.visibility as JournalVisibility,
    opening_question: created.opening_question,
    opening_candidates: normalizeCandidates(created.opening_candidates),
    candidates_reroll_count: created.candidates_reroll_count,
    freeform_started_at: created.freeform_started_at,
    title: created.title,
  };
}

/**
 * Load a single entry for the /journal/new editor. Used when the editor is
 * opened for a specific entry (e.g. one started from a dropped photo whose
 * date was moved into the past, so it no longer matches "today's entry").
 */
export async function getEntryById(entryId: string): Promise<{
  id: string;
  status: "open" | "closed";
  visibility: JournalVisibility;
  opening_question: string | null;
  opening_candidates: JournalOpeningCandidate[] | null;
  candidates_reroll_count: number;
  freeform_started_at: string | null;
  title: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .select(
      "id, status, visibility, opening_question, opening_candidates, candidates_reroll_count, freeform_started_at, title"
    )
    .eq("id", entryId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "entry not found");
  return {
    id: data.id,
    status: data.status as "open" | "closed",
    visibility: data.visibility as JournalVisibility,
    opening_question: data.opening_question,
    opening_candidates: normalizeCandidates(data.opening_candidates),
    candidates_reroll_count: data.candidates_reroll_count,
    freeform_started_at: data.freeform_started_at,
    title: data.title,
  };
}

/**
 * Create a fresh entry that starts straight in freeform mode, skipping the
 * opening-question picker. Used when a new entry is initiated by dropping
 * photos onto the journal list. Returns the new entry id.
 */
export async function createFreeformEntry(): Promise<string> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const date = await todayLocal();
  const { data, error } = await supabase
    .from("journal_entries")
    .insert({
      entry_date: date,
      status: "open",
      freeform_started_at: new Date().toISOString(),
      user_id: userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "failed to create entry");
  }
  return data.id as string;
}

/**
 * Start a journal entry about a specific book, from the "Reflect in journal"
 * action on the Reading list. Creates a fresh open entry pre-bound to the book
 * (reading_book_id) so the opening-question picker grounds its questions in that
 * book — its status and rating included — and the entry surfaces on the book's
 * card. Returns the new entry id; the caller routes to /journal/new?entry=<id>.
 */
export async function startBookReflection(bookId: string): Promise<string> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  // Confirm the book is the signed-in user's before binding an entry to it.
  const { data: book } = await supabase
    .from("reading_books")
    .select("id")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) throw new Error("book not found");

  const date = await todayLocal();
  const { data, error } = await supabase
    .from("journal_entries")
    .insert({
      entry_date: date,
      status: "open",
      user_id: userId,
      reading_book_id: bookId,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "failed to create entry");
  }
  return data.id as string;
}

/**
 * Start a journal entry about a specific timeline event, from the "Reflect on
 * this" affordance on a timeline entry. Creates a fresh open entry pre-bound to
 * the event (timeline_entry_id) so the opening-question picker offers three
 * reminiscence questions grounded in it, and the finished entry links back to the
 * event. Returns the new entry id; the caller routes to /journal/new?entry=<id>.
 */
export async function startTimelineReflection(timelineEntryId: string): Promise<string> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  // Confirm the event exists / is readable (RLS scopes it to the family).
  const { data: event } = await supabase
    .from("timeline_entries")
    .select("id")
    .eq("id", timelineEntryId)
    .maybeSingle();
  if (!event) throw new Error("timeline event not found");

  const date = await todayLocal();
  const { data, error } = await supabase
    .from("journal_entries")
    .insert({
      entry_date: date,
      status: "open",
      user_id: userId,
      timeline_entry_id: timelineEntryId,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "failed to create entry");
  }
  return data.id as string;
}

/**
 * Set an entry's date. Used when a new entry is started from a dropped photo
 * and the user opts to date the entry to when the photo was taken.
 */
export async function setEntryDate(entryId: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid date");
  const supabase = await createClient();
  const { error } = await supabase
    .from("journal_entries")
    .update({ entry_date: date })
    .eq("id", entryId);
  if (error) throw new Error(error.message);
  revalidatePath("/journal");
}

/**
 * Skip the opening-question picker and start a freeform entry. Records the
 * moment "write freely" was clicked: this both flags the entry as freeform
 * (bypassing the picker) and anchors the five-minute timer.
 */
export async function startFreeformEntry(
  entryId: string,
  visibility?: JournalVisibility
) {
  const supabase = await createClient();

  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .select("id, status, opening_candidates")
    .eq("id", entryId)
    .single();
  if (entryErr || !entry) throw new Error("entry not found");
  if (entry.status !== "open") throw new Error("entry is closed");

  const { count, error: countErr } = await supabase
    .from("journal_messages")
    .select("id", { count: "exact", head: true })
    .eq("entry_id", entryId);
  if (countErr) throw new Error(countErr.message);
  if ((count ?? 0) > 0) throw new Error("entry already started");

  const { error: updateErr } = await supabase
    .from("journal_entries")
    .update({
      freeform_started_at: new Date().toISOString(),
      opening_candidates: null,
      // Compose from the Family app pre-sets the audience to "family"; from the
      // Journal app, "private". Omitted (undefined) leaves the DB default.
      ...(visibility ? { visibility } : {}),
    })
    .eq("id", entryId);
  if (updateErr) throw new Error(updateErr.message);

  // Choosing freeform skips every shown candidate — persist them so future
  // days don't resurface the same prompts.
  const shown = candidateTexts(entry.opening_candidates);
  if (shown.length > 0) {
    const today = await todayLocal();
    const userId = await requireUserId(supabase);
    await supabase.from("journal_skipped_questions").insert(
      shown.map((q) => ({ question: q, entry_id: entryId, skipped_on: today, user_id: userId }))
    );
  }

  revalidatePath("/journal/new");
}

/**
 * Pick one of the three opening-question candidates. Inserts it as the opening
 * assistant message so the entry transitions from the picker to the chat.
 */
export async function pickOpeningQuestion(entryId: string, question: string) {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .select("id, status, opening_candidates, reading_book_id, timeline_entry_id")
    .eq("id", entryId)
    .single();
  if (entryErr || !entry) throw new Error("entry not found");
  if (entry.status !== "open") throw new Error("entry is closed");

  // Match the clicked question to its candidate to carry its metadata (type,
  // visibility, book/event link). A stale picker can surface a question that's
  // no longer in the entry's current candidate set — e.g. the cards were shown
  // last night and the set was later rerolled or regenerated by a recurring-post
  // nudge before today's tap. That's a legitimate pick, not tampering, so accept
  // it with safe defaults rather than dead-ending the writer on a question they
  // genuinely saw and chose.
  const picked = candidateByText(entry.opening_candidates, question);
  const candidates = candidateTexts(entry.opening_candidates);

  const { count, error: countErr } = await supabase
    .from("journal_messages")
    .select("id", { count: "exact", head: true })
    .eq("entry_id", entryId);
  if (countErr) throw new Error(countErr.message);
  if ((count ?? 0) > 0) throw new Error("entry already started");

  const { error: msgErr } = await supabase
    .from("journal_messages")
    .insert({ entry_id: entryId, role: "assistant", content: question, user_id: userId });
  if (msgErr) throw new Error(msgErr.message);

  // The picked question's model-suggested visibility pre-sets the entry's
  // toggle (the author can still change it). It won't actually surface in the
  // family feed until the entry is closed.
  const { error: updateErr } = await supabase
    .from("journal_entries")
    .update({
      opening_question: question,
      opening_candidates: null,
      // The picked candidate's question type tags the entry so the feed can show
      // its category label. Null for untyped fallback questions (and for a stale
      // pick whose candidate metadata we no longer have).
      question_type: picked?.type ?? null,
      // Default a metadata-less stale pick to private — sharing is always an
      // explicit, opt-in act.
      visibility: picked?.visibility ?? "private",
      // currently-reading questions carry the book they're about; link it so the
      // Reading list can surface this entry on that book's card. Fall back to any
      // link the entry already had (a "Reflect in journal" entry is pre-bound to
      // its book), so switching question doesn't silently drop the provenance.
      reading_book_id: picked?.reading_book_id ?? entry.reading_book_id ?? null,
      // reminiscence questions carry the timeline event they're about; link it so
      // the event's detail page lists this reflection and the event reads as
      // "elaborated". Fall back to any link already on the entry.
      timeline_entry_id: picked?.timeline_entry_id ?? entry.timeline_entry_id ?? null,
    })
    .eq("id", entryId);
  if (updateErr) throw new Error(updateErr.message);

  // The other candidates in the final set were shown but not chosen — persist
  // them so future days don't resurface the same prompts.
  const notPicked = candidates.filter((q) => q !== question);
  if (notPicked.length > 0) {
    const today = await todayLocal();
    await supabase.from("journal_skipped_questions").insert(
      notPicked.map((q) => ({ question: q, entry_id: entryId, skipped_on: today, user_id: userId }))
    );
  }

  revalidatePath("/journal/new");
}

/**
 * Save a quote entry: a frictionless capture with no AI engagement. Reuses the
 * fresh open entry the picker is operating on, stores the quote in `pull_quote`
 * and the optional attribution in `quote_attribution`, and closes the entry
 * immediately — there's no conversation, no timer, and no wrap pass, so no
 * title/summary is ever generated.
 */
export async function saveQuoteEntry(
  entryId: string,
  quote: string,
  attribution: string,
  visibility?: JournalVisibility
) {
  const trimmedQuote = quote.trim();
  if (!trimmedQuote) throw new Error("quote is empty");
  const trimmedAttribution = attribution.trim();

  const supabase = await createClient();

  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .select("id, status")
    .eq("id", entryId)
    .single();
  if (entryErr || !entry) throw new Error("entry not found");
  if (entry.status !== "open") throw new Error("entry is closed");

  const { count, error: countErr } = await supabase
    .from("journal_messages")
    .select("id", { count: "exact", head: true })
    .eq("entry_id", entryId);
  if (countErr) throw new Error(countErr.message);
  if ((count ?? 0) > 0) throw new Error("entry already started");

  const { error: updateErr } = await supabase
    .from("journal_entries")
    .update({
      entry_type: "quote",
      pull_quote: trimmedQuote,
      quote_attribution: trimmedAttribution || null,
      opening_candidates: null,
      status: "closed",
      closed_at: new Date().toISOString(),
      // A quote saved from the Family app shares with the family; from the
      // Journal app it stays private (the DB default when omitted).
      ...(visibility ? { visibility } : {}),
    })
    .eq("id", entryId);
  if (updateErr) throw new Error(updateErr.message);

  revalidatePath("/journal");
  revalidatePath(`/journal/${entryId}`);
}

/**
 * Edit an existing quote entry's quote text and attribution. The quote-entry
 * counterpart to EntryTitle's inline edit on standard entries.
 */
export async function updateQuoteEntry(
  entryId: string,
  quote: string,
  attribution: string
) {
  const trimmedQuote = quote.trim();
  if (!trimmedQuote) throw new Error("quote is empty");
  const trimmedAttribution = attribution.trim();

  const supabase = await createClient();
  const { error } = await supabase
    .from("journal_entries")
    .update({
      pull_quote: trimmedQuote,
      quote_attribution: trimmedAttribution || null,
    })
    .eq("id", entryId)
    .eq("entry_type", "quote");
  if (error) throw new Error(error.message);

  revalidatePath("/journal");
  revalidatePath(`/journal/${entryId}`);
}

const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/**
 * Derive a recap's feed date from its title: the first day of the month *after*
 * the month named in the title (e.g. "April Chatbot Recap" → May 1; "December
 * Chatbot Recap" → January 1 of the next year). This surfaces a month-end recap
 * at the top of the feed at the start of the following month. If no month name
 * is found, fall back to the first of the month after today. Built from UTC
 * parts so the date-only column doesn't drift across timezones.
 */
function recapEntryDate(title: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const lower = title.toLowerCase();
  const monthIndex = MONTH_NAMES.findIndex((name) => lower.includes(name));

  // No month in the title: fall back to the first of the month after today.
  if (monthIndex === -1) {
    const d = new Date(Date.UTC(year, now.getUTCMonth() + 1, 1));
    return d.toISOString().slice(0, 10);
  }

  // First day of the month after the title's month (December rolls into
  // January of the next year automatically).
  let target = new Date(Date.UTC(year, monthIndex + 1, 1));
  // If that lands more than a month in the future, the title's month belongs to
  // last year (e.g. pasting the December recap in early January) — roll back.
  const cutoff = new Date(Date.UTC(year, now.getUTCMonth() + 1, 2));
  if (target.getTime() > cutoff.getTime()) {
    target = new Date(Date.UTC(year - 1, monthIndex + 1, 1));
  }

  return target.toISOString().slice(0, 10);
}

/**
 * Save a recap entry: a pasted-in monthly chatbot recap. Like saveQuoteEntry,
 * it reuses the fresh open entry the picker is operating on, closes it
 * immediately, and runs no wrap pass. The markdown goes in `recap_body`, the
 * user-supplied title in `title`, and the feed date is derived from the title's
 * month (see recapEntryDate).
 */
export async function saveRecapEntry(
  entryId: string,
  title: string,
  body: string,
  visibility?: JournalVisibility
) {
  const trimmedBody = body.trim();
  if (!trimmedBody) throw new Error("recap is empty");
  const trimmedTitle = title.trim() || "Chatbot Recap";

  const supabase = await createClient();

  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .select("id, status")
    .eq("id", entryId)
    .single();
  if (entryErr || !entry) throw new Error("entry not found");
  if (entry.status !== "open") throw new Error("entry is closed");

  const { count, error: countErr } = await supabase
    .from("journal_messages")
    .select("id", { count: "exact", head: true })
    .eq("entry_id", entryId);
  if (countErr) throw new Error(countErr.message);
  if ((count ?? 0) > 0) throw new Error("entry already started");

  // A one-sentence AI subtitle for the feed. Resilient: null on any failure,
  // so a recap still saves even if the summary call doesn't land.
  const summary = await summarizeRecap(trimmedBody);

  const { error: updateErr } = await supabase
    .from("journal_entries")
    .update({
      entry_type: "recap",
      title: trimmedTitle,
      recap_body: trimmedBody,
      summary,
      entry_date: recapEntryDate(trimmedTitle),
      opening_candidates: null,
      status: "closed",
      closed_at: new Date().toISOString(),
      // A recap saved from the Family app shares with the family; from the
      // Journal app it stays private (the DB default when omitted).
      ...(visibility ? { visibility } : {}),
    })
    .eq("id", entryId);
  if (updateErr) throw new Error(updateErr.message);

  revalidatePath("/journal");
  revalidatePath(`/journal/${entryId}`);
}

/**
 * Edit an existing recap entry's title and body. Re-derives the feed date from
 * the (possibly changed) title so fixing the month also moves the entry.
 */
export async function updateRecapEntry(
  entryId: string,
  title: string,
  body: string
) {
  const trimmedBody = body.trim();
  if (!trimmedBody) throw new Error("recap is empty");
  const trimmedTitle = title.trim() || "Chatbot Recap";

  // Re-summarize the edited body. Only overwrite the existing subtitle when the
  // call succeeds, so a transient failure doesn't blank out a good summary.
  const summary = await summarizeRecap(trimmedBody);

  const update: Record<string, unknown> = {
    title: trimmedTitle,
    recap_body: trimmedBody,
    entry_date: recapEntryDate(trimmedTitle),
  };
  if (summary) update.summary = summary;

  const supabase = await createClient();
  const { error } = await supabase
    .from("journal_entries")
    .update(update)
    .eq("id", entryId)
    .eq("entry_type", "recap");
  if (error) throw new Error(error.message);

  revalidatePath("/journal");
  revalidatePath(`/journal/${entryId}`);
}

/**
 * Edit a standard entry's title and the user's own messages. The title goes on
 * the entry; each edit updates one message's content. The `role = 'user'` guard
 * (alongside RLS, which already restricts updates to the caller's own rows)
 * keeps interviewer questions immutable even if a message id is tampered with.
 * Empty titles fall back to null (the UI shows "Untitled"); blank message edits
 * are skipped rather than wiping a turn.
 */
export async function updateEntryContent(
  entryId: string,
  title: string,
  messageEdits: { id: string; content: string }[],
  questionType: string | null = null
) {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  // Normalize the category: empty → null (no category). A non-empty value must
  // be one of the caller's own question types — defends against a tampered
  // select submitting an arbitrary string.
  let nextType: string | null = questionType?.trim() ? questionType.trim() : null;
  if (nextType) {
    const { data: typeRow } = await supabase
      .from("journal_question_types")
      .select("name")
      .eq("user_id", userId)
      .eq("name", nextType)
      .maybeSingle();
    if (!typeRow) nextType = null;
  }

  const trimmedTitle = title.trim();
  const { error: titleErr } = await supabase
    .from("journal_entries")
    .update({ title: trimmedTitle || null, question_type: nextType })
    .eq("id", entryId);
  if (titleErr) throw new Error(titleErr.message);

  for (const edit of messageEdits) {
    const content = edit.content.trim();
    if (!content) continue;
    const { error } = await supabase
      .from("journal_messages")
      .update({ content })
      .eq("id", edit.id)
      .eq("entry_id", entryId)
      .eq("role", "user");
    if (error) throw new Error(error.message);
  }

  revalidatePath("/journal");
  revalidatePath(`/journal/${entryId}`);
}

/**
 * Append a user message to an entry without generating an interviewer reply.
 * Used once the five-minute timer is done: the user can keep writing, but the
 * conversation is over — the agent is no longer asked to respond.
 */
export async function appendUserMessage(entryId: string, content: string) {
  const trimmed = content.trim();
  if (!trimmed) return;

  const supabase = await createClient();

  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .select("id, status")
    .eq("id", entryId)
    .single();
  if (entryErr || !entry) throw new Error("entry not found");
  if (entry.status !== "open") throw new Error("entry is closed");

  const userId = await requireUserId(supabase);
  const { error } = await supabase
    .from("journal_messages")
    .insert({ entry_id: entryId, role: "user", content: trimmed, user_id: userId });
  if (error) throw new Error(error.message);
}

/**
 * Persist a freeform blog post's draft: its user-written title and body. The
 * body is kept as the entry's single user message (inserted the first time,
 * updated thereafter) so it flows through the same transcript, edit, and wrap
 * paths as any other entry — the only difference is there's no AI conversation.
 * Called as a debounced autosave from the composer and once more on finish, so
 * leaving the page mid-post never loses writing.
 */
export async function saveFreeformDraft(
  entryId: string,
  title: string,
  body: string
) {
  const supabase = await createClient();

  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .select("id, status")
    .eq("id", entryId)
    .single();
  if (entryErr || !entry) throw new Error("entry not found");
  if (entry.status !== "open") throw new Error("entry is closed");

  const trimmedTitle = title.trim();
  const { error: titleErr } = await supabase
    .from("journal_entries")
    .update({ title: trimmedTitle || null })
    .eq("id", entryId);
  if (titleErr) throw new Error(titleErr.message);

  // A freeform entry has at most one message — the body. Update it in place if
  // it exists; otherwise insert it (only once there's something to save).
  const { data: existing, error: existingErr } = await supabase
    .from("journal_messages")
    .select("id")
    .eq("entry_id", entryId)
    .eq("role", "user")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingErr) throw new Error(existingErr.message);

  if (existing) {
    const { error } = await supabase
      .from("journal_messages")
      .update({ content: body })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else if (body.trim().length > 0) {
    const userId = await requireUserId(supabase);
    const { error } = await supabase
      .from("journal_messages")
      .insert({ entry_id: entryId, role: "user", content: body, user_id: userId });
    if (error) throw new Error(error.message);
  }
}

/**
 * Delete the most recent message of an open entry when it's an unanswered
 * interviewer question. Covers the case where a question was asked but the
 * timer ran out (or the user simply doesn't want it) before replying.
 */
export async function deleteLatestQuestion(entryId: string) {
  const supabase = await createClient();

  const { data: entry, error: entryErr } = await supabase
    .from("journal_entries")
    .select("id, status")
    .eq("id", entryId)
    .single();
  if (entryErr || !entry) throw new Error("entry not found");
  if (entry.status !== "open") throw new Error("entry is closed");

  const { data: last, error: lastErr } = await supabase
    .from("journal_messages")
    .select("id, role")
    .eq("entry_id", entryId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw new Error(lastErr.message);
  if (!last || last.role !== "assistant") {
    throw new Error("no question to delete");
  }

  const { error } = await supabase
    .from("journal_messages")
    .delete()
    .eq("id", last.id);
  if (error) throw new Error(error.message);

  revalidatePath("/journal");
}

/**
 * Mark an entry closed. The wrap pass (summary/title/pull_quote) is generated
 * separately via /journal/api/close — flipping status here first means the
 * journal list can immediately show the entry in its "generating" state.
 */
export async function closeEntry(entryId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("journal_entries")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("status", "open");
  if (error) throw new Error(error.message);
  revalidatePath("/journal");
}

/**
 * Re-run the wrap pass (summary/title/pull_quote) for a closed entry. Used to
 * recover entries whose original fire-and-forget wrap never landed — e.g. the
 * close request failed silently or the Claude call errored.
 */
export async function regenerateEntryWrap(entryId: string): Promise<void> {
  const result = await runWrap(entryId);
  if (!result.ok) throw new Error(result.error);
  revalidatePath("/journal");
  revalidatePath(`/journal/${entryId}`);
}

/**
 * Set an entry's visibility (private ↔ family). Own-row only via RLS, so a
 * member can only change the visibility of their own posts. Flipping to
 * 'family' surfaces a *closed* entry (and its transcript/photos) in the family
 * feed; flipping back to 'private' immediately removes it and re-restricts its
 * children. Sharing is always an explicit, opt-in act.
 */
export async function setEntryVisibility(
  entryId: string,
  visibility: JournalVisibility
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("journal_entries")
    .update({ visibility })
    .eq("id", entryId);
  if (error) throw new Error(error.message);
  revalidatePath("/journal");
  revalidatePath(`/journal/${entryId}`);
}

export type GenerateAndAttachEntryPhotoResult =
  | { ok: true; photoId: string }
  | { ok: false; error: string };

export async function generateAndAttachEntryPhoto(
  entryId: string
): Promise<GenerateAndAttachEntryPhotoResult> {
  const supabase = await createClient();
  const access = await authorizeEntryPhotoAccess(supabase, entryId);
  if (!access.ok) return { ok: false, error: access.error };

  // The generation pipeline runs as admin and attributes the photo to the
  // entry's author, so owner-on-behalf generation needs no special handling
  // beyond the access check above.
  const result = await runEntryPhotoGeneration(entryId, {
    mode: "manual",
    attachOnSuccess: true,
  });
  if (!result.ok) return { ok: false, error: result.error };
  if (!result.attachedPhotoId) {
    return { ok: false, error: "Generated photo was not attached." };
  }

  revalidatePath("/journal");
  revalidatePath(`/journal/${entryId}`);
  return { ok: true, photoId: result.attachedPhotoId };
}

export async function getEntriesImageGenerationStates(
  entryIds: string[]
): Promise<Record<string, "pending" | "generating">> {
  if (entryIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("journal_image_generations")
    .select("entry_id, status, created_at")
    .in("entry_id", entryIds)
    .in("status", ["pending", "generating"])
    .order("created_at", { ascending: false });

  const result: Record<string, "pending" | "generating"> = {};
  for (const row of data ?? []) {
    const entryId = row.entry_id as string;
    if (result[entryId]) continue;
    result[entryId] = row.status as "pending" | "generating";
  }
  return result;
}

export async function deleteEntry(entryId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("journal_entries")
    .delete()
    .eq("id", entryId);
  if (error) throw new Error(error.message);
  revalidatePath("/journal");
  redirect("/journal");
}

export async function saveAgentFile(
  name: JournalAgentFileName,
  content: string,
  memberEmail?: string
) {
  const { client, userId } = await resolveSettingsScope(memberEmail);
  const { error } = await client
    .from("journal_agent_files")
    .update({ content })
    .eq("name", name)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings", "layout");
}

export type QuestionTypeUpdate = {
  id: string;
  weight: number;
  style_note: string;
  base_description: string;
  enabled: boolean;
  /** Recurring posts only (custom types): the rolling cadence and chosen sources.
   * Omitted/undefined leaves the columns untouched for ordinary rotation rows. */
  recurrence_days?: number | null;
  context_spec?: CategoryContextSpec | null;
};

/**
 * Save the whole Questions tab: per-type weight/style/enabled (and, for custom
 * types, base_description), plus the global questions-per-day setting. Weights
 * are relative cadence values — the sampler normalizes them, so there's no
 * total to enforce.
 */
export async function saveQuestionConfig(
  rows: QuestionTypeUpdate[],
  questionsPerDay: number,
  memberEmail?: string
) {
  if (!Number.isInteger(questionsPerDay) || questionsPerDay < 1 || questionsPerDay > 5) {
    throw new Error("Questions per day must be between 1 and 5.");
  }

  const { client, userId } = await resolveSettingsScope(memberEmail);

  const { data: existing, error: loadErr } = await client
    .from("journal_question_types")
    .select("id, is_builtin")
    .eq("user_id", userId);
  if (loadErr) throw new Error(loadErr.message);
  const builtinById = new Map(
    (existing ?? []).map((r) => [r.id as string, r.is_builtin as boolean])
  );

  for (const row of rows) {
    const isBuiltin = builtinById.get(row.id);
    if (isBuiltin === undefined) continue; // unknown id — skip
    // Built-ins never have their base_description rewritten. Custom rows also
    // carry recurring-post state (cadence + sources); only set those columns
    // when the caller supplied them, so a plain rotation save leaves them alone.
    const update: Record<string, unknown> = isBuiltin
      ? { weight: row.weight, style_note: row.style_note, enabled: row.enabled }
      : {
          weight: row.weight,
          style_note: row.style_note,
          enabled: row.enabled,
          base_description: row.base_description,
        };
    if (!isBuiltin && row.recurrence_days !== undefined) {
      update.recurrence_days = row.recurrence_days;
    }
    if (!isBuiltin && row.context_spec !== undefined) {
      update.context_spec = row.context_spec;
    }
    const { error } = await client
      .from("journal_question_types")
      .update(update)
      .eq("id", row.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  }

  // Settings is one row per user (keyed by user_id, not the old id=1 singleton).
  // Upsert so a member whose row wasn't seeded yet still gets one.
  const { error: settingsErr } = await client
    .from("journal_settings")
    .upsert({ user_id: userId, questions_per_day: questionsPerDay });
  if (settingsErr) throw new Error(settingsErr.message);

  revalidatePath("/settings", "layout");
}

/** Add a user-defined question type. Starts disabled (weight 0) so it doesn't
 * break the enabled-weights-sum-to-100 invariant until the user rebalances. When
 * `recurring` is given, it's created as a recurring post (cadence + sources)
 * instead — kept out of the random rotation by its non-null recurrence_days. */
export async function addCustomQuestionType(
  name: string,
  baseDescription: string,
  memberEmail?: string,
  recurring?: { recurrence_days: number; context_spec: CategoryContextSpec }
): Promise<JournalQuestionType> {
  const slug = name.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error("Name must be letters, numbers, and dashes (e.g. my-topic).");
  }
  if (!baseDescription.trim()) {
    throw new Error("Give the question type a short description.");
  }
  if (recurring && !(Number.isInteger(recurring.recurrence_days) && recurring.recurrence_days > 0)) {
    throw new Error("Cadence must be a whole number of days.");
  }

  const { client, userId } = await resolveSettingsScope(memberEmail);
  const { data: maxRow } = await client
    .from("journal_question_types")
    .select("sort_order")
    .eq("user_id", userId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const sortOrder = (maxRow?.sort_order ?? 0) + 1;

  const { data, error } = await client
    .from("journal_question_types")
    .insert({
      name: slug,
      base_description: baseDescription.trim(),
      weight: 0,
      enabled: false,
      is_builtin: false,
      sort_order: sortOrder,
      user_id: userId,
      recurrence_days: recurring?.recurrence_days ?? null,
      context_spec: recurring?.context_spec ?? null,
    })
    .select(
      "id, name, base_description, style_note, weight, enabled, is_builtin, sort_order, recurrence_days, context_spec, created_at, updated_at"
    )
    .single();
  if (error) {
    if (error.code === "23505") throw new Error(`A question type named "${slug}" already exists.`);
    throw new Error(error.message);
  }
  revalidatePath("/settings", "layout");
  return data as JournalQuestionType;
}

/** Delete a custom question type. Built-ins are protected by the `is_builtin`
 * guard in the query and can only be disabled, never removed. */
export async function deleteCustomQuestionType(id: string, memberEmail?: string) {
  const { client, userId } = await resolveSettingsScope(memberEmail);
  const { error } = await client
    .from("journal_question_types")
    .delete()
    .eq("id", id)
    .eq("is_builtin", false)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings", "layout");
}

// ============================================================
// Profile suggestions (passive User-doc updates surfaced as toasts)
// ============================================================

export async function loadPendingProfileSuggestions(): Promise<JournalProfileSuggestion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("journal_profile_suggestions")
    .select("id, source_entry_id, status, change_type, target_doc, find, replace, summary, created_at, resolved_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as JournalProfileSuggestion[];
}

export type AcceptSuggestionResult =
  | {
      ok: true;
      change_type: JournalProfileSuggestion["change_type"];
      target_doc: JournalProfileSuggestion["target_doc"];
      find: string | null;
      replace: string | null;
    }
  | { ok: false; error: string };

export async function acceptProfileSuggestion(id: string): Promise<AcceptSuggestionResult> {
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("journal_profile_suggestions")
    .select("id, status, change_type, target_doc, find, replace")
    .eq("id", id)
    .single();
  if (error || !row) return { ok: false, error: "Suggestion not found." };
  if (row.status !== "pending") return { ok: false, error: "Already resolved." };

  const applied = await applyProfileDocChange(row.target_doc, {
    change_type: row.change_type,
    find: row.find,
    replace: row.replace,
  });
  if (!applied.ok) {
    // Resolve it anyway so a stale suggestion doesn't keep reappearing.
    await supabase
      .from("journal_profile_suggestions")
      .update({ status: "dismissed", resolved_at: new Date().toISOString() })
      .eq("id", id);
    return { ok: false, error: applied.error };
  }

  await supabase
    .from("journal_profile_suggestions")
    .update({ status: "accepted", resolved_at: new Date().toISOString() })
    .eq("id", id);
  revalidatePath("/settings", "layout");

  return {
    ok: true,
    change_type: row.change_type,
    target_doc: row.target_doc,
    find: row.find,
    replace: row.replace,
  };
}

export async function dismissProfileSuggestion(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("journal_profile_suggestions")
    .update({ status: "dismissed", resolved_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}

// ============================================================
// Entry photos
// ============================================================

const PHOTOS_BUCKET = "journal-photos";

type EntryPhotoAccess =
  | { ok: true; authorId: string; onBehalf: boolean }
  | { ok: false; error: string };

/**
 * Resolve who an entry-photo operation should be attributed to, and whether the
 * caller is acting on someone else's behalf. The author manages their own
 * posts; the account owner may also manage any post they can see (their own +
 * family-shared). Owner-on-behalf writes are attributed to the *entry's author*
 * so the photo lives on the post for the author and family — which means they
 * must run through the admin client, since per-user RLS and the storage
 * {auth.uid()}/... folder convention would otherwise reject them.
 *
 * The entry is read through the RLS-bound user client, so this only ever grants
 * access to posts the caller can already see — other members' private posts
 * resolve to "Entry not found", exactly as they 404 in the UI.
 */
async function authorizeEntryPhotoAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entryId: string
): Promise<EntryPhotoAccess> {
  const userId = await requireUserId(supabase);
  const { data: entry } = await supabase
    .from("journal_entries")
    .select("id, user_id")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return { ok: false, error: "Entry not found." };
  if (entry.user_id === userId) {
    return { ok: true, authorId: userId, onBehalf: false };
  }
  if (await getIsOwner(supabase)) {
    return { ok: true, authorId: entry.user_id as string, onBehalf: true };
  }
  return { ok: false, error: "You can only manage photos on your own posts." };
}

export async function createPhotoUploadUrls(
  entryId: string,
  photoId: string,
  ext: string
): Promise<{
  originalPath: string;
  originalToken: string;
  displayPath: string;
  displayToken: string;
}> {
  const supabase = await createClient();
  const access = await authorizeEntryPhotoAccess(supabase, entryId);
  if (!access.ok) throw new Error(access.error);

  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const originalPath = `${access.authorId}/${entryId}/${photoId}-original.${safeExt}`;
  const displayPath = `${access.authorId}/${entryId}/${photoId}-display.jpg`;

  // Owner-on-behalf uploads land in the author's folder, which the user client's
  // storage policy ({auth.uid()}/...) would reject — sign them with admin.
  const storage = (access.onBehalf ? createAdminClient() : supabase).storage;

  const original = await storage
    .from(PHOTOS_BUCKET)
    .createSignedUploadUrl(originalPath);
  if (original.error || !original.data) {
    throw new Error(
      original.error?.message ?? "Failed to create upload URL"
    );
  }
  const display = await storage
    .from(PHOTOS_BUCKET)
    .createSignedUploadUrl(displayPath);
  if (display.error || !display.data) {
    throw new Error(display.error?.message ?? "Failed to create upload URL");
  }

  return {
    originalPath: original.data.path,
    originalToken: original.data.token,
    displayPath: display.data.path,
    displayToken: display.data.token,
  };
}

export async function attachEntryPhoto(
  entryId: string,
  originalPath: string,
  displayPath: string,
  mediaType: "photo" | "video" = "photo",
  source: JournalPhotoSource = "uploaded"
): Promise<string> {
  const supabase = await createClient();
  const access = await authorizeEntryPhotoAccess(supabase, entryId);
  if (!access.ok) throw new Error(access.error);

  const db = access.onBehalf ? createAdminClient() : supabase;
  const { data, error } = await db
    .from("journal_entry_photos")
    .insert({
      entry_id: entryId,
      original_path: originalPath,
      display_path: displayPath,
      media_type: mediaType,
      source,
      user_id: access.authorId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to attach photo");
  revalidatePath("/journal");
  revalidatePath(`/journal/${entryId}`);
  return data.id as string;
}

export async function deleteEntryPhoto(photoId: string): Promise<void> {
  const supabase = await createClient();
  // Read the row with admin first: the owner can't see another member's photo
  // under RLS, so we need its entry before we can authorize the delete.
  const admin = createAdminClient();
  const { data: photo } = await admin
    .from("journal_entry_photos")
    .select("entry_id, original_path, display_path")
    .eq("id", photoId)
    .maybeSingle();
  if (!photo) return;

  const access = await authorizeEntryPhotoAccess(
    supabase,
    photo.entry_id as string
  );
  if (!access.ok) throw new Error(access.error);

  const db = access.onBehalf ? admin : supabase;
  const storage = (access.onBehalf ? admin : supabase).storage;

  const paths = [...new Set([photo.original_path, photo.display_path])].filter(
    (p): p is string => Boolean(p)
  );
  if (paths.length > 0) {
    await storage.from(PHOTOS_BUCKET).remove(paths);
  }

  const { error } = await db
    .from("journal_entry_photos")
    .delete()
    .eq("id", photoId);
  if (error) throw new Error(error.message);
  revalidatePath("/journal");
  if (photo.entry_id) revalidatePath(`/journal/${photo.entry_id}`);
}

export async function createSignedPhotoUrl(
  displayPath: string
): Promise<string> {
  const supabase = await createClient();
  // Photos live under {authorId}/... — the user client can only sign its own
  // folder. The account owner may sign another author's path (e.g. the optimistic
  // preview right after attaching a photo to someone else's post), via admin.
  const userId = await requireUserId(supabase);
  const authorSegment = displayPath.split("/")[0];
  const onBehalf = authorSegment !== userId;
  if (onBehalf && !(await getIsOwner(supabase))) {
    throw new Error("Not authorized to view this photo.");
  }
  const client = onBehalf ? createAdminClient() : supabase;
  const { data, error } = await client.storage
    .from(PHOTOS_BUCKET)
    .createSignedUrl(displayPath, 60 * 60);
  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create signed photo URL");
  }
  return data.signedUrl;
}

export async function getEntriesPhotos(
  entryIds: string[]
): Promise<
  Record<
    string,
    {
      id: string;
      displayUrl: string;
      videoUrl: string | null;
      mediaType: JournalMediaType;
      source: JournalPhotoSource;
    }[]
  >
> {
  if (entryIds.length === 0) return {};
  // entryIds are already scoped to posts the caller can see (own posts plus
  // closed family-visible ones). The journal-photos bucket's per-user folder
  // RLS, though, only lets a member sign files in their OWN folder — so a
  // non-owner viewing the family feed would get blank URLs for other members'
  // photos (only the owner, who signs via admin, saw them). Sign with admin for
  // every viewer: since entryIds are pre-scoped, this only reveals photos on
  // posts the caller can already see, never posts they can't.
  const client = createAdminClient();
  const { data: rows } = await client
    .from("journal_entry_photos")
    .select("id, entry_id, display_path, original_path, media_type, source")
    .in("entry_id", entryIds)
    .order("created_at", { ascending: true });

  if (!rows || rows.length === 0) return {};

  const { data: signed } = await client.storage
    .from(PHOTOS_BUCKET)
    .createSignedUrls(
      rows.map((r) => r.display_path as string),
      60 * 60
    );

  // Videos also need a signed URL for the original file so the lightbox can
  // play it (e.g. a timeline cover sourced from a linked journal entry).
  const videoRows = rows.filter((r) => r.media_type === "video");
  const { data: signedVideo } = videoRows.length
    ? await client.storage
        .from(PHOTOS_BUCKET)
        .createSignedUrls(
          videoRows.map((r) => r.original_path as string),
          60 * 60
        )
    : { data: null };
  const videoUrlById = new Map<string, string>();
  videoRows.forEach((row, i) => {
    const url = signedVideo?.[i]?.signedUrl;
    if (url) videoUrlById.set(row.id as string, url);
  });

  const result: Record<
    string,
    {
      id: string;
      displayUrl: string;
      videoUrl: string | null;
      mediaType: JournalMediaType;
      source: JournalPhotoSource;
    }[]
  > = {};
  rows.forEach((row, i) => {
    const entryId = row.entry_id as string;
    (result[entryId] ??= []).push({
      id: row.id as string,
      displayUrl: signed?.[i]?.signedUrl ?? "",
      videoUrl: videoUrlById.get(row.id as string) ?? null,
      mediaType: (row.media_type as JournalMediaType) ?? "photo",
      source: (row.source as JournalPhotoSource) ?? "uploaded",
    });
  });
  return result;
}

export async function getEntryPhotos(entryId: string): Promise<
  {
    id: string;
    mediaType: JournalMediaType;
    source: JournalPhotoSource;
    displayUrl: string;
    videoUrl: string | null;
  }[]
> {
  const supabase = await createClient();
  // The owner can manage photos on posts they can see, so they must also read
  // them — those rows belong to the author and are invisible under the user
  // client's per-user RLS, so read them (and sign their URLs) with admin.
  const access = await authorizeEntryPhotoAccess(supabase, entryId);
  const client = access.ok && access.onBehalf ? createAdminClient() : supabase;
  const { data: rows } = await client
    .from("journal_entry_photos")
    .select("id, media_type, source, original_path, display_path")
    .eq("entry_id", entryId)
    .order("created_at", { ascending: true });

  if (!rows || rows.length === 0) return [];

  const { data: signedDisplay } = await client.storage
    .from(PHOTOS_BUCKET)
    .createSignedUrls(
      rows.map((r) => r.display_path as string),
      60 * 60
    );

  // Videos also need a signed URL for the original file so the lightbox can
  // play it; photos never use the original at display time.
  const videoRows = rows.filter((r) => r.media_type === "video");
  const { data: signedVideo } = videoRows.length
    ? await client.storage
        .from(PHOTOS_BUCKET)
        .createSignedUrls(
          videoRows.map((r) => r.original_path as string),
          60 * 60
        )
    : { data: null };
  const videoUrlByPath = new Map<string, string>();
  videoRows.forEach((row, i) => {
    const url = signedVideo?.[i]?.signedUrl;
    if (url) videoUrlByPath.set(row.original_path as string, url);
  });

  return rows.map((row, i) => ({
    id: row.id as string,
    mediaType: (row.media_type as JournalMediaType) ?? "photo",
    source: (row.source as JournalPhotoSource) ?? "uploaded",
    displayUrl: signedDisplay?.[i]?.signedUrl ?? "",
    videoUrl:
      row.media_type === "video"
        ? videoUrlByPath.get(row.original_path as string) ?? null
        : null,
  }));
}

// ============================================================
// Inline family comments
//
// Comments live on finished, shared posts: family members reply between the
// content blocks of each other's entries. RLS (00065) is the real gate; the
// guards here surface friendly errors before the round-trip.
// ============================================================

/**
 * Add a comment anchored to `blockIndex` on a closed, family-shared entry.
 * Returns the persisted row plus the commenter's display name, so the client
 * can render it immediately with a real id (no temp-id reconciliation).
 */
export async function addInlineComment(
  entryId: string,
  blockIndex: number,
  content: string
): Promise<JournalInlineCommentWithAuthor> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Comment is empty.");
  if (!Number.isInteger(blockIndex) || blockIndex < 0) {
    throw new Error("Invalid comment anchor.");
  }

  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  const { data: entry } = await supabase
    .from("journal_entries")
    .select("id, status, visibility")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) throw new Error("Entry not found.");
  if (entry.status !== "closed" || entry.visibility !== "family") {
    throw new Error("Comments are only allowed on finished, shared posts.");
  }

  const { data, error } = await supabase
    .from("journal_inline_comments")
    .insert({
      entry_id: entryId,
      user_id: userId,
      block_index: blockIndex,
      content: trimmed,
    })
    .select("id, entry_id, user_id, block_index, content, created_at, updated_at")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't add comment.");

  const { data: member } = await supabase
    .from("family_members")
    .select("name, email")
    .eq("user_id", userId)
    .maybeSingle();
  const authorName =
    (member?.name as string | null)?.trim() ||
    (member?.email as string | undefined) ||
    "A family member";

  revalidatePath(`/journal/${entryId}`);
  return { ...(data as JournalInlineComment), authorName };
}

/**
 * Record that the current user has opened an entry's page, dismissing its
 * notification. Upserts journal_entry_views.last_viewed_at = now() — which
 * clears both "new post" and "unread comments" at once (see
 * src/lib/journal/notifications.ts). Revalidates the journal layout so the
 * header badge recomputes. Fired once on mount from the entry page; safe to
 * call for any entry (only family posts ever contribute to the badge).
 */
export async function markEntryViewed(entryId: string): Promise<void> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);

  await supabase
    .from("journal_entry_views")
    .upsert(
      { user_id: userId, entry_id: entryId, last_viewed_at: new Date().toISOString() },
      { onConflict: "user_id,entry_id" }
    );

  revalidatePath("/journal", "layout");
}

/** Edit one of your own comments. RLS restricts this to the comment's author. */
export async function editInlineComment(commentId: string, content: string) {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Comment is empty.");

  const supabase = await createClient();
  await requireUserId(supabase);

  const { data, error } = await supabase
    .from("journal_inline_comments")
    .update({ content: trimmed })
    .eq("id", commentId)
    .select("entry_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Couldn't edit that comment.");

  revalidatePath(`/journal/${data.entry_id as string}`);
}

/**
 * Delete a comment. RLS allows the comment's author or the account owner
 * (moderation). We read entry_id first so we can revalidate the right page.
 */
export async function deleteInlineComment(commentId: string) {
  const supabase = await createClient();
  await requireUserId(supabase);

  const { data: row } = await supabase
    .from("journal_inline_comments")
    .select("entry_id")
    .eq("id", commentId)
    .maybeSingle();

  const { error } = await supabase
    .from("journal_inline_comments")
    .delete()
    .eq("id", commentId);
  if (error) throw new Error(error.message);

  if (row?.entry_id) revalidatePath(`/journal/${row.entry_id as string}`);
}
