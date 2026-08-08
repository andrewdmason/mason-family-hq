import { anthropic, JOURNAL_MODEL } from "@/lib/journal/anthropic";
import { lookupBookByTitle } from "@/lib/reading/book-lookup";

/** A book the member has an opinion on, used to describe their taste to the AI. */
export type RatedTitle = {
  title: string;
  author: string | null;
  /** The reader's age when they rated it, if known — for weighting taste drift. */
  ageAtRating: number | null;
  /** Whole years since they rated it, if known. */
  yearsAgo: number | null;
};

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
};

/** A fully-resolved suggestion, ready to insert as a pending recommendation. */
export type RecommendationCandidate = {
  title: string;
  author: string | null;
  totalPages: number | null;
  coverImageUrl: string | null;
  isbn: string | null;
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

function titleList(books: RatedTitle[]): string {
  return books
    .map((b) => `${b.author ? `${b.title} by ${b.author}` : b.title}${whenText(b)}`)
    .join("; ");
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
          "Two or three warm, specific, spoiler-free sentences explaining the " +
          "verdict, grounded in the books they've loved and disliked and their " +
          'age. Speak to the reader directly ("you").',
      },
    },
    required: ["verdict", "reason"],
  },
};

function buildAssessPrompt(
  profile: TasteProfile,
  book: { title: string; author: string | null }
): string {
  const parts = describeReader(profile);
  const label = book.author ? `"${book.title}" by ${book.author}` : `"${book.title}"`;
  parts.push(
    `Now assess one specific book: ${label}. Predict honestly whether THIS reader ` +
      `would enjoy it, weighed against the taste and age above. If it's a weak ` +
      `match, say so plainly and explain why. If you're unsure the book is real or ` +
      `which edition is meant, use your best judgment from the title. Call ` +
      `report_assessment exactly once.`
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
  book: { title: string; author: string | null }
): Promise<BookAssessment | null> {
  try {
    const client = anthropic();
    const message = await client.messages.create({
      model: JOURNAL_MODEL,
      max_tokens: 512,
      system:
        "You are a thoughtful librarian who honestly predicts whether a specific " +
        "reader will enjoy a given book, based on their reading history and age. " +
        "Be candid: if it's a weak fit, say so and explain why. Match their age " +
        "and taste, and never spoil the plot.",
      tools: [ASSESS_TOOL],
      tool_choice: { type: "tool", name: ASSESS_TOOL.name },
      messages: [{ role: "user", content: buildAssessPrompt(profile, book) }],
    });
    const toolUse = message.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;
    const input = toolUse.input as { verdict?: unknown; reason?: unknown };
    const verdict = typeof input.verdict === "string" ? input.verdict : "";
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!ASSESS_VERDICTS.has(verdict as BookAssessment["verdict"]) || !reason) {
      return null;
    }
    return { verdict: verdict as BookAssessment["verdict"], reason };
  } catch (err) {
    console.error(
      "[reading/recommend] assessment call failed:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
