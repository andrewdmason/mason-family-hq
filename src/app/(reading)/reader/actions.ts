"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserTimezone, getWeekStart, localDate } from "@/lib/date-utils";
import { lookupBookByTitle, type BookLookupResult } from "@/lib/reading/book-lookup";
import { resolveReadingScope } from "@/lib/reading/scope";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";
import type {
  ReadingBook,
  ReadingBookContentSummary,
  ReadingBookStatus,
  ReadingBookWithProgress,
  ReadingHome,
  ReadingRating,
  ReadingTocEntry,
} from "@/lib/types";

const BOOK_COLUMNS =
  "id, user_id, title, author, total_pages, current_page, status, cover_image_url, started_at, finished_at, rating, recommended_by_email, recommended_by_label, recommendation_note, created_at, updated_at";

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
 * — journal_members RLS otherwise hides other members' rows.
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
    .from("journal_members")
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
    .from("journal_members")
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

  const { error } = await admin.from("reading_books").insert({
    user_id: recipient.user_id,
    title,
    author: input.author?.trim() || null,
    total_pages: totalPages,
    current_page: 0,
    status: "queued",
    cover_image_url: input.coverImageUrl ?? null,
    recommended_by_email: fromEmail,
    recommended_by_label: label,
    recommendation_note: input.note?.trim() || null,
  });
  if (error) throw new Error(error.message);
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
  if (bookIds.length > 0) {
    const [{ data: contentRows }, { data: stateRows }] = await Promise.all([
      client
        .from("reading_book_content")
        .select("book_id, status, page_count, has_real_pages, error_message")
        .eq("user_id", userId)
        .in("book_id", bookIds),
      client
        .from("reading_book_state")
        .select("book_id, last_anchor_id")
        .eq("user_id", userId)
        .in("book_id", bookIds),
    ]);
    for (const c of contentRows ?? []) {
      contentByBook.set(c.book_id as string, {
        status: c.status as ReadingBookContentSummary["status"],
        page_count: (c.page_count as number) ?? null,
        has_real_pages: (c.has_real_pages as boolean) ?? false,
        error_message: (c.error_message as string) ?? null,
      });
    }
    for (const s of stateRows ?? []) {
      if (s.last_anchor_id) resumeBooks.add(s.book_id as string);
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
    return {
      ...book,
      pagesReadThisWeek: Math.max(0, book.current_page - baseline),
      content: contentByBook.get(book.id) ?? null,
      hasResumePoint: resumeBooks.has(book.id),
    };
  });

  const totalReadThisWeek = withProgress
    .filter((b) => b.status === "in_progress")
    .reduce((sum, b) => sum + b.pagesReadThisWeek, 0);

  return {
    books: withProgress,
    weeklyPageGoal: goalRow?.weekly_page_goal ?? 0,
    totalReadThisWeek,
    checkedInThisWeek,
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
  rating?: ReadingRating | null;
  memberEmail?: string | null;
}): Promise<void> {
  const { client, userId } = await resolveReadingScope(input.memberEmail);

  const title = input.title.trim();
  if (!title) throw new Error("Give the book a title.");
  const author = input.author?.trim() || null;
  const totalPages =
    input.totalPages != null && input.totalPages > 0 ? input.totalPages : null;
  const status: ReadingBookStatus = input.status ?? "in_progress";

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  const archived = status === "archive";
  // A rating only makes sense on a book they're done with.
  const rating = archived ? input.rating ?? null : null;
  // A "didn't finish" book wasn't read to the end, so don't slam it to the back.
  const finished = archived && rating !== "didnt_finish";
  const { data: book, error } = await client
    .from("reading_books")
    .insert({
      user_id: userId,
      title,
      author,
      total_pages: totalPages,
      current_page: finished && totalPages ? totalPages : 0,
      status,
      cover_image_url: input.coverImageUrl ?? null,
      started_at: status === "in_progress" ? today : null,
      finished_at: finished ? today : null,
      rating,
      rated_at: rating ? today : null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

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
    rating?: ReadingRating | null;
    memberEmail?: string | null;
  }
): Promise<void> {
  const { client, userId } = await resolveReadingScope(input.memberEmail);

  const { data: existing, error: fetchError } = await client
    .from("reading_books")
    .select("status, total_pages, current_page, started_at")
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

/** Record what page the member is on now. Marks the book completed at the end. */
export async function checkIn(
  bookId: string,
  page: number,
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const nextPage = Math.max(0, Math.floor(page));

  const { data: book, error: bookError } = await client
    .from("reading_books")
    .select("id, total_pages")
    .eq("id", bookId)
    .eq("user_id", userId)
    .single();
  if (bookError) throw new Error(bookError.message);

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  const { error: checkinError } = await client.from("reading_checkins").insert({
    user_id: userId,
    book_id: bookId,
    checked_on: today,
    page: nextPage,
  });
  if (checkinError) throw new Error(checkinError.message);

  const finished = book.total_pages != null && nextPage >= book.total_pages;
  const { error: updateError } = await client
    .from("reading_books")
    .update({
      current_page: nextPage,
      status: finished ? "archive" : "in_progress",
      finished_at: finished ? today : null,
    })
    .eq("id", bookId)
    .eq("user_id", userId);
  if (updateError) throw new Error(updateError.message);

  revalidatePath("/reader");
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
  /** Short-lived signed URL the client fetches the reflowed HTML from. */
  contentUrl: string;
  hasRealPages: boolean;
  pageCount: number | null;
  toc: ReadingTocEntry[];
  resume: {
    anchorId: string | null;
    scrollRatio: number | null;
  };
};

/** Everything the reader needs: a signed content URL, pagination, resume point. */
export async function getBookReaderData(
  bookId: string,
  memberEmail?: string | null
): Promise<ReadingBookReaderData | null> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { data: book, error } = await client
    .from("reading_books")
    .select("title, author")
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!book) return null;

  const { data: content } = await client
    .from("reading_book_content")
    .select("content_path, status, has_real_pages, page_count, toc")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!content || content.status !== "ready" || !content.content_path) {
    return null;
  }

  const signed = await client.storage
    .from(READING_BOOKS_BUCKET)
    .createSignedUrl(content.content_path, 60 * 60);
  if (signed.error || !signed.data) {
    throw new Error(signed.error?.message ?? "Couldn't open this book.");
  }

  const { data: state } = await client
    .from("reading_book_state")
    .select("last_anchor_id, last_scroll_ratio")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .maybeSingle();

  return {
    title: book.title as string,
    author: (book.author as string) ?? null,
    contentUrl: signed.data.signedUrl,
    hasRealPages: content.has_real_pages as boolean,
    pageCount: (content.page_count as number) ?? null,
    toc: (content.toc as ReadingTocEntry[]) ?? [],
    resume: {
      anchorId: (state?.last_anchor_id as string) ?? null,
      scrollRatio: (state?.last_scroll_ratio as number) ?? null,
    },
  };
}

/**
 * Persist where the reader left off. Deliberately does NOT touch current_page or
 * check-ins — manual progress stays manual; this is just resume state.
 */
export async function saveReadingPosition(
  bookId: string,
  position: {
    anchorId: string | null;
    scrollRatio: number | null;
    pageNumber: number | null;
  },
  memberEmail?: string | null
): Promise<void> {
  const { client, userId } = await resolveReadingScope(memberEmail);

  const { error } = await client.from("reading_book_state").upsert(
    {
      book_id: bookId,
      user_id: userId,
      last_anchor_id: position.anchorId,
      last_scroll_ratio: position.scrollRatio,
      last_page_number: position.pageNumber,
      last_read_at: new Date().toISOString(),
    },
    { onConflict: "book_id" }
  );
  if (error) throw new Error(error.message);
}
