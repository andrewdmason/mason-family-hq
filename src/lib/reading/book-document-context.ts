import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTextForRange } from "@/lib/reading/extract-text";
import type { ChapterIndexEntry } from "@/lib/reading/context-markup";
import type { BookScope } from "@/lib/reading/book-documents";
import { gatherReaderProfile, type ReaderProfile } from "@/lib/reading/reader-profile";
import {
  isReaderChatTemplate,
  type ReaderChatTemplate,
} from "@/lib/reading/annotation-types";

/**
 * Everything the reader's preface and afterword are written from.
 *
 * The two documents differ less than they look. Both hold the whole book and
 * what we know about how it got onto the shelf; the afterword additionally holds
 * everything the reader did to it — every passage marked, every note, every
 * conversation — and the preface they wrote before starting. So this gathers one
 * shape with the afterword's extras nullable, rather than two near-identical
 * ones that would drift.
 *
 * Nothing here is scoped by itself: pass the resolved member client and userId
 * (see resolveReadingScope), because in member mode that client bypasses RLS.
 */

/** No page boundary — take the book to its end. */
const NO_PAGE_LIMIT = 1_000_000_000;

/**
 * Char cap on the book text. Not the real gate — the model's window is — just a
 * backstop so a pathological book can't build a request that fails after the
 * reader has already watched it start.
 */
const MAX_BOOK_CHARS = 2_400_000;

/**
 * Char cap on the reader's own marks, and the count that goes with it. A book
 * imported with hundreds of Kindle highlights is the ordinary case, not the
 * pathological one, so this is sized to hold all of them and only ever bites on
 * something extraordinary. What's dropped is dropped from the END — the marks
 * are in reading order, and an afterword that has seen the first two thirds of
 * your attention is better than one that has seen a random sample of it.
 */
const MAX_MARK_CHARS = 400_000;

/** How many finished books stand in for the reader's taste. Newest first. */
const HISTORY_LIMIT = 30;

/** How the reader marked one passage, and everything they said about it. */
export type ReaderMark = {
  page: number | null;
  /** The passage itself, when they selected one. */
  quote: string | null;
  /** Their own writing on it, oldest first. */
  notes: string[];
  /** What they asked here and what came back, in order. */
  exchanges: { question: string; answer: string | null }[];
  /** True when this was a chapter recap rather than something they marked. */
  isChapterSummary: boolean;
  /**
   * Which margin template started this thread, when one did.
   *
   * The reason it travels: a run of earlier check-ins is not a pile of marks, it
   * is the same conversation on earlier days, and a companion that cannot tell
   * the two apart re-opens ground it already covered. Null for a highlight, a
   * note, or a chat the reader typed themselves.
   */
  template: ReaderChatTemplate | null;
};

export type FinishedBook = {
  title: string;
  author: string | null;
  rating: string | null;
  finishedAt: string | null;
};

export type BookDocumentContext = {
  scope: BookScope;
  bookTitle: string;
  bookAuthor: string | null;
  genres: string[];
  /**
   * Whether this book is a story, which is what decides how much of it a preface
   * may describe.
   *
   * Read from the book's own fiction flag. It used to be read off the spoiler
   * switch, which was never a faithful answer: that flag ended up tracking how a
   * book was ADDED — everything from the bulk import read as a story, everything
   * added by hand read as not one — so most of the shelf was being interviewed
   * through the wrong lens. The switch is still the fallback for a book nothing
   * has classified yet, where staying protective is the safe way to be wrong.
   */
  isStory: boolean;
  bookText: string;
  hasPageMarkers: boolean;
  hasChapterMarkers: boolean;
  chapters: ChapterIndexEntry[];
  /** Whether the middle of the book was elided to fit. */
  truncated: boolean;
  /** Who put this book in front of them, if anyone. */
  recommendedBy: string | null;
  recommendationNote: string | null;
  /** What they've finished lately, newest first — the evidence a guess rests on. */
  history: FinishedBook[];
  /**
   * Who the reader is, from the journal. The other half of the evidence, and the
   * more important half for a preface: what they have finished says what they
   * read, this says who is asking.
   */
  profile: ReaderProfile;
  startedAt: string | null;
  finishedAt: string | null;
  rating: string | null;
  /** Afterword only: their marks in reading order. Null for a preface. */
  marks: ReaderMark[] | null;
  /** How many marks there were before any cap was applied. */
  markCount: number;
  /**
   * How many of those were passages the reader actually marked, as opposed to
   * chapter recaps they asked for. What the afterword's dateline counts: a
   * recap is something the app produced, not something they noticed.
   */
  passageCount: number;
  /** Whether the cap above dropped any. */
  marksTruncated: boolean;
  /** Afterword only: the preface they wrote before reading, if they wrote one. */
  preface: string | null;
};

/**
 * The reader's most recent preface for a book, as plain text.
 *
 * Shared: the afterword reads it to ask whether they got what they came for, and
 * the mid-book chat reads it to know what they're here for. Returns null when
 * there is no preface, which is the common case and not a failure.
 */
export async function getBookPreface(
  client: SupabaseClient,
  userId: string,
  bookId: string
): Promise<string | null> {
  const { data: row } = await client
    .from("reading_annotations")
    .select("id")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .eq("book_scope", "preface")
    .maybeSingle();
  if (!row) return null;

  // The latest, not the first: regenerating appends, and what the reader means
  // by "my preface" is the one they'd read if they opened it now.
  const { data: msg } = await client
    .from("reading_annotation_messages")
    .select("content")
    .eq("annotation_id", row.id as string)
    .eq("user_id", userId)
    .eq("role", "document")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const text = ((msg?.content as string | null) ?? "").trim();
  return text.length > 0 ? text : null;
}

/**
 * Every passage the reader marked in a book, in reading order, with everything
 * they wrote or asked at each one.
 *
 * Two queries rather than one per annotation, and the book's own preface and
 * afterword are excluded — an afterword that quoted an earlier afterword back at
 * itself would compound its own mistakes with every regeneration.
 *
 * Exported because the mid-book chat templates need exactly this and gathering
 * it twice, two ways, is how the check-in and the afterword would end up
 * disagreeing about what the reader marked.
 */
export async function getReaderMarks(
  client: SupabaseClient,
  userId: string,
  bookId: string,
  options?: {
    /**
     * A chat to leave out — always the one currently asking.
     *
     * Without this a check-in feeds itself: its own question and its own
     * several-hundred-word answer come back as a "mark" on the next turn, where
     * they are already sitting in the conversation turns. The model would then
     * be reading its own last reply as evidence about what caught the reader's
     * attention, which is both false and expensive.
     */
    excludeAnnotationId?: string | null;
    /**
     * Char budget, when the caller can afford less than an afterword can. A chat
     * sends the whole book on every turn and a document does not, so the two
     * have genuinely different room.
     */
    maxChars?: number;
    /**
     * Narrow to threads started by one margin template.
     *
     * The check-in wants its own earlier check-ins and nothing else — not the
     * reader's highlights, not their margin questions. Filtered in the query
     * rather than after it: on a book imported with hundreds of Kindle
     * highlights, fetching every annotation and every message attached to them
     * to keep three is most of the cost of the feature for none of the value.
     */
    onlyTemplate?: ReaderChatTemplate;
  }
): Promise<{
  marks: ReaderMark[];
  total: number;
  passages: number;
  truncated: boolean;
}> {
  const budget = options?.maxChars ?? MAX_MARK_CHARS;
  const query = client
    .from("reading_annotations")
    .select("id, anchor_page, quoted_text, chapter_anchor_id, template")
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .is("book_scope", null)
    .order("anchor_char_offset", { ascending: true });
  if (options?.excludeAnnotationId) {
    query.neq("id", options.excludeAnnotationId);
  }
  if (options?.onlyTemplate) {
    query.eq("template", options.onlyTemplate);
  }
  const { data: rows } = await query;

  const annotations = (rows ?? []) as {
    id: string;
    anchor_page: number | null;
    quoted_text: string | null;
    chapter_anchor_id: string | null;
    template: string | null;
  }[];
  if (annotations.length === 0) {
    return { marks: [], total: 0, passages: 0, truncated: false };
  }

  // An empty .in() list is a malformed PostgREST filter, which is why the early
  // return above isn't just an optimisation.
  const { data: msgRows } = await client
    .from("reading_annotation_messages")
    .select("annotation_id, role, content, created_at")
    .eq("user_id", userId)
    .in(
      "annotation_id",
      annotations.map((a) => a.id)
    )
    .in("role", ["user", "assistant", "note"])
    .order("created_at", { ascending: true });

  const byAnnotation = new Map<string, { role: string; content: string }[]>();
  for (const m of (msgRows ?? []) as {
    annotation_id: string;
    role: string;
    content: string;
  }[]) {
    const list = byAnnotation.get(m.annotation_id) ?? [];
    list.push({ role: m.role, content: m.content });
    byAnnotation.set(m.annotation_id, list);
  }

  const marks: ReaderMark[] = [];
  let chars = 0;
  let truncated = false;
  for (const a of annotations) {
    const msgs = byAnnotation.get(a.id) ?? [];
    const notes = msgs.filter((m) => m.role === "note").map((m) => m.content);
    const exchanges: ReaderMark["exchanges"] = [];
    for (const m of msgs) {
      if (m.role === "user") exchanges.push({ question: m.content, answer: null });
      else if (m.role === "assistant") {
        const open = exchanges.at(-1);
        if (open && open.answer == null) open.answer = m.content;
        else exchanges.push({ question: "", answer: m.content });
      }
    }

    const mark: ReaderMark = {
      page: a.anchor_page,
      quote: a.quoted_text,
      notes,
      exchanges,
      isChapterSummary: a.chapter_anchor_id != null,
      template: isReaderChatTemplate(a.template) ? a.template : null,
    };
    const size =
      (mark.quote?.length ?? 0) +
      notes.reduce((n, t) => n + t.length, 0) +
      exchanges.reduce((n, e) => n + e.question.length + (e.answer?.length ?? 0), 0);
    if (chars + size > budget) {
      truncated = true;
      break;
    }
    chars += size;
    marks.push(mark);
  }

  return {
    marks,
    total: annotations.length,
    passages: annotations.filter((a) => a.chapter_anchor_id == null).length,
    truncated,
  };
}

/**
 * Everything needed to write one of the reader's two documents.
 *
 * Returns null when the book has no converted text, which is the one condition
 * that makes both documents impossible rather than merely thin.
 */
export async function gatherBookDocumentContext(
  client: SupabaseClient,
  userId: string,
  bookId: string,
  scope: BookScope,
  /**
   * The reader's own email and today's date, for the journal profile. Both come
   * from the resolved reading scope rather than the session — in member mode the
   * signed-in caller is not the person this document is about.
   */
  identity: { email: string | null; today: string }
): Promise<BookDocumentContext | null> {
  // One string literal, not a concatenation: PostgREST's column typing is
  // inferred from the literal, and a `+` between two halves of it silently
  // widens every field to an error type.
  const { data: book } = await client
    .from("reading_books")
    .select(
      "title, author, genres, fiction, spoiler_free, status, rating, started_at, finished_at, recommended_by_label, recommended_by_email, recommendation_note"
    )
    .eq("id", bookId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!book) return null;

  const slice = await getTextForRange(client, userId, bookId, null, NO_PAGE_LIMIT, {
    pageMarkers: true,
    chapterMarkers: true,
    maxChars: MAX_BOOK_CHARS,
  });
  if (!slice) return null;

  // What the reader has finished lately, and what they made of it. The evidence
  // an educated guess rests on — a question that can't point at something real
  // is better asked plainly, so this is what decides whether it can.
  const { data: historyRows } = await client
    .from("reading_books")
    .select("title, author, rating, finished_at")
    .eq("user_id", userId)
    .eq("status", "finished")
    .neq("id", bookId)
    .order("finished_at", { ascending: false, nullsFirst: false })
    .limit(HISTORY_LIMIT);

  const marksResult =
    scope === "afterword"
      ? await getReaderMarks(client, userId, bookId)
      : null;

  const preface =
    scope === "afterword" ? await getBookPreface(client, userId, bookId) : null;

  const profile = await gatherReaderProfile(
    client,
    userId,
    identity.email,
    identity.today
  );

  return {
    scope,
    bookTitle: book.title as string,
    bookAuthor: (book.author as string | null) ?? null,
    genres: ((book.genres as string[] | null) ?? []).filter(Boolean),
    isStory: (book.fiction as boolean | null) ?? book.spoiler_free === true,
    bookText: slice.text,
    hasPageMarkers: slice.hasPageMarkers,
    hasChapterMarkers: slice.hasChapterMarkers,
    chapters: slice.chapters,
    truncated: slice.truncated,
    recommendedBy:
      (book.recommended_by_label as string | null) ??
      (book.recommended_by_email as string | null) ??
      null,
    recommendationNote: (book.recommendation_note as string | null) ?? null,
    history: (
      (historyRows ?? []) as {
        title: string;
        author: string | null;
        rating: string | null;
        finished_at: string | null;
      }[]
    ).map((h) => ({
      title: h.title,
      author: h.author,
      rating: h.rating,
      finishedAt: h.finished_at,
    })),
    profile,
    startedAt: (book.started_at as string | null) ?? null,
    finishedAt: (book.finished_at as string | null) ?? null,
    rating: (book.rating as string | null) ?? null,
    marks: marksResult?.marks ?? null,
    markCount: marksResult?.total ?? 0,
    passageCount: marksResult?.passages ?? 0,
    marksTruncated: marksResult?.truncated ?? false,
    preface,
  };
}

const RATING_WORD: Record<string, string> = {
  loved: "Loved it",
  liked: "Liked it",
  neutral: "It was fine",
  disliked: "Didn't like it",
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * A calendar date, rendered as the calendar date it is.
 *
 * started_at and finished_at are DATE columns, so "2026-01-04" means that day
 * and no particular moment in it. Handing that to `new Date()` parses it as UTC
 * midnight, and formatting it anywhere west of Greenwich then prints the day
 * before — which on the one line of an afterword whose entire job is to be
 * trusted years later is the worst place in the reader to be off by one.
 * Split the string instead; there is no instant here to convert.
 */
function shortDate(value: string | null): string | null {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return null;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * The one factual line an afterword opens with: when you read it, how long it
 * took, what you made of it, how much you marked.
 *
 * Written here rather than by the model, and prepended to the document when it
 * is persisted. Every value in it is something we already know exactly, and a
 * model asked to copy four numbers into prose will eventually get one wrong —
 * on a document whose entire premise is that it can be trusted years later.
 *
 * Returns an empty string when we know none of it, so the document simply starts
 * with its first sentence rather than with an empty dateline.
 */
export function afterwordDateline(ctx: BookDocumentContext): string {
  const parts: string[] = [];

  // Dates only where they were recorded. An afterword is written as though the
  // book was read in full, but that is an instruction about the WRITING — the
  // dateline reports what we actually know, and inventing a finish date the
  // shelf never captured is the one thing it must not do.
  const from = shortDate(ctx.startedAt);
  const to = shortDate(ctx.finishedAt);
  if (from && to) parts.push(from === to ? `Read ${from}` : `Read ${from} – ${to}`);
  else if (to) parts.push(`Finished ${to}`);
  else if (from) parts.push(`Started ${from}`);

  if (ctx.startedAt && ctx.finishedAt) {
    const days = Math.round(
      (new Date(ctx.finishedAt).getTime() - new Date(ctx.startedAt).getTime()) /
        86_400_000
    );
    if (Number.isFinite(days) && days > 0) {
      parts.push(days === 1 ? "1 day" : `${days} days`);
    }
  }

  if (ctx.rating && RATING_WORD[ctx.rating]) parts.push(RATING_WORD[ctx.rating]);

  if (ctx.passageCount > 0) {
    parts.push(
      ctx.passageCount === 1
        ? "1 passage marked"
        : `${ctx.passageCount} passages marked`
    );
  }

  return parts.join(" · ");
}
