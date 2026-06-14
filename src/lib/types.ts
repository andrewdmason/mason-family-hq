import type { CategoryContextSpec } from "@/lib/journal/question-sources";

// Enums matching database
export type PieceStatus = "active" | "upcoming" | "archived";
export type PieceKind = "piece" | "technique" | "sight_reading";

// System piece constants
export const TECHNIQUE_PIECE_ID = "00000000-0000-0000-0000-000000000001";
export const SIGHT_READING_PIECE_ID = "00000000-0000-0000-0000-000000000002";
export const SYSTEM_PIECE_IDS = [TECHNIQUE_PIECE_ID, SIGHT_READING_PIECE_ID] as const;

// Database row types
export type Work = {
  id: string;
  name: string;
  composer: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Piece = {
  id: string;
  work_id: string | null;
  name: string;
  composer: string | null;
  status: PieceStatus;
  kind: PieceKind;
  notes: string | null;
  target_tempo: number | null;
  created_at: string;
  updated_at: string;
};

export type TimeSummaryEntry = {
  piece_id: string;
  piece_name: string;
  kind: PieceKind;
  total_seconds: number;
  day_count?: number;
};

export type LessonTimeSummary = {
  entries: TimeSummaryEntry[];
  totalSeconds: number;
  dayCount: number;
  calendarDays: number;
};

// Composite types for views
export type WorkWithPieces = Work & {
  pieces: Piece[];
};

export type PieceWithLastPlayed = Piece & {
  last_played: string | null;
};

// Label constants
export const PIECE_STATUS_LABELS: Record<PieceStatus, string> = {
  active: "Active",
  upcoming: "Upcoming",
  archived: "Archived",
};

export const PIECE_STATUSES: PieceStatus[] = ["active", "upcoming", "archived"];


export type Assignment = {
  id: string;
  piece_id: string;
  text: string;
  completed: boolean;
  completed_at: string | null;
  sort_order: number;
  metronome_speed: number | null;
  created_at: string;
  updated_at: string;
};

export type PracticeTask = {
  id: string;
  piece_id: string | null;
  section_id: string | null;
  date: string;
  text: string;
  metronome_speed: number | null;
  timer_seconds: number;
  timer_remaining_seconds: number;
  completed: boolean;
  completed_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  sort_order: number;
  session_number: number;
  audio_path: string | null;
  audio_duration_seconds: number | null;
  audio_trim_start_seconds: number | null;
  audio_trim_end_seconds: number | null;
  audio_title: string | null;
  created_at: string;
  updated_at: string;
};

export type LessonEntry = {
  id: string;
  lesson_id: string;
  piece_id: string | null;
  date: string | null;
  notes: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type LessonEntryWithPiece = LessonEntry & {
  piece_name: string | null;
  piece_composer: string | null;
};

export type LessonDay = {
  date: string;
  entries: LessonEntryWithPiece[];
  timeSummary: LessonTimeSummary;
};

export type Lesson = {
  id: string;
  date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LessonWithEntries = Lesson & {
  entries: LessonEntryWithPiece[];
  timeSummary: LessonTimeSummary;
  previousLessonDate: string | null;
};

export type LessonIndexEntry = {
  id: string;
  date: string | null;
  completed_at: string | null;
};

export type PieceSuggestion = {
  id: string;
  name: string;
  composer: string | null;
};

// Report types
export type WeeklyPracticeData = {
  weekStart: string; // YYYY-MM-DD (Monday)
  weekLabel: string; // "Mar 10"
  totalSeconds: number;
};

export type PieceBreakdownData = {
  pieceId: string;
  label: string;
  totalSeconds: number;
  kind: PieceKind;
};

export type StreakData = {
  currentStreak: number;
  daysPracticedThisWeek: number;
  thisWeekDays: boolean[]; // Mon-Sun
};

/**
 * A trailing-window view of practice volume: the last 7 days versus the 7 days
 * before that. Trailing (rather than calendar-week) so the comparison stays
 * stable through the week instead of collapsing every Monday.
 */
export type TrailingPracticeData = {
  /** Total practice seconds over the trailing 7 days, today inclusive. */
  currentSeconds: number;
  /** Total over the 7 days immediately before that window. */
  previousSeconds: number;
  /** Daily practice seconds for the last 14 days, oldest first (length 14). */
  dailySeconds: number[];
};

export type PieceWeeklyCumulativeData = {
  weekStart: string; // YYYY-MM-DD (Monday)
  weekLabel: string; // "Mar 10"
  weekSeconds: number;
  cumulativeSeconds: number;
  completionPct?: number; // 0-100, % of sections fully complete
};

export type PieceOption = {
  id: string;
  name: string;
  composer: string | null;
};

export type CompletedAssignmentMarker = {
  weekStart: string;
  weekLabel: string;
  cumulativeHours: number;
  assignments: { id: string; text: string; completedAt: string }[];
};

// Search types
export type SearchResultType =
  | "piece"
  | "work"
  | "practice_entry"
  | "lesson";

export type SearchResult = {
  result_type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  preview: string | null;
  date: string | null;
  url: string;
  rank: number;
};

export type TypeaheadResult = {
  id: string;
  name: string;
  composer: string | null;
  type: "piece" | "work";
  url: string;
};

// Focus panel types
export type StatusChange = {
  sectionLabel: string;
  oldStatus: SectionStatus;
  newStatus: SectionStatus;
};

export type RepertoireOverviewItem = {
  id: string;
  name: string;
  composer: string | null;
  last_played: string | null;
  open_assignments: number;
};

// Feed types
export type TaskWithDetails = PracticeTask & {
  piece_name: string | null;
  piece_composer: string | null;
  piece_kind: PieceKind | null;
  section_label: string | null;
  section_status: SectionStatus | null;
};

export type FeedDay = {
  date: string;
  tasks: TaskWithDetails[];
  timeSummary: TimeSummaryEntry[];
  /** Status changes grouped by piece_id for this date */
  statusChangesByPiece?: Record<string, StatusChange[]>;
};

// Piece section types
export type SectionStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const SECTION_STATUS_PERCENTAGE: Record<SectionStatus, number> = {
  0: 0,
  1: 0.4,
  2: 0.5,
  3: 0.6,
  4: 0.7,
  5: 0.8,
  6: 0.9,
  7: 1,
  8: 1,
};

export const SECTION_STATUS_LABELS: Record<SectionStatus, string> = {
  0: "Not started",
  1: "40% target tempo",
  2: "50% target tempo",
  3: "60% target tempo",
  4: "70% target tempo",
  5: "80% target tempo",
  6: "90% target tempo",
  7: "100% target tempo",
  8: "Complete",
};

export const SECTION_STATUS_COLORS: Record<SectionStatus, string> = {
  0: "bg-white dark:bg-muted",
  1: "bg-[#D6E4F0]",
  2: "bg-[#B8D4F0]",
  3: "bg-[#94BDE8]",
  4: "bg-[#6FA3DE]",
  5: "bg-[#4D8AD4]",
  6: "bg-[#3070C4]",
  7: "bg-[#1A56B0]",
  8: "bg-[#22C55E]",
};

export const SECTION_STATUS_TEXT_COLORS: Record<SectionStatus, string> = {
  0: "text-muted-foreground",
  1: "text-slate-700",
  2: "text-slate-700",
  3: "text-slate-800",
  4: "text-white",
  5: "text-white",
  6: "text-white",
  7: "text-white",
  8: "text-white",
};

export const SECTION_STATUS_DOT_COLORS: Record<SectionStatus, string> = {
  0: "text-muted-foreground",
  1: "text-[#D6E4F0]",
  2: "text-[#B8D4F0]",
  3: "text-[#94BDE8]",
  4: "text-[#6FA3DE]",
  5: "text-[#4D8AD4]",
  6: "text-[#3070C4]",
  7: "text-[#1A56B0]",
  8: "text-[#22C55E]",
};

export const SECTION_STATUS_HEX_COLORS: Record<SectionStatus, string> = {
  0: "#E5E7EB",
  1: "#D6E4F0",
  2: "#B8D4F0",
  3: "#94BDE8",
  4: "#6FA3DE",
  5: "#4D8AD4",
  6: "#3070C4",
  7: "#1A56B0",
  8: "#22C55E",
};

export type SectionStatusSnapshot = {
  id: string;
  piece_id: string;
  section_id: string;
  old_status: SectionStatus;
  new_status: SectionStatus;
  snapshot_date: string;
  created_at: string;
  updated_at: string;
};

export type PieceSection = {
  id: string;
  piece_id: string;
  parent_id: string | null;
  label: string;
  name: string | null;
  notes: string | null;
  sort_order: number;
  status: SectionStatus;
  target_tempo: number | null;
  created_at: string;
  updated_at: string;
};

export type PieceSectionWithChildren = PieceSection & {
  children: PieceSection[];
};

// ============================================================
// Journal app
// ============================================================

export type JournalAgentFileName = "Interviewer" | "Present";

export type JournalAgentFile = {
  id: string;
  name: JournalAgentFileName;
  content: string;
  agent_writable: boolean;
  created_at: string;
  updated_at: string;
};

export type JournalQuestionType = {
  id: string;
  name: string; // kebab-case identifier
  base_description: string;
  style_note: string;
  weight: number;
  enabled: boolean;
  is_builtin: boolean;
  sort_order: number;
  /** Recurring posts: the rolling cadence in days. Null = ordinary rotation type.
   * A recurring type is excluded from the random daily sampler and instead nudged
   * via a notification when its interval lapses. */
  recurrence_days: number | null;
  /** Recurring posts: the user's chosen context sources, overriding the name-based
   * default. Null falls back to specFor(name). See question-sources.ts. */
  context_spec: CategoryContextSpec | null;
  created_at: string;
  updated_at: string;
};

export type JournalSettings = {
  questions_per_day: number;
};

/**
 * A member's role. Cross-app (journal, reader, practice, …):
 * - `owner`  — the family admin + practice book (just Andrew).
 * - `parent` — a grown-up (Andrew, Jenny).
 * - `kid`    — a child (Oscar, Sebastian).
 *
 * Today only `owner` carries extra capability; `parent` and `kid` behave like
 * any other member. The distinction is the seam for handing out abilities later.
 */
export type MemberRole = "owner" | "parent" | "kid";

/** A family member: the sign-in allowlist + per-member provisioning record. */
export type FamilyMember = {
  email: string;
  name: string | null;
  role: MemberRole;
  user_id: string | null;
  seeded_at: string | null;
  birthdate: string | null;
  /** Email of this member's mother / father (another member), or null. */
  mother_email: string | null;
  father_email: string | null;
  /** Official display color (CSS hex), set in Family settings. Null = unset. */
  color: string | null;
};

/** A profile photo for a family member, with a short-lived signed display URL. */
export type MemberPhoto = {
  id: string;
  url: string;
  is_primary: boolean;
};

export type MemberJournalStats = {
  currentStreak: number;
  daysLast7: number;
  daysLast30: number;
};

/** Whether an entry is private to its author or shared to the whole family. */
export type JournalVisibility = "private" | "family";

/**
 * One proposed opening question. `type` is the kebab-case question-type name it
 * was generated for (e.g. "recent-calendar"), or null when it isn't tied to a
 * specific type. `visibility` is the model's suggested default for the resulting
 * entry — "family" for questions about shared/social moments, "private"
 * otherwise — which pre-sets (but doesn't lock) the entry's visibility toggle.
 * Persisted in `journal_entries.opening_candidates` (jsonb).
 */
export type JournalOpeningCandidate = {
  text: string;
  type: string | null;
  visibility: JournalVisibility;
  /**
   * A concise (2–5 word) version of the question, generated alongside it, used to
   * pre-fill the entry's editable title the moment the writer picks this question.
   * Null/absent for legacy rows and untyped fallbacks.
   */
  conciseTitle?: string | null;
  /**
   * Set only for currently-reading candidates: the in-progress book the question
   * is about. Picking the candidate links the entry to this book. Null/absent for
   * every other type.
   */
  reading_book_id?: string | null;
  /**
   * Set only for reminiscence candidates: the timeline event the question is
   * about. Picking the candidate links the entry to this event. Null/absent for
   * every other type.
   */
  timeline_entry_id?: string | null;
};

export type JournalEntryStatus = "open" | "closed";

/**
 * The kind of entry. "standard" is the reflective entry (picked opening
 * question or freeform writing, with AI follow-ups and a wrap-generated
 * title). "quote" is a frictionless capture of a quote + attribution with no
 * AI engagement. "recap" is a pasted-in monthly chatbot recap (a markdown
 * document with a user-supplied title), also with no AI engagement. Distinct
 * from JournalQuestionType (categories of opening questions).
 */
export type JournalEntryType = "standard" | "quote" | "recap";

export type JournalEntry = {
  id: string;
  entry_date: string; // YYYY-MM-DD
  user_id: string;
  status: JournalEntryStatus;
  entry_type: JournalEntryType;
  visibility: JournalVisibility;
  opening_question: string | null;
  opening_candidates: JournalOpeningCandidate[] | null;
  /** The question category this entry was answered from — the question type's
   * kebab-case `name` (e.g. "recent-calendar"). Null for freeform/quote/recap
   * and pre-existing entries. Drives the category label in the journal feed. */
  question_type: string | null;
  candidates_reroll_count: number;
  freeform_started_at: string | null;
  /** The manual AI-chat toggle. ON: submitting a reply also asks the interviewer
   * a follow-up question. OFF: replies are just saved. Defaults false. */
  question_mode: boolean;
  /** Whether the five-minute timer's one-time flip of question_mode to OFF has
   * already happened, so it fires exactly once. */
  timer_flipped_off: boolean;
  /** The unsent in-progress reply draft, autosaved; cleared on commit. */
  draft_reply: string | null;
  summary: string | null;
  title: string | null;
  pull_quote: string | null;
  quote_attribution: string | null;
  recap_body: string | null;
  summary_stale: boolean;
  /** The book this entry is about, when answered from a currently-reading question. */
  reading_book_id: string | null;
  /** The timeline event this entry elaborates, when answered from a reminiscence
   * question that targeted one. Null otherwise. */
  timeline_entry_id: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

// ============================================================
// Timeline
// ============================================================

export const TIMELINE_CATEGORIES = [
  "origins",
  "childhood",
  "education",
  "career",
  "recognition",
  "relationships",
  "children_family",
  "homes",
  "travel",
  "music_hobbies",
  "health_hard_times",
] as const;
export type TimelineCategory = (typeof TIMELINE_CATEGORIES)[number];

export type TimelineProminence = "major" | "medium" | "minor";

/** How precise a timeline date is. Governs rendering (so "1986" never becomes
 * "Jan 1 1986"); the stored date is always normalized to first-of-period. */
export type DatePrecision = "year" | "month" | "day";

/** A person's relationship to a timeline entry: it's their life event
 * ("subject") or they're merely named in it ("mention"). */
export type TimelinePersonRole = "subject" | "mention";

/** A person in the shared registry. `member_email` links to a family_members
 * row (bridge to a real account) for family people; null for everyone else. */
export type Person = {
  id: string;
  name: string;
  member_email: string | null;
  notes: string | null;
};

/** The slim person shape carried on timeline entries. */
export type TimelinePerson = Pick<Person, "id" | "name" | "member_email"> & {
  /** Signed avatar URL, when the person is a family member with a profile photo. */
  avatarUrl?: string | null;
};

export type TimelineEntry = {
  id: string;
  title: string;
  description: string;
  category: TimelineCategory;
  prominence: TimelineProminence;
  location: string | null;
  /** Normalized to the first day of the stated period; sortable. */
  start_date: string; // YYYY-MM-DD
  start_precision: DatePrecision;
  /** Null => a point event; non-null => a period/span. */
  end_date: string | null;
  end_precision: DatePrecision | null;
  approximate: boolean;
  created_at: string;
  updated_at: string;
};

/** A journal entry that links to a timeline event (for the popover's list). */
export type TimelineLinkedPost = {
  id: string;
  title: string | null;
  summary: string | null;
  entry_date: string;
  authorName: string | null;
};

/** A photo (or video) pinned directly to a timeline event (no journal post). */
export type TimelineEntryPhoto = {
  id: string;
  displayUrl: string;
  /** Signed URL for the original video file (videos only); null for photos. */
  videoUrl: string | null;
  mediaType: JournalMediaType;
};

/** A timeline entry with its resolved people and viewer-relative metadata. */
export type TimelineEntryWithPeople = TimelineEntry & {
  subjects: TimelinePerson[];
  mentions: TimelinePerson[];
  /** Journal entries visible to the viewer that link to this event. */
  linkedCount: number;
  /** Those linked journal entries, newest first (for the hover popover). */
  linkedPosts: TimelineLinkedPost[];
  /** Photos pinned directly to this event (visible to the viewer), newest last. */
  photos: TimelineEntryPhoto[];
  /** A signed display URL for a representative photo — the first directly-pinned
   * photo, else one from a linked journal entry. Drives the timeline card's image. */
  coverPhotoUrl: string | null;
  /** When the cover is a video, its signed playback URL (the poster is `coverPhotoUrl`). */
  coverVideoUrl: string | null;
};

export type JournalMediaType = "photo" | "video";
export type JournalPhotoSource = "uploaded" | "ai_generated";

export type JournalEntryPhoto = {
  id: string;
  entry_id: string;
  media_type: JournalMediaType;
  source: JournalPhotoSource;
  original_path: string;
  display_path: string;
  created_at: string;
};

export type JournalMessageRole = "user" | "assistant";

export type JournalMessage = {
  id: string;
  entry_id: string;
  role: JournalMessageRole;
  content: string;
  created_at: string;
};

/**
 * A family member's inline comment on a finished, shared entry. Anchored to a
 * block_index (the ordinal position of a paragraph / message / the quote within
 * the entry — see src/lib/journal/entry-blocks.ts). Flat: comments at the same
 * block_index stack in created_at order.
 */
export type JournalInlineComment = {
  id: string;
  entry_id: string;
  user_id: string; // the commenter
  block_index: number;
  content: string;
  created_at: string;
  updated_at: string;
};

/** A comment plus the commenter's resolved display name, for rendering. */
export type JournalInlineCommentWithAuthor = JournalInlineComment & {
  authorName: string;
};

/**
 * Per-user read state for an entry: the last time the user opened its page.
 * Drives the notification badge (see src/lib/journal/notifications.ts).
 */
export type JournalEntryView = {
  user_id: string;
  entry_id: string;
  last_viewed_at: string;
};

/**
 * One item in the notification dropdown. `reason` is the human label ("New post",
 * "2 new comments", or a recurring post's "Due — last posted 34 days ago").
 * `href` is where clicking navigates: an entry page for unread family posts, or
 * the new-post flow for a due recurring post. `id` is a stable React key.
 */
export type JournalNotification = {
  id: string;
  title: string;
  reason: string;
  href: string;
};

/** The header badge's data: the unread posts and their count (== items.length). */
export type JournalNotifications = {
  count: number;
  items: JournalNotification[];
};

export type JournalMemoryProposal = {
  id: string;
  entry_id: string;
  proposed_addition: string;
  applied: boolean;
  created_at: string;
};

export type JournalEntrySummary = {
  id: string;
  entry_date: string;
  opening_question: string | null;
  summary: string | null;
};

export type JournalProfileSuggestionStatus = "pending" | "accepted" | "dismissed";

export type JournalProfileSuggestionChangeType = "add" | "edit" | "remove";

/** Which doc a suggestion targets. Only the Present (current-life) profile doc
 * now — biographical history lives in the shared timeline. */
export type JournalProfileSuggestionTarget = "Present";

/**
 * A passive, discriminating suggestion to update the user's Present profile doc,
 * produced by the wrap pass after an entry closes. Surfaced
 * as a toast the user accepts (auto-applies the change) or dismisses. For `add`,
 * `replace` holds the new text; for `edit`, `find`→`replace`; for `remove`,
 * `find` is excised.
 */
export type JournalProfileSuggestion = {
  id: string;
  source_entry_id: string | null;
  status: JournalProfileSuggestionStatus;
  change_type: JournalProfileSuggestionChangeType;
  target_doc: JournalProfileSuggestionTarget;
  find: string | null;
  replace: string | null;
  summary: string;
  created_at: string;
  resolved_at: string | null;
};

/**
 * The user's own YouTube recording of a performance, attached to either a piece
 * or a work (exactly one owner). Distinct from PieceVideo, which is the
 * section-practice reference video. Featured prominently on the detail page.
 */
export type Performance = {
  id: string;
  piece_id: string | null;
  work_id: string | null;
  youtube_video_id: string;
  title: string | null;
  performers: string | null;
  location: string | null;
  performed_on: string | null; // YYYY-MM-DD
  created_at: string;
  updated_at: string;
};

export type PieceVideo = {
  id: string;
  piece_id: string;
  youtube_video_id: string;
  title: string | null;
  sort_order: number;
  start_seconds: number | null;
  end_seconds: number | null;
  created_at: string;
  updated_at: string;
};

export type PieceSectionTimestamp = {
  id: string;
  section_id: string;
  video_id: string;
  start_seconds: number;
  end_seconds: number | null;
  created_at: string;
  updated_at: string;
};

// ============================================================
// Reading app
// ============================================================

export type ReadingBookStatus =
  | "in_progress"
  | "archive"
  | "paused"
  | "queued";

/** A reading item is either an uploaded book or a saved web article. */
export type ReadingContentType = "book" | "article";

/**
 * A member's verdict on a book. The emoji scale for books they read, plus
 * "didnt_finish" for ones they started but abandoned (a soft negative signal).
 */
export type ReadingRating =
  | "loved"
  | "liked"
  | "neutral"
  | "disliked"
  | "didnt_finish";

/** A book a family member is tracking (or a saved web article). */
export type ReadingBook = {
  id: string;
  user_id: string;
  /** "book" (uploaded file) or "article" (saved from the web). */
  type: ReadingContentType;
  title: string;
  author: string | null;
  /** Article only: canonical URL of the saved page. Null for books. */
  source_url: string | null;
  /** Article only: source site name (e.g. "The Verge"). Null for books. */
  site_name: string | null;
  /** Article only: short readability excerpt for the card. */
  excerpt: string | null;
  /** Article only: word count, drives the "N min read" estimate. */
  word_count: number | null;
  total_pages: number | null;
  current_page: number;
  /** This book's own weekly target page (in_progress only). Null = no target. */
  target_page: number | null;
  /** True when the owner manually set target_page; blocks auto-tracking until the next advance. */
  target_locked: boolean;
  /** When the current target is due (YYYY-MM-DD): the Friday after it was set. Null = no target. */
  target_due: string | null;
  status: ReadingBookStatus;
  cover_image_url: string | null;
  /** Open Library work key (e.g. "/works/OL12345W"), when added via typeahead. */
  openlibrary_key: string | null;
  /** ISBN-13 of a common edition, for re-fetch and external links. */
  isbn: string | null;
  /** First publication year, for display and sorting. */
  published_year: number | null;
  started_at: string | null;
  finished_at: string | null;
  /** The member's emoji rating, once they've read it. Null until rated. */
  rating: ReadingRating | null;
  /** Set when another member added this book to your list as a recommendation. */
  recommended_by_email: string | null;
  /** How to show the recommender — "Dad", "Mom", or their first name. */
  recommended_by_label: string | null;
  recommendation_note: string | null;
  created_at: string;
  updated_at: string;
};

/** Where a recommendation row is in its lifecycle (also the feedback signal). */
export type ReadingRecStatus =
  | "pending"
  | "queued"
  | "already_read"
  | "not_for_me"
  | "not_now";

/** One Claude-generated book suggestion for a member, plus their feedback on it. */
export type ReadingRecommendation = {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  total_pages: number | null;
  cover_image_url: string | null;
  isbn: string | null;
  /** Claude's one-line "why you'd like this". */
  rationale: string | null;
  status: ReadingRecStatus;
  /** For "not_now": the date this title may resurface. Null otherwise. */
  suppressed_until: string | null;
  acted_at: string | null;
  created_at: string;
  updated_at: string;
};

/** One "what page on what date" check-in, the basis for weekly progress. */
export type ReadingCheckin = {
  id: string;
  user_id: string;
  book_id: string;
  checked_on: string;
  page: number;
  created_at: string;
};

/** A book plus this week's derived progress for the reading home. */
/** The slice of a book's uploaded-content state the reading list needs. */
export type ReadingBookContentSummary = {
  status: ReadingBookContentStatus;
  page_count: number | null;
  has_real_pages: boolean;
  error_message: string | null;
};

/** A journal entry written about a book, shown on its card in the Reading list. */
export type ReadingBookJournalEntry = {
  id: string;
  title: string | null;
  pull_quote: string | null;
  entry_date: string;
};

export type ReadingBookWithProgress = ReadingBook & {
  /** Pages advanced since the start of the current week (Mon). */
  pagesReadThisWeek: number;
  /** Uploaded-file content state, or null when no file has been attached. */
  content: ReadingBookContentSummary | null;
  /** Whether the reader has a saved resume point (Continue vs. Read). */
  hasResumePoint: boolean;
  /** Closed journal entries linked to this book, newest first. */
  relatedEntries: ReadingBookJournalEntry[];
};

/** Everything the reading home renders for the signed-in member. */
export type ReadingHome = {
  books: ReadingBookWithProgress[];
  weeklyPageGoal: number;
  totalReadThisWeek: number;
  checkedInThisWeek: boolean;
};

/** Lifecycle of an uploaded book file as it converts into the reading experience. */
export type ReadingBookContentStatus =
  | "uploaded"
  | "processing"
  | "ready"
  | "failed";

/** Converted-content metadata for a book that has a file uploaded (1:1). */
export type ReadingBookContent = {
  book_id: string;
  user_id: string;
  source_format: "pdf" | "epub";
  source_path: string;
  /** Storage path to the reflowed content.html; null until status is "ready". */
  content_path: string | null;
  status: ReadingBookContentStatus;
  error_message: string | null;
  page_count: number | null;
  /** True when page numbers are real (PDF, or EPUB with a page-list). */
  has_real_pages: boolean;
  char_count: number | null;
  created_at: string;
  updated_at: string;
};

/** One chapter/section heading for the reader's table-of-contents navigation. */
export type ReadingTocEntry = {
  title: string;
  /** The heading's id in the reflowed HTML, to scroll to. */
  anchorId: string;
  /** 1 = major section (Part/Book), 2 = chapter/section. */
  level: number;
  /** Source page the heading falls on, when known. */
  page: number | null;
};

/** One source page mapped to its anchor and character range in the reflowed text. */
export type ReadingBookPage = {
  book_id: string;
  page_number: number;
  anchor_id: string;
  char_start: number;
  char_end: number | null;
};

/** Where a member last was in the reader. Separate from manual check-in progress. */
export type ReadingBookState = {
  book_id: string;
  user_id: string;
  last_anchor_id: string | null;
  last_scroll_ratio: number | null;
  last_page_number: number | null;
  last_read_at: string | null;
};

// ============================================================
// Reading comprehension quizzes
// ============================================================

export type ReadingQuizStatus = "draft" | "published" | "archived";
export type ReadingQuizQuestionType = "multiple_choice" | "free_text" | "essay";

/**
 * The three dimensions an essay is written and graded against, pitched to the
 * reader's age: comprehension of the reading, writing mechanics, and quality of
 * thinking. On a question these hold the rubric prose; on an answer (see
 * `EssayRubricScores`) they hold the grades.
 */
export type EssayRubric = {
  comprehension: string;
  mechanics: string;
  thinking: string;
};

/** One graded dimension: a 1–4 score (null = couldn't grade) plus a short note. */
export type EssayRubricScore = { score: number | null; note: string };

/** The graded breakdown stored on an essay answer row. */
export type EssayRubricScores = {
  comprehension: EssayRubricScore;
  mechanics: EssayRubricScore;
  thinking: EssayRubricScore;
};

/** A graded essay attempt's feedback, shown as a grade card on the results and
 * (during a revision) the writing page. */
export type ReadingEssayFeedback = {
  rubricScores: EssayRubricScores | null;
  aiNotes: string | null;
  /** True when the attempt met the standard. */
  passed: boolean;
  /** False when the AI grade didn't land. */
  gradingComplete: boolean;
};

/** A quiz scoped to a book's material from the start through `through_page`. */
export type ReadingQuiz = {
  id: string;
  /** The reader (kid) the quiz belongs to. */
  user_id: string;
  book_id: string;
  /** Start of the covered range. Null = from the very beginning (cumulative). */
  from_page: number | null;
  /** End of the covered range. */
  through_page: number;
  status: ReadingQuizStatus;
  title: string | null;
  /** Owner who generated it (audit), not the reader. */
  created_by_email: string;
  /** "manual" now; "checkin" once auto-generation lands. */
  source: "manual" | "checkin";
  /** Last generation failure, surfaced in the draft editor. */
  generation_error: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

/** One quiz question — multiple-choice or a free-text writing response. */
export type ReadingQuizQuestion = {
  id: string;
  quiz_id: string;
  user_id: string;
  position: number;
  type: ReadingQuizQuestionType;
  prompt: string;
  /** MC: ordered option strings. Null for free_text. */
  options: string[] | null;
  /** MC: index of the correct option. Null for free_text. */
  correct_index: number | null;
  /** MC: why the answer is correct. */
  explanation: string | null;
  /** free_text: what a correct answer must contain. */
  grading_rubric: string | null;
  /** free_text: a model answer, to ground the grader. */
  sample_answer: string | null;
  /** essay: the reading detail the opening must demonstrate (grader-facing). */
  anchor_summary: string | null;
  /** essay: the three-dimension rubric the grader scores against. */
  essay_rubric: EssayRubric | null;
  /** essay: the soft minimum word count, baked in at generation time. */
  min_words: number | null;
  created_at: string;
};

/** One of a kid's attempts at a quiz, with the derived score. */
export type ReadingQuizSubmission = {
  id: string;
  quiz_id: string;
  user_id: string;
  /** 1 for the first try, incrementing on each retake. */
  attempt_number: number;
  submitted_at: string;
  score_correct: number;
  score_total: number;
  /** False when an AI free-text grade failed, leaving an ungraded answer. */
  grading_complete: boolean;
  /** The parent's email when this is an override (closed without passing); else null. */
  closed_by_email: string | null;
  created_at: string;
};

/** A lightweight summary of one attempt, for showing retake history. */
export type ReadingQuizAttemptSummary = {
  id: string;
  attemptNumber: number;
  submittedAt: string;
  scoreCorrect: number;
  scoreTotal: number;
  gradingComplete: boolean;
};

/** The reading assignment after a passed quiz advances the book. */
export type ReadingQuizNextAssignment = {
  bookTitle: string;
  currentPage: number;
  targetPage: number | null;
  totalPages: number | null;
  finished: boolean;
};

/** One graded answer within a submission. */
export type ReadingQuizAnswer = {
  id: string;
  submission_id: string;
  question_id: string;
  user_id: string;
  /** MC: the chosen option index. Null for free_text. */
  selected_index: number | null;
  /** free_text: the kid's written response. Null for MC. */
  response_text: string | null;
  /** Null = ungraded (an AI grade failed). */
  is_correct: boolean | null;
  /** free_text/essay: the AI's note on why the answer was good/bad. */
  ai_notes: string | null;
  /** essay: the per-dimension rubric grades (comprehension/mechanics/thinking). */
  rubric_scores: EssayRubricScores | null;
  created_at: string;
};

/** A quiz with its ordered questions (owner draft view / taking flow). */
export type ReadingQuizWithQuestions = ReadingQuiz & {
  questions: ReadingQuizQuestion[];
};

/**
 * A graded attempt being viewed (the latest by default, or a chosen one), plus a
 * summary of every attempt so the reader and owner can see how many tries it took
 * and how each went.
 */
export type ReadingQuizResult = {
  quiz: ReadingQuiz;
  bookTitle: string;
  nextAssignment: ReadingQuizNextAssignment;
  questions: ReadingQuizQuestion[];
  /** The attempt whose answers are shown in detail. Null when not yet attempted. */
  submission: ReadingQuizSubmission | null;
  answersByQuestionId: Record<string, ReadingQuizAnswer>;
  /** Every attempt, oldest first. */
  attempts: ReadingQuizAttemptSummary[];
  /** True once any attempt got every question right. */
  passed: boolean;
};

/** The active quiz tied to a book's check-in: published and not yet passed. */
export type ActiveBookQuiz = {
  quizId: string;
  fromPage: number | null;
  throughPage: number;
  /** True once the kid has attempted it at least once (failed, not passed). */
  attempted: boolean;
  /** True during this week's Friday due window (Fri–Sun) — drives "Due now". */
  dueNow: boolean;
};

/** One attempt in the Parent Admin view of a quiz. */
export type ReadingAdminAttempt = {
  id: string;
  attemptNumber: number;
  submittedAt: string | null;
  scoreCorrect: number | null;
  scoreTotal: number | null;
  gradingComplete: boolean;
  /** True when this attempt is a parent override (closed without passing). */
  closedByParent: boolean;
};

/** One quiz (any status) in the Parent Admin view, with its attempts. */
export type ReadingAdminQuiz = {
  id: string;
  status: ReadingQuizStatus;
  fromPage: number | null;
  throughPage: number;
  createdAt: string;
  passed: boolean;
  closedByParent: boolean;
  attempts: ReadingAdminAttempt[];
};

/** One book in the Parent Admin view: assignment state + its quizzes. */
export type ReadingAdminBook = {
  bookId: string;
  title: string;
  author: string | null;
  currentPage: number;
  targetPage: number | null;
  targetDue: string | null;
  totalPages: number | null;
  status: string;
  /** The single live quiz (published, not yet passed), if any. */
  activeQuiz: ReadingAdminQuiz | null;
  /** A draft awaiting review/publish, if any. */
  draftQuiz: ReadingAdminQuiz | null;
  /** Passed and archived quizzes, newest first. */
  history: ReadingAdminQuiz[];
};

/** One kid's section in the Parent Admin view. */
export type ReadingAdminMember = {
  email: string;
  name: string | null;
  books: ReadingAdminBook[];
};
