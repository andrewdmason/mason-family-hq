/**
 * The reader's book taxonomy: one genre per book, from a fixed list.
 *
 * Not to be confused with `./genres.ts`, which is the age-appropriate menu the
 * recommender offers ("what should I read next?"). This is the shelf's own
 * classification of books you already have, and it has to be a closed set so the
 * archive filter is worth using.
 *
 * Fixed rather than free-form on purpose. The point of categorising is to make
 * the archive navigable, and a filter only earns its place when the buckets are
 * big enough to be worth a tap — free-text genre labels on a ~120-book library
 * produce eighty singletons and nothing to click. Every value below has at least
 * two books in the library it was drawn from.
 *
 * Fiction genres come first and the order is load-bearing: it's the order the
 * shelf groups and lists them in, so "group by genre" falls naturally into a
 * fiction half and a non-fiction half.
 *
 * `side` is display and ordering only — it is NOT the fiction signal. That lives
 * in `reading_books.fiction`, stored directly, because the chat prompts branch on
 * it and a mis-tagged genre must not quietly change how the agent talks about a
 * book. See 00177_reading_categories.sql.
 *
 * Keep in lockstep with the CHECK constraint in that migration.
 */

export type ReadingGenre =
  | "literary_fiction"
  | "science_fiction"
  | "fantasy"
  | "mystery_thriller"
  | "horror"
  | "classics"
  | "short_stories"
  | "middle_grade_ya"
  | "psychology_self"
  | "spirituality_religion"
  | "philosophy"
  | "science"
  | "history_politics"
  | "business_leadership"
  | "biography_memoir"
  | "arts_music"
  | "health_mortality";

/** Which half of the shelf a genre sits in. Display only — see `fiction`. */
export type ReadingGenreSide = "fiction" | "nonfiction";

export type ReadingGenreOption = {
  value: ReadingGenre;
  label: string;
  side: ReadingGenreSide;
  /** What the genre covers, shown to the classifier so it picks consistently. */
  hint: string;
};

/** Every genre, in shelf order: fiction first, then non-fiction. */
export const READING_GENRES: ReadingGenreOption[] = [
  {
    value: "literary_fiction",
    label: "Literary fiction",
    side: "fiction",
    hint: "Character-driven or stylistically serious novels — the default for contemporary fiction that isn't clearly genre.",
  },
  {
    value: "science_fiction",
    label: "Science fiction",
    side: "fiction",
    hint: "Speculative futures, space, technology, alternate physics.",
  },
  {
    value: "fantasy",
    label: "Fantasy",
    side: "fiction",
    hint: "Magic, invented worlds, myth retold as story.",
  },
  {
    value: "mystery_thriller",
    label: "Mystery & thriller",
    side: "fiction",
    hint: "Crime, detection, espionage, suspense.",
  },
  {
    value: "horror",
    label: "Horror",
    side: "fiction",
    hint: "Fiction whose primary aim is dread — gothic, weird, supernatural.",
  },
  {
    value: "classics",
    label: "Classics",
    side: "fiction",
    hint: "Pre-20th-century fiction and long-canonised novels, where the period matters more than the genre.",
  },
  {
    value: "short_stories",
    label: "Short stories",
    side: "fiction",
    hint: "Collections of short fiction. Prefer this over the subject genre when the book is a collection.",
  },
  {
    value: "middle_grade_ya",
    label: "Middle grade & YA",
    side: "fiction",
    hint: "Fiction written for children or teenagers. Prefer this over the subject genre when the intended reader is young.",
  },
  {
    value: "psychology_self",
    label: "Psychology & self",
    side: "nonfiction",
    hint: "Mind, personality, therapy, Jungian and depth psychology, personal development.",
  },
  {
    value: "spirituality_religion",
    label: "Spirituality & religion",
    side: "nonfiction",
    hint: "Meditation and contemplative practice, Buddhism, religious history and thought, myth as belief.",
  },
  {
    value: "philosophy",
    label: "Philosophy",
    side: "nonfiction",
    hint: "Argument about how to think or how to live, including the Stoics and modern essays of ideas.",
  },
  {
    value: "science",
    label: "Science",
    side: "nonfiction",
    hint: "Popular science, cognition and behavioural economics, medicine as science, mathematics, nature.",
  },
  {
    value: "history_politics",
    label: "History & politics",
    side: "nonfiction",
    hint: "The past, economics, society, current affairs, reportage.",
  },
  {
    value: "business_leadership",
    label: "Business & leadership",
    side: "nonfiction",
    hint: "Management, strategy, startups, teams, hiring, organisational practice.",
  },
  {
    value: "biography_memoir",
    label: "Biography & memoir",
    side: "nonfiction",
    hint: "One life told — by its subject or by someone else. Use this for autofiction too, where a life is told as a novel.",
  },
  {
    value: "arts_music",
    label: "Arts & music",
    side: "nonfiction",
    hint: "Music, film, visual art and craft: how the work is made and how to hear or see it.",
  },
  {
    value: "health_mortality",
    label: "Health & mortality",
    side: "nonfiction",
    hint: "Dying, grief, illness, ageing, the body — books that take death or health as their subject.",
  },
];

const BY_VALUE = new Map(READING_GENRES.map((g) => [g.value, g]));

/** All genre slugs, in shelf order. */
export const READING_GENRE_VALUES: ReadingGenre[] = READING_GENRES.map(
  (g) => g.value
);

/** True when a string is one of the taxonomy's slugs. */
export function isReadingGenre(value: unknown): value is ReadingGenre {
  return typeof value === "string" && BY_VALUE.has(value as ReadingGenre);
}

/** The display label for a genre, or a stand-in when it has none. */
export function genreLabel(genre: ReadingGenre | string | null): string {
  if (!genre) return "Uncategorized";
  return BY_VALUE.get(genre as ReadingGenre)?.label ?? genre;
}

/** Which half of the shelf a genre belongs to, or null if unknown. */
export function genreSide(
  genre: ReadingGenre | string | null
): ReadingGenreSide | null {
  if (!genre) return null;
  return BY_VALUE.get(genre as ReadingGenre)?.side ?? null;
}

/** Position in shelf order, for sorting groups. Unknown genres sort last. */
export function genreOrder(genre: ReadingGenre | string | null): number {
  const index = READING_GENRE_VALUES.indexOf(genre as ReadingGenre);
  return index === -1 ? READING_GENRE_VALUES.length : index;
}
