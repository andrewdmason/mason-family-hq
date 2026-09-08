import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import { genreLabel } from "@/lib/reading/book-genres";
import { lookupBookByTitle } from "@/lib/reading/book-lookup";

/** A book the member has an opinion on, used to describe their taste to the AI. */
export type RatedTitle = {
  title: string;
  author: string | null;
  /** The reader's age when they rated it, if known — for weighting taste drift. */
  ageAtRating: number | null;
  /** Whole years since they rated it, if known. */
  yearsAgo: number | null;
  /** Fiction or not, from the shelf. Null when the book was never classified. */
  fiction: boolean | null;
  /** The shelf's genre slug, when classified. Drives which books count as peers. */
  genre: string | null;
};

/**
 * How much the reader has actually read in each category — the denominator
 * behind every prediction.
 *
 * Counted from books they finished or rated, never from books merely added: a
 * shelf can hold a hundred imported titles nobody has opened, and reading
 * "added but unfinished" as a negative would turn an unread library into
 * evidence of dislike. The gap between what someone owns and what they've read
 * says nothing about taste.
 */
export type CategoryEvidence = {
  /** Books read on each side of the fiction line. */
  fiction: number;
  nonfiction: number;
  /** Genre slug → books read in it. Only genres with at least one. */
  byGenre: Record<string, number>;
};

/** A genre with enough read books behind it to compare against on its own. */
const GENRE_EVIDENCE_FLOOR = 5;

/** Whether a genre has enough behind it that a same-genre verdict is earned. */
export function genreIsWellEvidenced(
  evidence: CategoryEvidence,
  genre: string | null
): boolean {
  if (!genre) return false;
  return (evidence.byGenre[genre] ?? 0) >= GENRE_EVIDENCE_FLOOR;
}

/**
 * Everything the engine needs to suggest fresh books for one member. Assembled
 * by the Discover action from their ratings + prior recommendation feedback.
 */
export type TasteProfile = {
  /** The member's age in years, when their birthdate is known. Drives age-fit. */
  age: number | null;
  /** Books they rated ❤️ — lean hard toward these. */
  loved: RatedTitle[];
  /** Books they rated 👍 — lean toward these. */
  liked: RatedTitle[];
  /** Books they rated 👎 — avoid these and their themes/genre/author. */
  disliked: RatedTitle[];
  /** Books they started but abandoned — a soft negative (didn't hold them). */
  didNotFinish: RatedTitle[];
  /** Titles never to suggest (already tracked, already rated, or already shown). */
  exclude: string[];
  /** How many books they've actually read in each category. */
  evidence: CategoryEvidence;
};

/** A fully-resolved suggestion, ready to insert as a pending recommendation. */
export type RecommendationCandidate = {
  title: string;
  author: string | null;
  totalPages: number | null;
  coverImageUrl: string | null;
  isbn: string | null;
  /** First publication year, when the lookup resolved one. */
  publishedYear: number | null;
  /** The AI's one-line reason this fits the member's taste. */
  rationale: string | null;
};

const RECOMMEND_TOOL = {
  name: "report_recommendations",
  description:
    "Report a list of book recommendations tailored to this reader's taste.",
  input_schema: {
    type: "object" as const,
    properties: {
      recommendations: {
        type: "array",
        description:
          "Distinct books to recommend, best fit first. Do not include any book " +
          "the reader has already read, rated, or been shown.",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "The book's title." },
            author: { type: "string", description: "The primary author." },
            reason: {
              type: "string",
              description:
                "One warm, specific sentence on why this reader would like it, " +
                "grounded in the books they've loved. Spoiler-free.",
            },
          },
          required: ["title", "reason"],
        },
      },
    },
    required: ["recommendations"],
  },
};

type RawRec = { title?: unknown; author?: unknown; reason?: unknown };

function whenText(b: RatedTitle): string {
  const bits: string[] = [];
  if (b.ageAtRating != null) bits.push(`at age ${b.ageAtRating}`);
  if (b.yearsAgo != null) {
    bits.push(
      b.yearsAgo <= 0
        ? "recently"
        : b.yearsAgo === 1
          ? "~1 year ago"
          : `~${b.yearsAgo} years ago`
    );
  }
  return bits.length ? ` (${bits.join(", ")})` : "";
}

/**
 * How a book is named to the model: title, author, category, and when it was
 * rated. The category tag is what makes peer-set weighting possible at all —
 * without it every book on the shelf reads as interchangeable, and a work of
 * criticism gets judged against novels.
 */
function titleList(books: RatedTitle[]): string {
  return books
    .map(
      (b) =>
        `${b.author ? `${b.title} by ${b.author}` : b.title}` +
        `${categoryTag(b.fiction, b.genre)}${whenText(b)}`
    )
    .join("; ");
}

/** " [Literary fiction]" / " [non-fiction]" / "" — as much as the shelf knows. */
function categoryTag(fiction: boolean | null, genre: string | null): string {
  if (genre) return ` [${genreLabel(genre)}]`;
  if (fiction === true) return " [fiction]";
  if (fiction === false) return " [non-fiction]";
  return "";
}

/**
 * The reader's evidence base, stated plainly so the model can calibrate rather
 * than infer confidence from the length of a list.
 */
function describeEvidence(evidence: CategoryEvidence): string {
  const genres = Object.entries(evidence.byGenre)
    .sort((a, b) => b[1] - a[1])
    .map(([genre, n]) => `${genreLabel(genre)} ${n}`)
    .join(", ");
  const parts = [
    `How much you actually have to go on: ${evidence.fiction} fiction and ` +
      `${evidence.nonfiction} non-fiction books read.`,
  ];
  if (genres) parts.push(`By genre: ${genres}.`);
  parts.push(
    `These counts are books the reader FINISHED or rated — not books sitting ` +
      `on the shelf. Unrated, unstarted books are an unread library (imported ` +
      `or bought, never opened) and are NOT evidence of dislike or abandonment. ` +
      `Never argue from a book's absence from these lists.`
  );
  return parts.join(" ");
}

/** Pull the ISBN back out of an Open Library cover URL, if present. */
function isbnFromCoverUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/isbn\/([0-9Xx]+)-/);
  return match ? match[1] : null;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

/**
 * The reader-taste portion of a prompt: their age (and how hard to weight taste
 * drift by it), then the books they've loved / liked / disliked / abandoned, or a
 * cold-start note when there's no signal yet. Shared by the batch recommender and
 * the single-book "will I like this?" assessment so both read taste the same way.
 */
function describeReader(profile: TasteProfile): string[] {
  const parts: string[] = [];
  if (profile.age != null) {
    parts.push(
      `The reader is ${profile.age} years old — a great book for them is one that's ` +
        `age-appropriate in content and reading level.`
    );
    // Each rating below is annotated with the reader's age then and how long ago
    // it was — weight that by how fast their taste is likely still changing.
    if (profile.age < 14) {
      parts.push(
        `Their taste is changing quickly as they grow. Weight their most RECENT ` +
          `ratings far more heavily, and treat books they rated a few years ago ` +
          `(especially at a younger age) as nostalgic context rather than a strong ` +
          `signal — they've likely moved on. Favor their current reading level and ` +
          `recent interests.`
      );
    } else if (profile.age < 18) {
      parts.push(
        `Their taste is still maturing. Lean toward their more recent ratings, but ` +
          `older favorites still carry meaningful weight.`
      );
    } else {
      parts.push(
        `Their taste is well-established — weight their ratings regardless of how ` +
          `long ago each was given.`
      );
    }
  }
  if (profile.loved.length) {
    parts.push(`Books they LOVED: ${titleList(profile.loved)}.`);
  }
  if (profile.liked.length) {
    parts.push(`Books they liked: ${titleList(profile.liked)}.`);
  }
  if (profile.disliked.length) {
    parts.push(
      `Books they DISLIKED — steer away from these and similar themes/genres/authors: ` +
        `${titleList(profile.disliked)}.`
    );
  }
  if (profile.didNotFinish.length) {
    parts.push(
      `Books they started but did NOT finish — these failed to hold them, so lean ` +
        `away from similar pacing/style (a softer signal than an outright dislike): ` +
        `${titleList(profile.didNotFinish)}.`
    );
  }
  if (!profile.loved.length && !profile.liked.length) {
    parts.push(
      `They're new and we don't know their taste yet — treat widely-loved, ` +
        `accessible books as the safest bet.`
    );
  }
  parts.push(describeEvidence(profile.evidence));
  return parts;
}

function buildPrompt(
  profile: TasteProfile,
  count: number,
  focus: { genre?: string | null; request?: string | null }
): string {
  const parts: string[] = [];
  if (focus.genre) {
    let line = `Focus this batch on the ${focus.genre} genre.`;
    // For kids, "Classics" means the age-appropriate canon, not adult literature.
    if (/classic/i.test(focus.genre) && profile.age != null && profile.age < 18) {
      line +=
        ` For a ${profile.age}-year-old, that means the most celebrated, enduring, ` +
        `age-appropriate "hall of fame" books — timeless favorites and award winners ` +
        `at their reading level (think the children's/middle-grade canon), NOT adult ` +
        `literary classics.`;
    }
    parts.push(line);
  }
  if (focus.request) {
    // The reader's own free-text ask — treat as a hard filter on this batch.
    parts.push(
      `The reader described what they want right now — treat this as a strong ` +
        `requirement for every pick in this batch (while still honoring their age ` +
        `and taste): "${focus.request}"`
    );
  }
  parts.push(...describeReader(profile));
  if (profile.exclude.length) {
    parts.push(
      `Do NOT recommend any of these (already read, rated, or shown): ` +
        `${profile.exclude.join("; ")}.`
    );
  }
  parts.push(
    `Recommend ${count} distinct real, published books. Vary authors. Call ` +
      `report_recommendations exactly once.`
  );
  return parts.join("\n\n");
}

/**
 * Ask the AI for a batch of book recommendations tailored to a member's taste,
 * then resolve each through the existing title-lookup so every suggestion lands
 * with a real cover, author, and page count. Resilient: any failure resolves to
 * an empty list rather than throwing. Over-asks (the caller wants ~5) so dedupe
 * and lookup misses still leave a full batch.
 */
export async function generateRecommendationCandidates(
  profile: TasteProfile,
  focus: { genre?: string | null; request?: string | null } = {},
  count = 8
): Promise<RecommendationCandidate[]> {
  let raw: RawRec[] = [];
  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 1024,
      system:
        "You are a thoughtful librarian who recommends books a specific reader " +
        "will love, based on their reading history. Be honest and specific, " +
        "match the reader's age and taste, and never recommend a book they've " +
        "already read or rejected.",
      tools: [RECOMMEND_TOOL],
      tool_choice: { type: "tool", name: RECOMMEND_TOOL.name },
      messages: [{ role: "user", content: buildPrompt(profile, count, focus) }],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return [];
    const input = toolUse.input as { recommendations?: unknown };
    if (Array.isArray(input.recommendations)) {
      raw = input.recommendations as RawRec[];
    }
  } catch (err) {
    console.error(
      "[reading/recommend] Anthropic call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }

  // Keep only well-formed, in-batch-unique titles that aren't on the exclude list.
  const excluded = new Set(profile.exclude.map(normalizeTitle));
  const seen = new Set<string>();
  const picks: { title: string; author: string | null; reason: string | null }[] = [];
  for (const r of raw) {
    const title = typeof r.title === "string" ? r.title.trim() : "";
    if (!title) continue;
    const key = normalizeTitle(title);
    if (excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    picks.push({
      title,
      author: typeof r.author === "string" && r.author.trim() ? r.author.trim() : null,
      reason: typeof r.reason === "string" && r.reason.trim() ? r.reason.trim() : null,
    });
  }

  // Resolve each to canonical metadata + a cover via the existing lookup path.
  const resolved = await Promise.all(
    picks.map(async (pick): Promise<RecommendationCandidate> => {
      const found = await lookupBookByTitle(pick.title);
      const coverImageUrl = found.coverImageUrl;
      return {
        title: found.title || pick.title,
        author: found.author ?? pick.author,
        totalPages: found.totalPages,
        coverImageUrl,
        isbn: isbnFromCoverUrl(coverImageUrl),
        publishedYear: found.publishedYear,
        rationale: pick.reason,
      };
    })
  );

  return resolved;
}

/** The AI's honest read on how well one specific book fits a reader's taste. */
export type BookAssessment = {
  /**
   * "love" = right up their alley, "like" = a good fit, "mixed" = could go
   * either way, "pass" = probably not for them.
   */
  verdict: "love" | "like" | "mixed" | "pass";
  /** A couple of warm, spoiler-free sentences explaining the verdict. */
  reason: string;
  /**
   * Which books the verdict was actually weighed against ("your literary
   * fiction", "your non-fiction, which is thin").
   *
   * Shown under the verdict because a prediction is only as good as its peer
   * set, and the reader is the one person who can tell at a glance that the
   * wrong shelf was consulted. Naming it turns an unfalsifiable verdict into
   * one you can discount.
   */
  basis: string | null;
};

const ASSESS_VERDICTS = new Set<BookAssessment["verdict"]>([
  "love",
  "like",
  "mixed",
  "pass",
]);

/**
 * How each verdict is said out loud. Shared by the tinted panel and by the note
 * the queue writes, so a book's row and its assessment never phrase the same
 * verdict two different ways.
 */
export const ASSESSMENT_LABELS: Record<BookAssessment["verdict"], string> = {
  love: "You'll probably love this",
  like: "Looks like a good fit for you",
  mixed: "Could go either way",
  pass: "Probably not your thing",
};

/**
 * An assessment as one paragraph, for the queue's "why this book" line.
 *
 * The panel carries its verdict in a colour and a label above the reasoning; a
 * note is just text, so the verdict has to lead the sentence or it's lost — and
 * a "pass" quietly filed as a rationale would read like an argument *for* the
 * book, which is the opposite of the point.
 */
export function assessmentNote(assessment: BookAssessment): string {
  return `${ASSESSMENT_LABELS[assessment.verdict]} — ${assessment.reason}`;
}

const ASSESS_TOOL = {
  name: "report_assessment",
  description:
    "Report an honest prediction of whether this reader will enjoy one specific book.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: {
        type: "string",
        enum: ["love", "like", "mixed", "pass"],
        description:
          'Your honest read on the fit: "love" = right up their alley, ' +
          '"like" = a good fit, "mixed" = could go either way, ' +
          '"pass" = probably not for them.',
      },
      reason: {
        type: "string",
        description:
          "TWO sentences. Three is the absolute maximum and only when the " +
          "third earns its place; never four. Under 400 characters. This sits " +
          "above the Add button in a dialog, so it has to be readable at a " +
          "glance — a paragraph gets skipped and the feature wasted. Name one " +
          "specific book of theirs as the comparison, and end on the condition " +
          'under which the answer flips ("worth it if you want X; skip it if ' +
          'you want Y"). Warm, spoiler-free, addressed to the reader as "you". ' +
          "Do not summarise the book — they can read the blurb. Tell them " +
          "something about the FIT they don't already know.",
      },
      basis: {
        type: "string",
        description:
          "At most eight words naming the books you actually weighed this " +
          'against, shown as a caption under the verdict — e.g. "compared ' +
          'with your literary fiction" or "your non-fiction only; no ' +
          'philosophy read". It is a label, not a sentence: no explanation, ' +
          "no counts spelled out. Say plainly when the peer set is thin; do " +
          "not dress up a guess.",
      },
    },
    required: ["verdict", "reason", "basis"],
  },
};

/**
 * How the model is told to pick its comparisons.
 *
 * The rule that matters is the last one. Down-weighting distant books isn't
 * enough on its own: a novel dragged into a verdict on an essay still produces
 * "not as moving as X", just more quietly. So what crosses the fiction line is
 * restricted by KIND, not only by weight — craft judgements travel between a
 * novel and an essay, judgements about form do not. Faulting a book of ideas
 * for lacking emotional resonance is the failure this exists to prevent.
 */
function peerSetRules(
  candidate: { fiction: boolean | null; genre: string | null },
  evidence: CategoryEvidence
): string[] {
  const parts: string[] = [];
  const sameGenre = candidate.genre
    ? (evidence.byGenre[candidate.genre] ?? 0)
    : 0;
  const sameSide =
    candidate.fiction === true
      ? evidence.fiction
      : candidate.fiction === false
        ? evidence.nonfiction
        : 0;

  parts.push(
    `WEIGH THE EVIDENCE BY HOW CLOSE IT IS:\n` +
      `1. Books in the SAME genre carry the most weight, and may speak to ` +
      `anything — subject, form, feel, pacing, depth.\n` +
      `2. Books on the same side of the fiction/non-fiction line carry less ` +
      `weight, but are still broadly relevant.\n` +
      `3. Books on the OTHER side of that line carry the least weight, AND are ` +
      `admissible only on craft: prose quality, tolerance for density and ` +
      `difficulty, appetite for length, patience with ambiguity, taste for ` +
      `writing that refuses tidy conclusions.\n` +
      `NEVER carry these across the fiction line: emotional resonance, ` +
      `character, plot, pacing, what counts as "thin" or "slight", or pull ` +
      `toward a subject. Judging a work of non-fiction for not moving the ` +
      `reader like their favourite novels is a category error, not a finding.`
  );

  if (candidate.fiction === false) {
    parts.push(
      `This is non-fiction, so ask the non-fiction question: does its SUBJECT ` +
        `pull them, and is the argument worth the pages? Do not ask whether it ` +
        `will move them the way a novel does. Brevity and a light touch are ` +
        `often virtues in non-fiction; treat "breezy" as a strike only if their ` +
        `own non-fiction history says it is.`
    );
  } else if (candidate.fiction === true) {
    parts.push(
      `This is fiction, so ask the fiction question: will it hold them, and ` +
        `will it land? Subject matter matters far less here than voice, ` +
        `character and how it's written.`
    );
  }

  const wellEvidenced = genreIsWellEvidenced(evidence, candidate.genre);
  parts.push(
    `CALIBRATE YOUR CONFIDENCE to the evidence that actually exists. You have ` +
      `${sameGenre} book(s) read in this exact genre and ${sameSide} on this ` +
      `side of the fiction line. ` +
      (wellEvidenced
        ? `That's a real same-genre history — lean on it, and name the ` +
          `specific books you're comparing against.`
        : `That is NOT enough for a same-genre verdict. Fall back to the ` +
          `broader comparison, and say in your basis that the genre evidence ` +
          `is thin — do not present a coarse comparison as a precise one.`) +
      ` A firm verdict off two or three books is worse than an honest hedge — ` +
      `but do not hedge to be safe either. "Could go either way" is for ` +
      `genuinely thin or genuinely split evidence, NOT a default when you can ` +
      `see a real answer. If the honest read is "no", give a "pass" and say ` +
      `why; a weak match stated clearly is the most useful thing you can return.`
  );
  return parts;
}

/** Exported for the verification script, which asserts the peer-set rules. */
export function buildAssessPrompt(
  profile: TasteProfile,
  book: { title: string; author: string | null; fiction: boolean | null; genre: string | null }
): string {
  const parts = describeReader(profile);
  const label = book.author ? `"${book.title}" by ${book.author}` : `"${book.title}"`;
  const side =
    book.fiction === true
      ? "fiction"
      : book.fiction === false
        ? "non-fiction"
        : "uncertain which side of the fiction line";
  parts.push(
    `Now assess one specific book: ${label}. The shelf classifies it as ` +
      `${book.genre ? `${genreLabel(book.genre)} (${side})` : side}.`
  );
  parts.push(...peerSetRules(book, profile.evidence));
  parts.push(
    `Predict honestly whether THIS reader would enjoy it. If you're unsure the ` +
      `book is real or which edition is meant, use your best judgment from the ` +
      `title. Call report_assessment exactly once.`
  );
  return parts.join("\n\n");
}

/**
 * Predict whether a reader will enjoy one specific book, using the same taste
 * profile that drives the recommender. Honest by design — a poor fit returns a
 * "pass" with the reason. Resilient: any failure resolves to null rather than
 * throwing, so the UI can just show "couldn't get a read on that one."
 */
export async function assessBookFit(
  profile: TasteProfile,
  book: {
    title: string;
    author: string | null;
    /** The candidate's own category — without it there is no peer set to pick. */
    fiction?: boolean | null;
    genre?: string | null;
  }
): Promise<BookAssessment | null> {
  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 512,
      system:
        "You are a thoughtful librarian who honestly predicts whether a specific " +
        "reader will enjoy a given book, based on their reading history and age. " +
        "Be candid: if it's a weak fit, say so and explain why. Compare like " +
        "with like — a book is judged against the reader's history in its own " +
        "kind first. Match their age and taste, and never spoil the plot.",
      tools: [ASSESS_TOOL],
      tool_choice: { type: "tool", name: ASSESS_TOOL.name },
      messages: [
        {
          role: "user",
          content: buildAssessPrompt(profile, {
            title: book.title,
            author: book.author,
            fiction: book.fiction ?? null,
            genre: book.genre ?? null,
          }),
        },
      ],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;
    const input = toolUse.input as {
      verdict?: unknown;
      reason?: unknown;
      basis?: unknown;
    };
    const verdict = typeof input.verdict === "string" ? input.verdict : "";
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!ASSESS_VERDICTS.has(verdict as BookAssessment["verdict"]) || !reason) {
      return null;
    }
    return {
      verdict: verdict as BookAssessment["verdict"],
      reason,
      basis: typeof input.basis === "string" && input.basis.trim()
        ? input.basis.trim()
        : null,
    };
  } catch (err) {
    console.error(
      "[reading/recommend] assessment call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
