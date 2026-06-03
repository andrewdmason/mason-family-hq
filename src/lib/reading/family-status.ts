import { createAdminClient } from "@/lib/supabase/admin";
import { getWeekStart, localDate } from "@/lib/date-utils";

/**
 * Public, unauthenticated snapshot of every kid's reading: their current book(s),
 * weekly page goal, progress this week, and a link to the check-in quiz waiting
 * for them. Served by GET /family-status as JSON for the family assistant to read.
 *
 * Reads via the service-role admin client (no session) and is deliberately scoped
 * to kids only. The check-in-quiz and weekly-progress logic mirrors
 * getActiveQuizzesByBook / getReadingHome so the numbers match the in-app reader.
 */

export type FamilyStatusBook = {
  title: string;
  author: string | null;
  currentPage: number;
  /** This week's page milestone for the book, if it has one. */
  targetPage: number | null;
  totalPages: number | null;
  pagesReadThisWeek: number;
  /**
   * The next check-in quiz to take — the most recent published quiz for this book
   * the kid hasn't passed yet. Null when there's nothing waiting. Opening it
   * requires the kid to be signed in (the reader is behind auth).
   */
  checkInQuizUrl: string | null;
};

export type FamilyStatusKid = {
  name: string | null;
  email: string;
  weeklyPageGoal: number;
  pagesReadThisWeek: number;
  /** The kid's reading home — handy when no quiz is waiting yet. */
  readerUrl: string;
  currentBooks: FamilyStatusBook[];
};

export type FamilyStatus = {
  generatedAt: string;
  weekStart: string;
  timezone: string;
  kids: FamilyStatusKid[];
};

/** True once any of a quiz's attempts answered every question correctly. */
function isPassed(
  subs: { score_correct: number | null; score_total: number | null }[]
): boolean {
  return subs.some(
    (s) =>
      (s.score_total ?? 0) > 0 && (s.score_correct ?? 0) === (s.score_total ?? 0)
  );
}

export async function getFamilyReadingStatus(
  origin: string
): Promise<FamilyStatus> {
  const admin = createAdminClient();

  // Weekly progress is keyed to a Mon–Sun week in the family's timezone. There's
  // no session here, so honor an optional FAMILY_TIMEZONE (defaults to UTC).
  const timezone = process.env.FAMILY_TIMEZONE || "UTC";
  const now = new Date();
  const weekStart = getWeekStart(localDate(now, timezone));

  const { data: kidRows, error: kidsError } = await admin
    .from("family_members")
    .select("email, name, user_id")
    .eq("role", "kid")
    .not("user_id", "is", null)
    .order("created_at", { ascending: true });
  if (kidsError) throw new Error(kidsError.message);

  const kids = await Promise.all(
    (kidRows ?? []).map((kid) =>
      buildKid(
        admin,
        origin,
        weekStart,
        kid.email as string,
        kid.name as string | null,
        kid.user_id as string
      )
    )
  );

  return { generatedAt: now.toISOString(), weekStart, timezone, kids };
}

async function buildKid(
  admin: ReturnType<typeof createAdminClient>,
  origin: string,
  weekStart: string,
  email: string,
  name: string | null,
  userId: string
): Promise<FamilyStatusKid> {
  const [{ data: goalRow }, { data: bookRows }] = await Promise.all([
    admin
      .from("reading_settings")
      .select("weekly_page_goal")
      .eq("member_email", email)
      .maybeSingle(),
    admin
      .from("reading_books")
      .select("id, title, author, current_page, target_page, total_pages")
      .eq("user_id", userId)
      .eq("status", "in_progress")
      .order("created_at", { ascending: true }),
  ]);

  const books = bookRows ?? [];
  const bookIds = books.map((b) => b.id as string);

  const [quizByBook, readThisWeekByBook] = await Promise.all([
    activeQuizByBook(admin, userId, bookIds),
    pagesReadThisWeekByBook(admin, userId, bookIds, weekStart, books),
  ]);

  const currentBooks: FamilyStatusBook[] = books.map((b) => {
    const quizId = quizByBook.get(b.id as string) ?? null;
    return {
      title: b.title as string,
      author: (b.author as string) ?? null,
      currentPage: (b.current_page as number) ?? 0,
      targetPage: (b.target_page as number | null) ?? null,
      totalPages: (b.total_pages as number | null) ?? null,
      pagesReadThisWeek: readThisWeekByBook.get(b.id as string) ?? 0,
      checkInQuizUrl: quizId ? `${origin}/reader/quizzes/${quizId}` : null,
    };
  });

  const pagesReadThisWeek = currentBooks.reduce(
    (sum, b) => sum + b.pagesReadThisWeek,
    0
  );

  return {
    name,
    email,
    weeklyPageGoal: (goalRow?.weekly_page_goal as number) ?? 0,
    pagesReadThisWeek,
    readerUrl: `${origin}/reader`,
    currentBooks,
  };
}

/**
 * The next check-in quiz per book: the most recent published quiz the kid hasn't
 * passed yet. Mirrors getActiveQuizzesByBook, against the admin client.
 */
async function activeQuizByBook(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  bookIds: string[]
): Promise<Map<string, string>> {
  const byBook = new Map<string, string>();
  if (bookIds.length === 0) return byBook;

  const { data: quizzes } = await admin
    .from("reading_quizzes")
    .select("id, book_id")
    .eq("user_id", userId)
    .eq("status", "published")
    .in("book_id", bookIds)
    .order("created_at", { ascending: false });
  if (!quizzes || quizzes.length === 0) return byBook;

  const quizIds = quizzes.map((q) => q.id as string);
  const { data: submissions } = await admin
    .from("reading_quiz_submissions")
    .select("quiz_id, score_correct, score_total")
    .eq("user_id", userId)
    .in("quiz_id", quizIds);

  const subsByQuiz = new Map<
    string,
    { score_correct: number | null; score_total: number | null }[]
  >();
  for (const s of submissions ?? []) {
    const id = s.quiz_id as string;
    const list = subsByQuiz.get(id) ?? [];
    list.push(s);
    subsByQuiz.set(id, list);
  }

  // Quizzes are newest-first; take the first unpassed one per book.
  for (const q of quizzes) {
    const bookId = q.book_id as string;
    if (byBook.has(bookId)) continue;
    if (isPassed(subsByQuiz.get(q.id as string) ?? [])) continue;
    byBook.set(bookId, q.id as string);
  }
  return byBook;
}

/**
 * Pages read this week per book. Mirrors getReadingHome: a book's baseline is its
 * latest check-in before the week, or — for one only started this week — its
 * earliest check-in, falling back to the current page (so progress reads as 0).
 */
async function pagesReadThisWeekByBook(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  bookIds: string[],
  weekStart: string,
  books: { id: unknown; current_page: unknown }[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (bookIds.length === 0) return result;

  const { data: checkins } = await admin
    .from("reading_checkins")
    .select("book_id, page, checked_on")
    .eq("user_id", userId)
    .in("book_id", bookIds);

  const baselineBeforeWeek = new Map<string, { page: number; on: string }>();
  const earliestCheckin = new Map<string, { page: number; on: string }>();
  for (const c of checkins ?? []) {
    const bookId = c.book_id as string;
    const on = c.checked_on as string;
    const page = c.page as number;
    if (on < weekStart) {
      const prev = baselineBeforeWeek.get(bookId);
      if (!prev || on > prev.on) baselineBeforeWeek.set(bookId, { page, on });
    }
    const earliest = earliestCheckin.get(bookId);
    if (!earliest || on < earliest.on) earliestCheckin.set(bookId, { page, on });
  }

  for (const b of books) {
    const id = b.id as string;
    const current = (b.current_page as number) ?? 0;
    const baseline =
      baselineBeforeWeek.get(id)?.page ??
      earliestCheckin.get(id)?.page ??
      current;
    result.set(id, Math.max(0, current - baseline));
  }
  return result;
}
