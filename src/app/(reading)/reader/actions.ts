"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserTimezone, getWeekStart, localDate } from "@/lib/date-utils";
import {
  lookupBookByTitle,
  type BookLookupResult,
} from "@/lib/reading/book-lookup";
import { categorizeBook, spoilerDefaultFor } from "@/lib/reading/categorize";
import type { ReadingGenre } from "@/lib/reading/book-genres";
import { resolveReadingScope } from "@/lib/reading/scope";
import type { ResumeCandidate } from "@/lib/reading/last-place";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import { computeBookWordCounts } from "@/lib/reading/word-counts";
import {
  blockMarksFromHtml,
  layoutSyntheticPages,
} from "@/lib/reading/synthetic-pages";
import { capTarget, defaultTargetPage } from "@/lib/reading/targets";
import { readingTargetDueDateKey } from "@/lib/reading/target-due";
import { resolveNextTarget } from "@/lib/reading/next-target";
import {
  chapterSpans,
  contentWordCount,
  wordsToPage,
} from "@/lib/reading/chapter-target";
import {
  advanceStretch,
  ensureStretchQuizInline,
  readingIncrement,
} from "@/lib/reading/advance";
import { sumMetricSince } from "@/lib/reading/milestones";
import { getActiveQuizzesByBook } from "@/app/(books)/books/quizzes/actions";
import type {
  ReadingBook,
  ReadingBookContentSummary,
  ReadingBookJournalEntry,
  ReadingBookStatus,
  ReadingBookWithProgress,
  ReadingHome,
  ReadingRating,
  ReadingTargetChapter,
  ReadingTocEntry,
} from "@/lib/types";

// Every column ReadingBook declares. The two must stay in step: the rows are
// cast straight to ReadingBook, so a field in the type but not in this list is a
// silent `undefined` at runtime.
const BOOK_COLUMNS =
  "id, user_id, type, title, author, source_url, site_name, excerpt, word_count, total_pages, current_page, target_page, target_locked, target_due, target_chapter, status, cover_image_url, openlibrary_key, isbn, published_year, fiction, genre, genre_source, genres, spoiler_free, started_at, finished_at, rating, rated_at, recommended_by_email, recommended_by_label, recommendation_note, sort_order, created_at, updated_at";

function firstName(name: string | null | undefined, fallback: string): string {
  return name?.trim().split(/\s+/)[0] || fallback;
}

/** Ask the AI to resolve a book from its title (used by the add flow). */
export async function lookupBook(title: string): Promise<BookLookupResult> {
  return lookupBookByTitle(title);
}

/**
 * Other family members you can recommend a book to (everyone who's signed in,
 * excluding yourself). Available to any member, so it reads via the service role
 * — family_members RLS otherwise hides other members' rows.
 */
export async function listRecommendRecipients(): Promise<
  { email: string; name: string | null }[]
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const callerEmail = user.email?.toLowerCase() ?? null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("family_members")
    .select("email, name, user_id")
    .not("user_id", "is", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((m) => m.email !== callerEmail)
    .map((m) => ({ email: m.email as string, name: (m.name as string) ?? null }));
}

/**
 * Recommend a book to another family member: adds it to their queue, stamped
 * with who it's from (resolved to "Dad"/"Mom"/first name via the parent links)
 * and an optional note. Any signed-in member can recommend; the write goes
 * through the service role because the row belongs to the recipient, not the
 * caller. The recommender email always comes from the session, never input.
 */
export async function recommendBook(input: {
  recipientEmail: string;
  title: string;
  author?: string | null;
  totalPages?: number | null;
  coverImageUrl?: string | null;
  openlibraryKey?: string | null;
  isbn?: string | null;
  publishedYear?: number | null;
  note?: string | null;
}): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const fromEmail = user?.email?.toLowerCase();
  if (!fromEmail) throw new Error("Not authenticated");

  const recipientEmail = input.recipientEmail.trim().toLowerCase();
  if (recipientEmail === fromEmail) {
    throw new Error("Pick someone else to recommend to.");
  }
  const title = input.title.trim();
  if (!title) throw new Error("Give the book a title.");

  const admin = createAdminClient();
  const { data: people, error: peopleError } = await admin
    .from("family_members")
    .select("email, name, user_id, mother_email, father_email")
    .in("email", [fromEmail, recipientEmail]);
  if (peopleError) throw new Error(peopleError.message);

  const me = people?.find((p) => p.email === fromEmail);
  const recipient = people?.find((p) => p.email === recipientEmail);
  if (!me) throw new Error("Not authorized.");
  if (!recipient) throw new Error("That person isn't a family member.");
  if (!recipient.user_id) {
    throw new Error("That person hasn't signed in yet, so they have no list.");
  }

  // How the recipient should see this recommender.
  let label: string;
  if (recipient.father_email === fromEmail) label = "Dad";
  else if (recipient.mother_email === fromEmail) label = "Mom";
  else label = firstName(me.name as string | null, fromEmail);

  const totalPages =
    input.totalPages != null && input.totalPages > 0 ? input.totalPages : null;

  const recommendedAuthor = input.author?.trim() || null;
  const { data: recommended, error } = await admin
    .from("reading_books")
    .insert({
      user_id: recipient.user_id,
      title,
      author: recommendedAuthor,
      total_pages: totalPages,
      current_page: 0,
      status: "queued",
      cover_image_url: input.coverImageUrl ?? null,
      openlibrary_key: input.openlibraryKey?.trim() || null,
      isbn: input.isbn?.trim() || null,
      published_year:
        input.publishedYear != null && input.publishedYear > 0
          ? input.publishedYear
          : null,
      recommended_by_email: fromEmail,
      recommended_by_label: label,
      recommendation_note: input.note?.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  after(() =>
    categorizeBook(admin, {
      id: recommended.id,
      title,
      author: recommendedAuthor,
    })
  );
  revalidatePath("/reader");
}

/**
 * Every book the (scoped) member is tracking, across all statuses, plus this
 * week's derived progress and their weekly page goal. Pass a member email to let
 * the owner view another family member's reading. Weekly aggregates only count
 * in-progress books — the goal is about active reading.
 */
export async function getReadingHome(memberEmail?: string | null): Promise<ReadingHome> {
  const { client, userId, email } = await resolveReadingScope(memberEmail);

  const tz = await getUserTimezone();
  const weekStart = getWeekStart(localDate(new Date(), tz));

  const [{ data: bookRows }, { data: goalRow }] = await Promise.all([
    client
      .from("reading_books")
      .select(BOOK_COLUMNS)
      .eq("user_id", userId)
      // The shelf's own order: hand-sorted, with created_at only breaking ties.
      // Backfilled positions reproduce creation order, so nothing moved when the
      // column arrived — only what you drag, and what you add, changes it.
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    email
      ? client
          .from("reading_settings")
          .select("weekly_page_goal")
          .eq("member_email", email)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const books = (bookRows ?? []) as ReadingBook[];
  const bookIds = books.map((b) => b.id);

  // Uploaded-content and reader-resume state for every book, so the list can
  // surface the Read button and upload/replace affordances without a detail page.
  const contentByBook = new Map<string, ReadingBookContentSummary>();
  const resumeBooks = new Set<string>();
  // How far through each book the e-reader last was (0–1), for the shelf's
  // percent-complete label.
  const readerRatio = new Map<string, number>();
  // Closed journal entries linked to each book (from currently-reading questions),
  // newest first, so the card can show "From your journal".
  const relatedByBook = new Map<string, ReadingBookJournalEntry[]>();
  // Marked passages per book, for the shelf's "· 24 notes". Counted in the
  // database rather than here: see the view's own migration for why.
  const annotationsByBook = new Map<string, number>();
  if (bookIds.length > 0) {
    const [
      { data: contentRows },
      { data: stateRows },
      { data: entryRows },
      { data: annotationRows },
    ] = await Promise.all([
        client
          .from("reading_book_content")
          .select("book_id, status, page_count, has_real_pages, word_count, error_message")
          .eq("user_id", userId)
          .in("book_id", bookIds),
        client
          .from("reading_book_state")
          .select("book_id, last_anchor_id, last_scroll_ratio")
          .eq("user_id", userId)
          .in("book_id", bookIds),
        client
          .from("journal_entries")
          .select("id, reading_book_id, title, pull_quote, entry_date")
          .eq("user_id", userId)
          .eq("status", "closed")
          .in("reading_book_id", bookIds)
          .order("entry_date", { ascending: false }),
        // Not filtered by book: the view already holds one row per book you've
        // marked, so the whole shelf's worth is smaller than the id list would be.
        client
          .from("reading_annotation_counts")
          .select("book_id, annotation_count")
          .eq("user_id", userId),
      ]);
    for (const c of contentRows ?? []) {
      contentByBook.set(c.book_id as string, {
        status: c.status as ReadingBookContentSummary["status"],
        page_count: (c.page_count as number) ?? null,
        has_real_pages: (c.has_real_pages as boolean) ?? false,
        word_count: (c.word_count as number) ?? null,
        error_message: (c.error_message as string) ?? null,
      });
    }
    for (const s of stateRows ?? []) {
      if (s.last_anchor_id) resumeBooks.add(s.book_id as string);
      const ratio = s.last_scroll_ratio as number | null;
      if (ratio != null) readerRatio.set(s.book_id as string, ratio);
    }
    for (const e of entryRows ?? []) {
      const bookId = e.reading_book_id as string;
      const list = relatedByBook.get(bookId) ?? [];
      list.push({
        id: e.id as string,
        title: (e.title as string | null) ?? null,
        pull_quote: (e.pull_quote as string | null) ?? null,
        entry_date: e.entry_date as string,
      });
      relatedByBook.set(bookId, list);
    }
    for (const a of annotationRows ?? []) {
      annotationsByBook.set(a.book_id as string, (a.annotation_count as number) ?? 0);
    }
  }

  // Derive each book's "page at the start of this week" from its check-ins:
  // the most recent check-in before Monday, or — for a book only started this
  // week — its earliest check-in (the starting page), so progress counts from there.
  const baselineBeforeWeek = new Map<string, { page: number; on: string }>();
  const earliestCheckin = new Map<string, { page: number; on: string }>();
  let checkedInThisWeek = false;
  if (bookIds.length > 0) {
    const { data: checkins } = await client
      .from("reading_checkins")
      .select("book_id, page, checked_on")
      .eq("user_id", userId)
      .in("book_id", bookIds);
    for (const c of checkins ?? []) {
      const bookId = c.book_id as string;
      const on = c.checked_on as string;
      const page = c.page as number;
      if (on >= weekStart) checkedInThisWeek = true;
      if (on < weekStart) {
        const prev = baselineBeforeWeek.get(bookId);
        if (!prev || on > prev.on) baselineBeforeWeek.set(bookId, { page, on });
      }
      const earliest = earliestCheckin.get(bookId);
      if (!earliest || on < earliest.on) earliestCheckin.set(bookId, { page, on });
    }
  }

  const withProgress: ReadingBookWithProgress[] = books.map((book) => {
    const baseline =
      baselineBeforeWeek.get(book.id)?.page ??
      earliestCheckin.get(book.id)?.page ??
      book.current_page;
    const ratio = readerRatio.get(book.id);
    return {
      ...book,
      pagesReadThisWeek: Math.max(0, book.current_page - baseline),
      content: contentByBook.get(book.id) ?? null,
      hasResumePoint: resumeBooks.has(book.id),
      readerPercent:
        ratio == null
          ? null
          : Math.min(100, Math.max(0, Math.round(ratio * 100))),
      annotationCount: annotationsByBook.get(book.id) ?? 0,
      relatedEntries: relatedByBook.get(book.id) ?? [],
    };
  });

  const totalReadThisWeek = withProgress
    .filter((b) => b.status === "in_progress")
    .reduce((sum, b) => sum + b.pagesReadThisWeek, 0);

  // Lifetime bonus pages (now credited 1:1 as Mason Bucks; see the bucks app).
  const bonusPagesTotal = await sumMetricSince(client, userId, "bonus_pages", null);

  return {
    books: withProgress,
    weeklyPageGoal: goalRow?.weekly_page_goal ?? 0,
    totalReadThisWeek,
    checkedInThisWeek,
    bonusPagesTotal,
  };
}

/**
 * Add a book. The title-first add flow resolves author/pages/cover via the AI;
 * the ambiguous fallback passes them in explicitly. The starting page isn't
 * collected here — members set it with their first check-in.
 */
export async function addBook(input: {
  title: string;
  author?: string | null;
  totalPages?: number | null;
  status?: ReadingBookStatus;
  coverImageUrl?: string | null;
  openlibraryKey?: string | null;
  isbn?: string | null;
  publishedYear?: number | null;
  rating?: ReadingRating | null;
  /** Free-text genre labels from the AI lookup; informational. */
  genres?: string[] | null;
  /**
   * Whether this is fiction, when the AI lookup already resolved it. Null (the
   * typeahead and manual paths) means the post-save classifier answers instead.
   */
  fiction?: boolean | null;
  /** The taxonomy genre, when the AI lookup already resolved it. */
  genre?: ReadingGenre | null;
  memberEmail?: string | null;
}): Promise<void> {
  const { client, userId, email } = await resolveReadingScope(input.memberEmail);

  const title = input.title.trim();
  if (!title) throw new Error("Give the book a title.");
  const author = input.author?.trim() || null;
  const totalPages =
    input.totalPages != null && input.totalPages > 0 ? input.totalPages : null;
  const openlibraryKey = input.openlibraryKey?.trim() || null;
  const isbn = input.isbn?.trim() || null;
  const publishedYear =
    input.publishedYear != null && input.publishedYear > 0
      ? input.publishedYear
      : null;
  const status: ReadingBookStatus = input.status ?? "in_progress";

  // Don't silently create duplicates. Match on the Open Library key when we have
  // one (precise), otherwise on a case-insensitive title (best effort).
  const dupeQuery = client
    .from("reading_books")
    .select("id")
    .eq("user_id", userId)
    .limit(1);
  const { data: existing } = openlibraryKey
    ? await dupeQuery.eq("openlibrary_key", openlibraryKey)
    : await dupeQuery.ilike("title", title);
  if (existing && existing.length > 0) {
    throw new Error(`"${title}" is already on this list.`);
  }

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  const archived = status === "archive";
  // A rating only makes sense on a book they're done with.
  const rating = archived ? input.rating ?? null : null;
  // A "didn't finish" book wasn't read to the end, so don't slam it to the back.
  const finished = archived && rating !== "didnt_finish";
  // A freshly-started book aims for current_page + the member's weekly increment.
  const targetPage =
    status === "in_progress"
      ? defaultTargetPage(0, await readingIncrement(client, email), totalPages)
      : null;
  const { data: book, error } = await client
    .from("reading_books")
    .insert({
      user_id: userId,
      title,
      author,
      total_pages: totalPages,
      current_page: finished && totalPages ? totalPages : 0,
      target_page: targetPage,
      target_due: targetPage != null ? readingTargetDueDateKey(today) : null,
      status,
      cover_image_url: input.coverImageUrl ?? null,
      openlibrary_key: openlibraryKey,
      isbn,
      published_year: publishedYear,
      genres: input.genres ?? null,
      fiction: input.fiction ?? null,
      genre: input.genre ?? null,
      genre_source: input.genre ? "ai" : null,
      spoiler_free: spoilerDefaultFor(input.fiction ?? null),
      started_at: status === "in_progress" ? today : null,
      finished_at: finished ? today : null,
      rating,
      rated_at: rating ? today : null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Classify after the response, so the add returns as soon as the book is saved
  // and every entry path gets categorised — five of the six never touch the AI
  // lookup that would otherwise be the only source of these fields. Skipped when
  // the lookup already answered both questions.
  if (input.fiction == null || !input.genre) {
    const bookId = book.id;
    after(() =>
      categorizeBook(
        client,
        { id: bookId, title, author },
        { fiction: input.fiction, genre: input.genre }
      )
    );
  }

  // Anchor weekly progress for active books: a baseline check-in at the start of
  // this week so the first real check-in counts from page 0, not from itself.
  if (status === "in_progress") {
    const { error: checkinError } = await client.from("reading_checkins").insert({
      user_id: userId,
      book_id: book.id,
      checked_on: getWeekStart(today),
      page: 0,
    });
    if (checkinError) throw new Error(checkinError.message);
  }

  revalidatePath("/reader");
}

/** Edit a book's details and/or status. Manages finished_at on status changes. */
export async function updateBook(
  bookId: string,
  input: {
    title?: string;
    author?: string | null;
    totalPages?: number | null;
    status?: ReadingBookStatus;
    currentPage?: number | null;
    targetPage?: number | null;
    rating?: ReadingRating | null;
    /** Why this book is in your queue. Starts as the recommender's rationale or
     * the note a family member sent it with, and is yours to rewrite from there. */
    recommendationNote?: string | null;
    /** A hand correction to the classifier. Sending either stamps genre_source. */
    fiction?: boolean | null;
    genre?: ReadingGenre | null;
    memberEmail?: string | null;
  }
): Promise<void> {
  const scope = await resolveReadingScope(input.memberEmail);
  const { client, userId, email } = scope;

  const { data: existing, error: fetchError } = await client
    .from("reading_books")
    .select("status, total_pages, current_page, target_page, target_locked, target_due, started_at")
    .eq("id", bookId)
    .eq("user_id", userId)
    .single();
  if (fetchError) throw new Error(fetchError.message);

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  const update: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new Error("Give the book a title.");
    update.title = title;
  }
  if (input.author !== undefined) update.author = input.author?.trim() || null;
  if (input.totalPages !== undefined) {
    update.total_pages =
      input.totalPages != null && input.totalPages > 0 ? input.totalPages : null;
  }
  if (input.currentPage !== undefined && input.currentPage != null) {
    update.current_page = Math.max(0, Math.floor(input.currentPage));
  }
  if (input.rating !== undefined) {
    update.rating = input.rating;
    // Re-stamp when the opinion was formed (or clear it), for recency weighting.
    update.rated_at = input.rating ? today : null;
  }
  if (input.recommendationNote !== undefined) {
    update.recommendation_note = input.recommendationNote?.trim() || null;
  }
  // A hand-set category outranks the classifier for good: genre_source is what
  // the backfill checks before overwriting, so stamping it here is what makes a
  // correction survive the next re-run.
  if (input.fiction !== undefined || input.genre !== undefined) {
    if (input.fiction !== undefined) {
      update.fiction = input.fiction;
      update.spoiler_free = spoilerDefaultFor(input.fiction);
    }
    if (input.genre !== undefined) update.genre = input.genre;
    update.genre_source = "manual";
  }

  let startedReading = false;
  if (input.status !== undefined && input.status !== existing.status) {
    update.status = input.status;
    if (input.status === "archive") {
      update.finished_at = today;
      // Default to the back cover when archiving a finished book, unless they set
      // a page here or marked it as one they didn't finish.
      const rating = input.rating !== undefined ? input.rating : null;
      if (input.currentPage == null && existing.total_pages && rating !== "didnt_finish") {
        update.current_page = existing.total_pages;
      }
    } else {
      update.finished_at = null;
    }
    if (input.status === "in_progress") {
      startedReading = true;
      if (!existing.started_at) update.started_at = today;
    }
  }

  // Per-book target. An explicit value locks it (the owner's override for the
  // week); otherwise it tracks current_page + the member's increment whenever the
  // book becomes active or its current page moves (unless the owner locked it).
  const increment = await readingIncrement(client, email);
  const newCurrentProvided = typeof update.current_page === "number";
  const effectiveCurrent = newCurrentProvided
    ? (update.current_page as number)
    : existing.current_page;
  const effectiveTotal =
    input.totalPages !== undefined
      ? (update.total_pages as number | null)
      : existing.total_pages;

  if (input.targetPage !== undefined) {
    // An explicit page is an owner override: a plain page goal, never a chapter.
    if (input.targetPage == null) {
      update.target_page = null;
      update.target_locked = false;
    } else {
      update.target_page = capTarget(
        Math.max(1, Math.floor(input.targetPage)),
        effectiveTotal
      );
      update.target_locked = true;
    }
    update.target_chapter = null;
  } else if (startedReading || (newCurrentProvided && !existing.target_locked)) {
    // Auto-tracked: snap to a chapter for synthetic-page books, else a page goal.
    const next = await resolveNextTarget(
      client,
      userId,
      { id: bookId, total_pages: effectiveTotal },
      effectiveCurrent,
      increment
    );
    update.target_page = next.targetPage;
    update.target_chapter = next.targetChapter;
    if (startedReading) update.target_locked = false;
  }

  // Only an actively-read book carries a target.
  const finalStatus =
    (update.status as ReadingBookStatus | undefined) ?? existing.status;
  if (finalStatus !== "in_progress") {
    update.target_page = null;
    update.target_locked = false;
    update.target_chapter = null;
  }

  // Keep the due date in step with the target: cleared targets lose it, and a
  // target that actually changed (or a legacy book with no due date yet) gets a
  // fresh deadline — the Friday after today. An unchanged target keeps its date.
  if ("target_page" in update) {
    const newTarget = update.target_page as number | null;
    if (newTarget == null) {
      update.target_due = null;
    } else if (newTarget !== existing.target_page || existing.target_due == null) {
      update.target_due = readingTargetDueDateKey(today);
    }
  }

  if (Object.keys(update).length === 0) return;

  const { error } = await client
    .from("reading_books")
    .update(update)
    .eq("id", bookId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  // Becoming active (e.g. promoted from the queue): anchor this week's progress
  // at the current page, mirroring how a freshly-added in-progress book is
  // seeded, so the first real check-in counts pages read — not from zero twice.
  if (startedReading) {
    const baselinePage =
      typeof update.current_page === "number"
        ? update.current_page
        : existing.current_page;
    const { error: checkinError } = await client.from("reading_checkins").insert({
      user_id: userId,
      book_id: bookId,
      checked_on: getWeekStart(today),
      page: baselinePage,
    });
    if (checkinError) throw new Error(checkinError.message);

    // Prepare the first stretch's quiz if the file is already converted (no-op
    // otherwise; the convert route fires this when the upload finishes).
    await ensureStretchQuizInline(scope, {
      id: bookId,
      current_page: baselinePage,
      target_page: (update.target_page as number | null) ?? null,
      total_pages: existing.total_pages,
    });
  }

  // Manually setting the current page declares where the member *is* — not pages
  // read this week. If the only check-in this week is the auto-seeded baseline
  // (no real check-ins yet), re-anchor it to the new page so the weekly target
  // recalculates from there. Without this, adding a book and then setting the
  // page leaves the baseline at 0, so the week's target stays stuck low.
  if (
    !startedReading &&
    typeof update.current_page === "number" &&
    update.status !== "archive"
  ) {
    const weekStart = getWeekStart(today);
    const { data: weekCheckins } = await client
      .from("reading_checkins")
      .select("id, checked_on")
      .eq("user_id", userId)
      .eq("book_id", bookId)
      .gte("checked_on", weekStart);
    if (
      weekCheckins?.length === 1 &&
      weekCheckins[0].checked_on === weekStart
    ) {
      const { error: anchorError } = await client
        .from("reading_checkins")
        .update({ page: update.current_page })
        .eq("id", weekCheckins[0].id);
      if (anchorError) throw new Error(anchorError.message);
    }
  }

  revalidatePath("/reader");
}

export type MarkReachedResult =
  | { outcome: "advanced"; finished: boolean; nextTarget: number | null }
  | { outcome: "quiz"; quizId: string }
  | { outcome: "quiz_pending" };

/**
 * Mark a book's weekly target reached — binary, no page entry. For a book with an
 * uploaded+converted file, this routes the reader into the stretch quiz (passing it
 * is what advances the milestone — see submitQuiz). For a book without a file, it
 * advances directly. Changing the target page (for bonus reading) is a separate
 * action — see changeStretchTarget.
 */
export async function markTargetReached(
  bookId: string,
  memberEmail?: string | null
): Promise<MarkReachedResult> {
  const scope = await resolveReadingScope(memberEmail);
  const { client, userId } = scope;

  const { data: book, error } = await client
    .from("reading_books")
    .select("id, current_page, target_page, total_pages")
    .eq("id", bookId)
    .eq("user_id", userId)
    .single();
  if (error) throw new Error(error.message);

  const stretchBook = {
    id: book.id as string,
    current_page: book.current_page as number,
    target_page: (book.target_page as number | null) ?? null,
    total_pages: (book.total_pages as number | null) ?? null,
  };

  // Reuse the live (published, unpassed) quiz only when it still covers the current
  // goal. If the goal moved (changeStretchTarget leaves the quiz alone for speed),
  // the existing quiz is stale and we regenerate it here — this is where the brief
  // "building your quiz" wait belongs, since the reader is about to take it.
  const target = stretchBook.target_page;
  const active = await getActiveQuizzesByBook([bookId], memberEmail);
  const activeQuiz = active[bookId];
  if (activeQuiz && (target == null || activeQuiz.throughPage === target)) {
    return { outcome: "quiz", quizId: activeQuiz.quizId };
  }

  // A book "with quizzes" is one whose uploaded file has converted to ready text.
  const { data: content } = await client
    .from("reading_book_content")
    .select("status")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  const hasContent = content?.status === "ready";

  if (!hasContent) {
    // Can't (re)build a quiz without content: use a live one if it exists (even at
    // a stale range — better than nothing), else advance directly.
    if (activeQuiz) return { outcome: "quiz", quizId: activeQuiz.quizId };
    const { finished, nextTarget } = await advanceStretch(scope, stretchBook);
    return { outcome: "advanced", finished, nextTarget };
  }

  // Quiz-gated: build (or rebuild) the quiz for the current range; this supersedes
  // a stale one. Passing it advances the milestone; we don't advance here.
  const ensured = await ensureStretchQuizInline(scope, stretchBook);
  if (ensured.quizId) return { outcome: "quiz", quizId: ensured.quizId };
  // Generation not ready — fall back to a stale live quiz rather than blocking.
  if (activeQuiz) return { outcome: "quiz", quizId: activeQuiz.quizId };
  return { outcome: "quiz_pending" };
}

/**
 * Change a book's stretch target page — the bonus opt-in. The reader (or a parent
 * viewing as them) sets how far they're aiming this stretch, clamped to [normal
 * weekly target, last page]: push past the goal for bonus pages, or dial back down
 * to the weekly goal, never below. Fast: this only moves the goal — the stretch
 * quiz is (re)built lazily when the quiz is next taken (see markTargetReached), so
 * changing the goal doesn't wait on quiz generation. Bonus banks when the quiz that
 * covers the new range is passed. Returns the clamped target.
 */
export async function changeStretchTarget(
  bookId: string,
  choice: { targetPage?: number; chapterIndex?: number; dueDate?: string },
  memberEmail?: string | null
): Promise<{ target: number }> {
  const scope = await resolveReadingScope(memberEmail);
  const { client, userId, email } = scope;

  const { data: book, error } = await client
    .from("reading_books")
    .select("id, current_page, target_page, total_pages, status")
    .eq("id", bookId)
    .eq("user_id", userId)
    .single();
  if (error) throw new Error(error.message);
  if (book.status !== "in_progress") {
    throw new Error("This book isn't being read right now.");
  }

  const currentPage = book.current_page as number;
  const totalPages = (book.total_pages as number | null) ?? null;
  if (totalPages == null) {
    throw new Error("Add this book's page count before changing the goal.");
  }

  // An explicit due date means a parent-admin override: allow any forward target
  // (not just past this week's goal) and set exactly the date they chose. The
  // kid's own change stays clamped to the weekly floor with the auto Friday date.
  const adminSet = choice.dueDate != null;
  if (adminSet && !/^\d{4}-\d{2}-\d{2}$/.test(choice.dueDate!)) {
    throw new Error("Enter a valid due date.");
  }
  const increment = await readingIncrement(client, email);
  const normalTarget = defaultTargetPage(currentPage, increment, totalPages);
  const floor = adminSet ? currentPage + 1 : (normalTarget ?? currentPage + 1);

  // Resolve the requested goal to a page, plus a chapter label when the reader
  // picked a chapter (and it survives the [floor, last page] clamp).
  let requestedPage: number;
  let targetChapter: ReadingTargetChapter | null = null;
  if (choice.chapterIndex != null) {
    const chapter = await resolveChapterChoice(client, userId, bookId, choice.chapterIndex);
    if (!chapter) throw new Error("Couldn't find that chapter.");
    requestedPage = chapter.endPage;
    // The chapter label only holds if the clamp doesn't move the target off it.
    if (chapter.endPage >= floor && chapter.endPage <= totalPages) {
      targetChapter = { title: chapter.title, kind: "chapter_end", fraction: null };
    }
  } else if (choice.targetPage != null) {
    requestedPage = Math.floor(choice.targetPage);
  } else {
    throw new Error("Pick a goal.");
  }

  const clamped = Math.min(Math.max(requestedPage, floor), totalPages);

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);
  const { error: updateError } = await client
    .from("reading_books")
    .update({
      target_page: clamped,
      target_chapter: targetChapter,
      // The reader's own declaration, not an owner override — keep it unlocked.
      target_locked: false,
      target_due: choice.dueDate ?? readingTargetDueDateKey(today),
    })
    .eq("id", bookId)
    .eq("user_id", userId);
  if (updateError) throw new Error(updateError.message);

  revalidatePath("/reader");
  return { target: clamped };
}

/** One selectable chapter goal: its end page (in 280-word pages) and title. */
export type ChapterGoalOption = {
  index: number;
  title: string;
  endPage: number;
  alreadyRead: boolean;
};

/** Resolve a book's chapter spans (or null when it isn't a synthetic-page book
 *  with a real chapter list). Shared by the picker and the change-goal action. */
async function loadChapterOptions(
  client: SupabaseClient,
  userId: string,
  bookId: string
): Promise<{ options: ChapterGoalOption[]; currentPage: number } | null> {
  const { data: book } = await client
    .from("reading_books")
    .select("current_page, total_pages")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) return null;

  const { data: content } = await client
    .from("reading_book_content")
    .select("status, has_real_pages, word_count, toc")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  const wordCount = (content?.word_count as number | null) ?? null;
  if (!content || content.status !== "ready" || content.has_real_pages || !wordCount) {
    return null;
  }

  const spans = chapterSpans((content.toc as ReadingTocEntry[]) ?? [], wordCount);
  if (spans.length === 0) return null;

  const contentWords = contentWordCount(spans, wordCount);
  const totalPages = (book.total_pages as number | null) ?? wordsToPage(contentWords);
  const currentPage = book.current_page as number;
  const options = spans.map((c, index) => {
    // The last chapter ends exactly at total_pages (kept in step with the
    // "finished" line), earlier ones at their 280-word page.
    const endPage = c.endWord >= contentWords ? totalPages : wordsToPage(c.endWord);
    return { index, title: c.title, endPage, alreadyRead: endPage <= currentPage };
  });
  return { options, currentPage };
}

async function resolveChapterChoice(
  client: SupabaseClient,
  userId: string,
  bookId: string,
  index: number
): Promise<ChapterGoalOption | null> {
  const loaded = await loadChapterOptions(client, userId, bookId);
  return loaded?.options[index] ?? null;
}

/**
 * The chapter goals a reader can aim for on a book — the unread chapters, with
 * their (280-word) end pages. Empty when the book isn't a synthetic-page EPUB
 * with a real chapter list (the change-goal dialog then falls back to a page
 * input). Fetched lazily when the dialog opens, so the home query stays light.
 */
export async function listChapterGoalOptions(
  bookId: string,
  memberEmail?: string | null
): Promise<ChapterGoalOption[]> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  const loaded = await loadChapterOptions(client, userId, bookId);
  if (!loaded) return [];
  return loaded.options.filter((o) => !o.alreadyRead);
}

/**
 * ALL chapters (read and unread) plus the reader's current page, for the "change
 * current location" picker — unlike the goal picker, correcting where a reader is
 * can move backward, so the already-read filter isn't applied. Null when the book
 * isn't a synthetic-page chapter book (the caller falls back to a page input).
 */
export async function listChapterLocationOptions(
  bookId: string,
  memberEmail?: string | null
): Promise<{ options: ChapterGoalOption[]; currentPage: number } | null> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  return loadChapterOptions(client, userId, bookId);
}

/** One chapter row in the parent-admin outline table. */
export type BookOutlineChapter = {
  index: number;
  title: string;
  /** Words in this chapter. */
  words: number;
  /** Cumulative words through the end of this chapter. */
  cumulativeWords: number;
  /** Estimated (280-word) pages in this chapter. */
  pages: number;
  /** The (280-word) page this chapter ends on — cumulative pages to this point. */
  endPage: number;
  /** The reader has already read past the end of this chapter. */
  read: boolean;
  /** The reader is currently within this chapter. */
  current: boolean;
  /** Part of the stretch from where they are up to (and including) the week's goal. */
  goal: boolean;
};

/** A book's chapter outline plus where the reader is and what they're aiming for. */
export type BookOutline = {
  chapters: BookOutlineChapter[];
  currentPage: number;
  /** The story's length in words (excludes trailing back matter). */
  totalWords: number;
  totalPages: number;
  /** This week's goal page, when one is set. */
  targetPage: number | null;
  /** The goal phrased as a chapter, when it snapped to one. */
  targetChapter: ReadingTargetChapter | null;
};

/**
 * The chapter-by-chapter outline of a book: per-chapter and cumulative word/page
 * counts, with the current chapter and the stretch up to the week's goal flagged.
 * Null when the book isn't a synthetic-page EPUB with a real chapter list (the
 * same books that support chapter goals). Fetched lazily when the modal opens.
 */
export async function getBookOutline(
  bookId: string,
  memberEmail?: string | null
): Promise<BookOutline | null> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: book } = await client
    .from("reading_books")
    .select("current_page, total_pages, target_page, target_chapter")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) return null;

  const { data: content } = await client
    .from("reading_book_content")
    .select("status, has_real_pages, word_count, toc")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  const wordCount = (content?.word_count as number | null) ?? null;
  if (!content || content.status !== "ready" || content.has_real_pages || !wordCount) {
    return null;
  }

  const spans = chapterSpans((content.toc as ReadingTocEntry[]) ?? [], wordCount);
  if (spans.length === 0) return null;

  const contentWords = contentWordCount(spans, wordCount);
  const totalPages = (book.total_pages as number | null) ?? wordsToPage(contentWords);
  const currentPage = (book.current_page as number | null) ?? 0;
  const targetPage = (book.target_page as number | null) ?? null;

  // A chapter's end page: the last one lands exactly at total_pages (kept in step
  // with the "finished" line), earlier ones at their 280-word page.
  const endPageOf = (endWord: number): number =>
    endWord >= contentWords ? totalPages : wordsToPage(endWord);

  // The chapter the reader is in now (first whose end is past them), and the one
  // that completes this week's goal (first ending at/after the target).
  const currentIndex = spans.findIndex((c) => endPageOf(c.endWord) > currentPage);
  const goalIndex =
    targetPage != null
      ? spans.findIndex((c) => endPageOf(c.endWord) >= targetPage)
      : -1;

  let prevEndPage = 0;
  const chapters: BookOutlineChapter[] = spans.map((c, index) => {
    const endPage = endPageOf(c.endWord);
    const pages = Math.max(0, endPage - prevEndPage);
    prevEndPage = endPage;
    return {
      index,
      title: c.title,
      words: c.endWord - c.startWord,
      cumulativeWords: c.endWord,
      pages,
      endPage,
      read: endPage <= currentPage,
      current: index === currentIndex,
      goal: goalIndex >= 0 && index > currentIndex && index <= goalIndex,
    };
  });

  return {
    chapters,
    currentPage,
    totalWords: contentWords,
    totalPages,
    targetPage,
    targetChapter: (book.target_chapter as ReadingTargetChapter | null) ?? null,
  };
}

const RATINGS: ReadingRating[] = ["loved", "liked", "neutral", "disliked"];

/**
 * Set (or clear) a member's emoji rating on a book they've read. This is the
 * taste signal the Discover recommender leans on. Passing null clears it.
 */
export async function rateBook(
  bookId: string,
  rating: ReadingRating | null,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  if (rating !== null && !RATINGS.includes(rating)) {
    throw new Error("Unknown rating.");
  }

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  const { error } = await client
    .from("reading_books")
    .update({ rating, rated_at: rating ? today : null })
    .eq("id", bookId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/reader");
}

// ============================================================
// Shelf order (fractional index; see src/lib/sort-order.ts)
// ============================================================

/**
 * Drop a book at a new position on the shelf. One row, one number — the caller
 * has already worked out the midpoint between its new neighbours, so no sibling
 * moves and the optimistic list on screen stays in step.
 *
 * Deliberately no revalidatePath: the list is already showing the new order, and
 * re-rendering the page under a drag that just landed is exactly the flicker
 * we've fixed elsewhere.
 */
export async function setBookSortOrder(
  bookId: string,
  sortOrder: number,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  const { error } = await client
    .from("reading_books")
    .update({ sort_order: sortOrder })
    .eq("id", bookId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/** Reset a shelf's positions to 1..n when midpoints run out of float precision. */
export async function renormalizeBookOrder(
  orderedIds: string[],
  memberEmail?: string | null
): Promise<void> {
  if (orderedIds.length === 0) return;
  const { client, userId } = await resolveReadingScope(memberEmail);
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      client
        .from("reading_books")
        .update({ sort_order: index + 1 })
        .eq("id", id)
        .eq("user_id", userId)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
}

/** Stop tracking a book (and its check-ins, via ON DELETE CASCADE). */
export async function removeBook(
  bookId: string,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);
  const { error } = await client
    .from("reading_books")
    .delete()
    .eq("id", bookId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/reader");
}

// ============================================================
// Uploaded book files + the reading experience
// ============================================================

const UPLOAD_EXT: Record<"pdf" | "epub", string> = { pdf: "pdf", epub: "epub" };

/**
 * Sign an upload URL for a book's source file. Mirrors createPhotoUploadUrls:
 * owner-on-behalf uploads land in the member's folder, which the user client's
 * storage policy ({auth.uid()}/…) would reject — so member mode signs via the
 * service role. The path is derived from the trusted userId, never client input.
 */
export async function createBookUploadUrl(
  bookId: string,
  format: "pdf" | "epub",
  memberEmail?: string | null
): Promise<{ path: string; token: string }> {
  const { client, userId, isMemberMode } = await resolveReadingScope(memberEmail);

  // Confirm the book belongs to the scoped user before handing out a URL.
  const { data: book, error } = await client
    .from("reading_books")
    .select("id")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!book) throw new Error("Book not found.");

  const path = `${userId}/${bookId}/source.${UPLOAD_EXT[format]}`;
  const storage = (isMemberMode ? createAdminClient() : await createClient())
    .storage;
  const signed = await storage
    .from(READING_BOOKS_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (signed.error || !signed.data) {
    throw new Error(signed.error?.message ?? "Failed to create upload URL.");
  }
  return { path: signed.data.path, token: signed.data.token };
}

/**
 * Record that a source file was uploaded and mark it for conversion. Resets any
 * prior conversion state (re-upload replaces content). The caller then triggers
 * the conversion route, which flips status to ready/failed.
 */
export async function attachBookFile(
  bookId: string,
  sourcePath: string,
  format: "pdf" | "epub",
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: book, error: bookError } = await client
    .from("reading_books")
    .select("id")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (bookError) throw new Error(bookError.message);
  if (!book) throw new Error("Book not found.");

  const { error } = await client.from("reading_book_content").upsert(
    {
      book_id: bookId,
      user_id: userId,
      source_format: format,
      source_path: sourcePath,
      content_path: null,
      status: "processing",
      error_message: null,
      page_count: null,
      has_real_pages: false,
      char_count: null,
    },
    { onConflict: "book_id" }
  );
  if (error) throw new Error(error.message);

  // Stale page map from a previous conversion (re-upload) must not linger.
  await client.from("reading_book_pages").delete().eq("book_id", bookId);

  revalidatePath("/reader");
}

export type ReadingBookReaderData = {
  title: string;
  author: string | null;
  /** True for saved web articles (keep images/links; no page anchors). */
  isArticle: boolean;
  /** Article only: standfirst/dek shown under the headline. */
  dek: string | null;
  /** Article only: hero image (og:image), shown atop the article. */
  heroImageUrl: string | null;
  /** Short-lived signed URL the client fetches the reflowed HTML from. */
  contentUrl: string;
  hasRealPages: boolean;
  pageCount: number | null;
  /** Total body words, for the reader's "time left" estimates. Null on books
   * converted before word counts were recorded. */
  wordCount: number | null;
  toc: ReadingTocEntry[];
  resume: ReadingPosition;
};

/**
 * Where a book was left off, and when.
 *
 * The timestamp is what lets the reader tell "this is my own place" from "some
 * other device has been reading since" — see getReadingPosition.
 */
export type ReadingPosition = {
  /**
   * Where to open, as an offset into the conversion char space. Resolved here
   * rather than in the reader so the client has exactly one thing to restore,
   * whichever era the stored position is from.
   */
  charOffset: number;
  /** When this position was recorded, by whichever device recorded it. */
  savedAt: string | null;
};

/**
 * The books Reader could drop straight into when it opens, most recently read
 * first, so the app behaves like a Kindle rather than a bookshelf. Only books
 * whose file finished converting can be opened, and archived ones are done with,
 * so both are excluded. Empty means "nothing to resume" — show the library.
 *
 * The whole list rather than just the winner, because the device's own last
 * place gets to hold unless the reading overtakes it — see resumeTarget.
 */
export async function getResumeCandidates(): Promise<ResumeCandidate[]> {
  const { client, userId } = await resolveReadingScope(null);

  const { data: states } = await client
    .from("reading_book_state")
    .select("book_id, last_read_at")
    .eq("user_id", userId)
    .not("last_read_at", "is", null)
    .order("last_read_at", { ascending: false })
    .limit(20);
  if (!states || states.length === 0) return [];

  const bookIds = states.map((s) => s.book_id as string);
  const [{ data: books }, { data: contents }] = await Promise.all([
    client
      .from("reading_books")
      .select("id, status")
      .eq("user_id", userId)
      .in("id", bookIds),
    client
      .from("reading_book_content")
      .select("book_id, status")
      .eq("user_id", userId)
      .in("book_id", bookIds),
  ]);

  const openable = new Set(
    (contents ?? [])
      .filter((c) => c.status === "ready")
      .map((c) => c.book_id as string)
  );
  const readable = new Set(
    (books ?? [])
      .filter((b) => b.status !== "archive" && openable.has(b.id as string))
      .map((b) => b.id as string)
  );

  // `states` is already newest-first, and filtering keeps that order.
  return states
    .filter((s) => readable.has(s.book_id as string))
    .map((s) => ({
      bookId: s.book_id as string,
      lastReadAt: s.last_read_at as string,
    }));
}

/** Everything the reader needs: a signed content URL, pagination, resume point. */
export async function getBookReaderData(
  bookId: string,
  memberEmail?: string | null
): Promise<ReadingBookReaderData | null> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: book, error } = await client
    .from("reading_books")
    .select("title, author, type, cover_image_url, excerpt")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!book) return null;

  const isArticle = book.type === "article";

  const { data: content } = await client
    .from("reading_book_content")
    .select(
      "content_path, status, has_real_pages, page_count, word_count, char_count, toc, updated_at"
    )
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!content || content.status !== "ready" || !content.content_path) {
    return null;
  }

  // A stable same-origin URL rather than a per-view signed one, so the browser
  // cache, the service worker and the offline store can all key on it. See
  // reader/api/content/[bookId]/route.ts for why that matters.
  const contentUrl = `/reader/api/content/${bookId}?v=${Date.parse(content.updated_at)}`;

  const counts = await healWordCounts(client, {
    bookId,
    userId,
    isArticle,
    contentPath: content.content_path as string,
    wordCount: (content.word_count as number) ?? null,
    charCount: (content.char_count as number) ?? null,
    toc: (content.toc as ReadingTocEntry[]) ?? [],
  });

  await healPageMap(client, {
    bookId,
    userId,
    isArticle,
    contentPath: content.content_path as string,
    hasRealPages: content.has_real_pages as boolean,
    charCount: (content.char_count as number) ?? null,
    wordCount: counts.wordCount,
    toc: counts.toc,
  });

  const { data: state } = await client
    .from("reading_book_state")
    .select("last_char_offset, last_anchor_id, last_scroll_ratio, last_read_at")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();

  return {
    title: book.title as string,
    author: (book.author as string) ?? null,
    isArticle,
    dek: isArticle ? ((book.excerpt as string) ?? null) : null,
    heroImageUrl: isArticle ? ((book.cover_image_url as string) ?? null) : null,
    contentUrl,
    hasRealPages: content.has_real_pages as boolean,
    pageCount: (content.page_count as number) ?? null,
    wordCount: counts.wordCount,
    toc: counts.toc,
    resume: {
      charOffset: await resolveResumeCharOffset(client, {
        bookId,
        userId,
        charOffset: (state?.last_char_offset as number) ?? null,
        anchorId: (state?.last_anchor_id as string) ?? null,
        scrollRatio: (state?.last_scroll_ratio as number) ?? null,
        charCount: (content.char_count as number) ?? null,
      }),
      savedAt: (state?.last_read_at as string) ?? null,
    },
  };
}

/**
 * Just the position, asked again while the book is already open.
 *
 * The reader is rendered once and never refetched, and its page is served from
 * the service worker's cache on a cold launch — so the place it is showing can
 * be arbitrarily out of date. That is fine for a device nobody else is reading
 * on and wrong the moment there are two: a Boox left open at chapter nine, woken
 * up after an evening's reading on a phone, has no idea it is behind, and the
 * first page turn would write its stale place over the good one.
 *
 * So the reader asks again on open and whenever it comes back to the foreground,
 * and compares what comes back with what it last wrote itself. Deliberately just
 * a read: what to do about a difference is the reader's decision, and the answer
 * is to offer rather than to move the page under someone mid-sentence.
 */
export async function getReadingPosition(
  bookId: string,
  memberEmail?: string | null
): Promise<ReadingPosition | null> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: state } = await client
    .from("reading_book_state")
    .select("last_char_offset, last_anchor_id, last_scroll_ratio, last_read_at")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!state) return null;

  const charOffset = (state.last_char_offset as number) ?? null;
  const anchorId = (state.last_anchor_id as string) ?? null;
  const scrollRatio = (state.last_scroll_ratio as number) ?? null;

  // The ratio fallback is the only branch that needs the book's length, and it
  // only fires for positions saved before the reader stored offsets at all. Not
  // worth a second query on every foreground for the other 99% of cases.
  const needsCharCount = !(charOffset != null && charOffset > 0) && !anchorId;
  let charCount: number | null = null;
  if (needsCharCount) {
    const { data: content } = await client
      .from("reading_book_content")
      .select("char_count")
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .maybeSingle();
    charCount = (content?.char_count as number) ?? null;
  }

  return {
    charOffset: await resolveResumeCharOffset(client, {
      bookId,
      userId,
      charOffset,
      anchorId,
      scrollRatio,
      charCount,
    }),
    savedAt: (state.last_read_at as string) ?? null,
  };
}

/**
 * Fill in a book's word counts the first time it's opened without them.
 *
 * Books converted before migration 00163 have a null word_count and a TOC with
 * no startWord, so the reader shows percent-complete but no time-left. Nothing
 * else ever writes those columns — only conversion does — so without this they
 * stay blank forever, and the only other way to populate them is to reconvert,
 * which re-parses the source with today's converter and moves the character
 * space out from under every stored annotation and chat anchor.
 *
 * Recomputing from the stored HTML instead leaves the character space alone, so
 * this is a pure repair: same text, same arithmetic, nothing else touched. It
 * costs one storage read on the first open of an affected book and never runs
 * again for that book.
 *
 * Deliberately best-effort. A book that fails to heal simply renders the way it
 * does today — no estimate — which is why every exit here returns the values it
 * was given rather than throwing.
 */
async function healWordCounts(
  client: SupabaseClient,
  input: {
    bookId: string;
    userId: string;
    isArticle: boolean;
    contentPath: string;
    wordCount: number | null;
    charCount: number | null;
    toc: ReadingTocEntry[];
  }
): Promise<{ wordCount: number | null; toc: ReadingTocEntry[] }> {
  const asIs = { wordCount: input.wordCount, toc: input.toc };

  // The overwhelmingly common path: already counted, nothing to do.
  if (input.wordCount != null) return asIs;
  // An article's HTML isn't converter output and its anchors live in a DOM
  // text-stream space, not the conversion char space this reconstructs.
  if (input.isArticle) return asIs;

  try {
    const download = await client.storage
      .from(READING_BOOKS_BUCKET)
      .download(input.contentPath);
    if (download.error || !download.data) return asIs;

    const counts = computeBookWordCounts(await download.data.text(), input.toc);
    if (!counts || counts.wordCount <= 0) return asIs;

    // The stored char_count is what every anchor and page row was recorded
    // against. If this HTML implies a different one, it isn't the file those
    // offsets describe and nothing derived from it can be trusted.
    if (input.charCount != null && counts.charCount !== input.charCount) {
      console.warn(
        `[reading/heal] book=${input.bookId} char_count mismatch ` +
          `(stored ${input.charCount}, recomputed ${counts.charCount}) — skipped`
      );
      return asIs;
    }

    // Only these two columns. The character space is unchanged, so the page map,
    // the reading position and every anchor stay valid as they are.
    const { error } = await client
      .from("reading_book_content")
      .update({ word_count: counts.wordCount, toc: counts.toc })
      .eq("book_id", input.bookId)
      .eq("user_id", input.userId);
    if (error) return asIs;

    console.log(
      `[reading/heal] book=${input.bookId} words=${counts.wordCount} ` +
        `chapters=${counts.located}/${counts.total}`
    );
    return { wordCount: counts.wordCount, toc: counts.toc };
  } catch {
    return asIs;
  }
}

/**
 * Rebuild the 280-word page map for a chaptered book that has none.
 *
 * Books converted before synthetic pages existed have no reading_book_pages rows
 * at all, and nothing but conversion ever writes them. The cost is quiet but real:
 * getTextForRange resolves every page query to nothing, so a stretch quiz silently
 * widens to the whole book and the reader chat gets no "[p.N]" markers — which
 * means it cannot cite or link a single spot in the book it just read.
 *
 * Rebuilt from the stored HTML rather than by reconverting, for the same reason as
 * healWordCounts: the character space stays exactly as it is, so every annotation,
 * chat anchor and saved position keeps pointing where it did. layoutSyntheticPages
 * is the same function conversion uses, so the rows are the ones that book would
 * have been given today.
 *
 * Best-effort throughout: a book that can't be healed keeps behaving the way it
 * does now, so every failure path here just returns.
 */
async function healPageMap(
  client: SupabaseClient,
  input: {
    bookId: string;
    userId: string;
    isArticle: boolean;
    contentPath: string;
    hasRealPages: boolean;
    charCount: number | null;
    wordCount: number | null;
    toc: ReadingTocEntry[];
  }
): Promise<void> {
  // Real pages come from the source file and can't be synthesized. Articles have
  // no page map by design (see extract-text.ts). No word count means healWordCounts
  // couldn't read this HTML either, so there is nothing to lay a grid over.
  if (input.isArticle || input.hasRealPages) return;
  if (input.wordCount == null || input.wordCount <= 0 || input.charCount == null) return;
  // Conversion only lays synthetic pages over a book with real chapters; an
  // unchaptered EPUB is deliberately left without a page map.
  if (chapterSpans(input.toc, input.wordCount).length === 0) return;

  try {
    // The common path by far: the map is already there.
    const { count, error: countError } = await client
      .from("reading_book_pages")
      .select("page_number", { count: "exact", head: true })
      .eq("book_id", input.bookId)
      .eq("user_id", input.userId);
    if (countError || count == null || count > 0) return;

    const download = await client.storage
      .from(READING_BOOKS_BUCKET)
      .download(input.contentPath);
    if (download.error || !download.data) return;

    const marks = blockMarksFromHtml(await download.data.text());
    if (marks.length === 0) return;

    // Same guard as healWordCounts: if this HTML doesn't imply the stored
    // char_count, it isn't the file those offsets were recorded against and a
    // page map built from it would point at the wrong text.
    const implied = marks[marks.length - 1].char;
    if (implied !== input.charCount) {
      console.warn(
        `[reading/heal] book=${input.bookId} char_count mismatch ` +
          `(stored ${input.charCount}, recomputed ${implied}) — page map skipped`
      );
      return;
    }

    const pages = layoutSyntheticPages(marks, input.charCount, input.wordCount);
    if (pages.length === 0) return;

    const rows = pages.map((p) => ({
      book_id: input.bookId,
      user_id: input.userId,
      page_number: p.pageNumber,
      anchor_id: p.anchorId,
      char_start: p.charStart,
      char_end: p.charEnd,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await client
        .from("reading_book_pages")
        .insert(rows.slice(i, i + 500));
      // A partial map is worse than none — it would scope a quiz to a fraction of
      // the book — so undo the whole thing and leave the book as it was.
      if (error) {
        await client
          .from("reading_book_pages")
          .delete()
          .eq("book_id", input.bookId)
          .eq("user_id", input.userId);
        return;
      }
    }

    console.log(`[reading/heal] book=${input.bookId} pages=${pages.length}`);
  } catch {
    return;
  }
}

/**
 * Where to reopen a book, in characters.
 *
 * Positions saved before the reader was paginated are a page anchor plus a
 * scroll ratio, neither of which means anything once the text can be laid out
 * more than one way. Both are translatable, though: an anchor names a page whose
 * character range we recorded at conversion, and a ratio is a rough share of the
 * whole. So a book in progress reopens where it left off — exactly if it was
 * anchored, within a page or so if all we have is the ratio.
 */
async function resolveResumeCharOffset(
  client: Awaited<ReturnType<typeof resolveReadingScope>>["client"],
  {
    bookId,
    userId,
    charOffset,
    anchorId,
    scrollRatio,
    charCount,
  }: {
    bookId: string;
    userId: string;
    charOffset: number | null;
    anchorId: string | null;
    scrollRatio: number | null;
    charCount: number | null;
  }
): Promise<number> {
  if (charOffset != null && charOffset > 0) return charOffset;

  if (anchorId) {
    const { data: page } = await client
      .from("reading_book_pages")
      .select("char_start")
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .eq("anchor_id", anchorId)
      .maybeSingle();
    const start = (page?.char_start as number) ?? null;
    if (start != null) return start;
  }

  if (scrollRatio != null && scrollRatio > 0 && charCount != null && charCount > 0) {
    return Math.round(scrollRatio * charCount);
  }
  return 0;
}

// ============================================================
// Personal API tokens for the Chrome article-capture extension
// ============================================================

/**
 * Mint a personal API token for /api/reading/ingest (the Chrome extension). The
 * raw token is returned exactly once (shown in settings, never again); only its
 * SHA-256 hex digest is stored. Always the signed-in member's own token.
 */
export async function createReadingApiToken(
  name: string
): Promise<{ id: string; token: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase();
  if (!email) throw new Error("Not authenticated");

  const trimmed = name.trim();
  if (!trimmed) throw new Error("Token name is required");

  const token = `reading_${randomBytes(32).toString("base64url")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { data, error } = await supabase
    .from("reading_api_tokens")
    .insert({ member_email: email, name: trimmed, token_hash: tokenHash })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create token");

  revalidatePath("/reader/settings");
  return { id: data.id as string, token };
}

/** Revoke (delete) one of the signed-in member's reading API tokens. */
export async function revokeReadingApiToken(tokenId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("reading_api_tokens")
    .delete()
    .eq("id", tokenId);
  if (error) throw error;
  revalidatePath("/reader/settings");
}

/**
 * Persist where the reader left off. Deliberately does NOT touch current_page or
 * check-ins — manual progress stays manual; this is just resume state.
 */
export async function saveReadingPosition(
  bookId: string,
  position: {
    /** Offset into the conversion char space — the durable half of this. */
    charOffset: number;
    /**
     * charOffset as a share of the whole book. Still written because the shelf
     * reads it for each book's percent-complete label, and because it's the only
     * thing an older client would understand.
     */
    scrollRatio: number | null;
    anchorId: string | null;
    pageNumber: number | null;
    /**
     * When this position was actually recorded, for positions that were held on
     * the device while offline. Without it, an iPad reconnecting on Wednesday
     * would overwrite Tuesday's reading with Monday's page.
     */
    savedAt?: string;
  },
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  // Only replayed positions carry a timestamp, and only they can be stale — a
  // live save is by definition the newest thing there is.
  if (position.savedAt) {
    const { data: existing } = await client
      .from("reading_book_state")
      .select("last_read_at")
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .maybeSingle();
    const serverTime = existing?.last_read_at as string | undefined;
    if (serverTime && Date.parse(serverTime) > Date.parse(position.savedAt)) return;
  }

  const { error } = await client.from("reading_book_state").upsert(
    {
      book_id: bookId,
      user_id: userId,
      last_char_offset: position.charOffset,
      last_anchor_id: position.anchorId,
      last_scroll_ratio: position.scrollRatio,
      last_page_number: position.pageNumber,
      last_read_at: position.savedAt ?? new Date().toISOString(),
    },
    { onConflict: "book_id" }
  );
  if (error) throw new Error(error.message);
}
