import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCalendarEvents } from "@/lib/calendar/queries";
import { memberColor } from "@/lib/calendar/calendar-utils";
import { getWeekStart, localDate } from "@/lib/date-utils";
import { activeQuizState, isQuizDueWindow } from "@/lib/reading/quiz-due";
import { readingTargetDueLabelFromDateKey } from "@/lib/reading/target-due";
import type { CalendarEvent } from "@/lib/calendar/types";
import type {
  HomePersonReadingStatus,
  HomePersonStatus,
  HomeReadingBookStatus,
} from "@/lib/home/types";
import type { MemberRole } from "@/lib/types";

const DAY_MS = 86_400_000;

type MemberRow = {
  email: string;
  name: string | null;
  role: MemberRole;
  user_id: string | null;
  color: string | null;
};

type BookRow = {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  current_page: number;
  target_page: number | null;
  total_pages: number | null;
};

type CheckinRow = {
  book_id: string;
  checked_on: string;
  page: number;
};

type QuizRow = {
  id: string;
  book_id: string;
};

type SubmissionRow = {
  quiz_id: string;
  score_correct: number | null;
  score_total: number | null;
};

function eventDateKey(event: CalendarEvent, tz: string): string {
  return localDate(new Date(event.start_time), event.all_day ? "UTC" : tz);
}

function eventStillUpcoming(event: CalendarEvent, nowMs: number): boolean {
  if (event.all_day) return true;
  const endMs = new Date(event.end_time ?? event.start_time).getTime();
  return endMs >= nowMs;
}

function sortEvents(a: CalendarEvent, b: CalendarEvent): number {
  if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
  return a.start_time.localeCompare(b.start_time);
}

function isPassed(subs: SubmissionRow[]): boolean {
  return subs.some(
    (s) =>
      (s.score_total ?? 0) > 0 && (s.score_correct ?? 0) === (s.score_total ?? 0)
  );
}

function pagesReadByBook(
  books: BookRow[],
  checkins: CheckinRow[],
  weekStart: string
): Map<string, number> {
  const baselineBeforeWeek = new Map<string, { page: number; on: string }>();
  const earliestCheckin = new Map<string, { page: number; on: string }>();

  for (const c of checkins) {
    if (c.checked_on < weekStart) {
      const prev = baselineBeforeWeek.get(c.book_id);
      if (!prev || c.checked_on > prev.on) {
        baselineBeforeWeek.set(c.book_id, { page: c.page, on: c.checked_on });
      }
    }
    const earliest = earliestCheckin.get(c.book_id);
    if (!earliest || c.checked_on < earliest.on) {
      earliestCheckin.set(c.book_id, { page: c.page, on: c.checked_on });
    }
  }

  const out = new Map<string, number>();
  for (const book of books) {
    const baseline =
      baselineBeforeWeek.get(book.id)?.page ??
      earliestCheckin.get(book.id)?.page ??
      book.current_page;
    out.set(book.id, Math.max(0, book.current_page - baseline));
  }
  return out;
}

function activeQuizByBook(
  quizzes: QuizRow[],
  submissionsByQuiz: Map<string, SubmissionRow[]>,
  dueNow: boolean
): Map<string, HomeReadingBookStatus["quiz"]> {
  const out = new Map<string, HomeReadingBookStatus["quiz"]>();
  for (const quiz of quizzes) {
    if (out.has(quiz.book_id)) continue;
    const subs = submissionsByQuiz.get(quiz.id) ?? [];
    if (isPassed(subs)) continue;
    out.set(quiz.book_id, {
      id: quiz.id,
      state: activeQuizState(subs.length > 0, dueNow),
    });
  }
  return out;
}

async function readingByMember(
  members: MemberRow[],
  weekStart: string,
  dueNow: boolean,
  dueLabel: string
): Promise<Map<string, HomePersonReadingStatus>> {
  const admin = createAdminClient();
  const readableMembers = members.filter((m) => m.user_id);
  if (readableMembers.length === 0) return new Map();

  const emails = readableMembers.map((m) => m.email);
  const userIds = readableMembers.map((m) => m.user_id as string);

  const [{ data: settings }, { data: bookRows }] = await Promise.all([
    admin
      .from("reading_settings")
      .select("member_email, weekly_page_goal")
      .in("member_email", emails),
    admin
      .from("reading_books")
      .select("id, user_id, title, author, current_page, target_page, total_pages")
      .in("user_id", userIds)
      .eq("status", "in_progress")
      .order("created_at", { ascending: true }),
  ]);

  const books = (bookRows ?? []) as BookRow[];
  const bookIds = books.map((b) => b.id);
  const quizIdsByBook = new Map<string, HomeReadingBookStatus["quiz"]>();
  let pagesThisWeek = new Map<string, number>();

  if (bookIds.length > 0) {
    const [{ data: checkins }, { data: quizzes }] = await Promise.all([
      admin
        .from("reading_checkins")
        .select("book_id, checked_on, page")
        .in("book_id", bookIds),
      admin
        .from("reading_quizzes")
        .select("id, book_id")
        .in("book_id", bookIds)
        .eq("status", "published")
        .order("published_at", { ascending: false }),
    ]);

    pagesThisWeek = pagesReadByBook(
      books,
      (checkins ?? []) as CheckinRow[],
      weekStart
    );

    const quizRows = (quizzes ?? []) as QuizRow[];
    const quizIds = quizRows.map((q) => q.id);
    const submissionsByQuiz = new Map<string, SubmissionRow[]>();
    if (quizIds.length > 0) {
      const { data: submissions } = await admin
        .from("reading_quiz_submissions")
        .select("quiz_id, score_correct, score_total")
        .in("quiz_id", quizIds);
      for (const s of ((submissions ?? []) as SubmissionRow[])) {
        const list = submissionsByQuiz.get(s.quiz_id) ?? [];
        list.push(s);
        submissionsByQuiz.set(s.quiz_id, list);
      }
    }

    for (const [bookId, quiz] of activeQuizByBook(
      quizRows,
      submissionsByQuiz,
      dueNow
    )) {
      quizIdsByBook.set(bookId, quiz);
    }
  }

  const goalByEmail = new Map<string, number>();
  for (const s of settings ?? []) {
    goalByEmail.set(
      s.member_email as string,
      (s.weekly_page_goal as number | null) ?? 0
    );
  }

  const emailByUserId = new Map(
    readableMembers.map((m) => [m.user_id as string, m.email])
  );
  const out = new Map<string, HomePersonReadingStatus>();
  for (const member of readableMembers) {
    out.set(member.email, {
      weeklyPageGoal: goalByEmail.get(member.email) ?? 0,
      pagesReadThisWeek: 0,
      books: [],
    });
  }

  for (const book of books) {
    const email = emailByUserId.get(book.user_id);
    if (!email) continue;
    const status = out.get(email);
    if (!status) continue;
    const pagesReadThisWeek = pagesThisWeek.get(book.id) ?? 0;
    status.pagesReadThisWeek += pagesReadThisWeek;
    status.books.push({
      id: book.id,
      title: book.title,
      author: book.author,
      currentPage: book.current_page,
      targetPage: book.target_page,
      totalPages: book.total_pages,
      pagesReadThisWeek,
      dueLabel,
      quiz: quizIdsByBook.get(book.id) ?? null,
    });
  }

  return out;
}

/** Kids plus the other parent, for the parent Home sidebar. */
export async function getHomePersonStatuses(
  tz: string,
  viewerEmail: string | null
): Promise<HomePersonStatus[]> {
  const admin = createAdminClient();
  const now = Date.now();
  const today = localDate(new Date(now), tz);
  const weekStart = getWeekStart(today);
  const dayOfWeek = new Date(`${today}T12:00:00`).getDay();
  const dueNow = isQuizDueWindow(dayOfWeek);
  const dueLabel = readingTargetDueLabelFromDateKey(today);

  const [{ data: memberRows }, events] = await Promise.all([
    admin
      .from("family_members")
      .select("email, name, role, user_id, color")
      .order("role", { ascending: true })
      .order("name", { ascending: true }),
    getCalendarEvents({
      rangeStart: new Date(now - DAY_MS),
      rangeEnd: new Date(now + 2 * DAY_MS),
    }),
  ]);

  const members = (memberRows ?? []) as MemberRow[];
  const kids = members.filter((m) => m.role === "kid");
  const otherParent = members.find(
    (m) => m.email !== viewerEmail && (m.role === "owner" || m.role === "parent")
  );
  const targets = otherParent ? [...kids, otherParent] : kids;
  const readingByEmail = await readingByMember(
    targets,
    weekStart,
    dueNow,
    dueLabel
  );

  const eventsByEmail = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    if (!event.member_email) continue;
    if (eventDateKey(event, tz) !== today) continue;
    if (!eventStillUpcoming(event, now)) continue;
    const list = eventsByEmail.get(event.member_email) ?? [];
    list.push(event);
    eventsByEmail.set(event.member_email, list);
  }

  return targets.map((member) => ({
    email: member.email,
    name: member.name ?? member.email,
    role: member.role,
    color: member.color ?? memberColor(member.email),
    reading: readingByEmail.get(member.email) ?? null,
    events: (eventsByEmail.get(member.email) ?? []).sort(sortEvents),
  }));
}
