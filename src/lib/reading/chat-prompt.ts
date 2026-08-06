import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { ChapterIndexEntry } from "@/lib/reading/context-markup";

/**
 * The ONE place the reader's system prompts are assembled — the anchored chat,
 * and the chapter recap below it.
 *
 * Kept together deliberately: a kid-appropriate variant will need to behave very
 * differently (an AI that will summarize a chapter on demand is a cheat engine
 * for the reading quizzes, which pay out Mason Bucks — and the recap makes that
 * a tap rather than a question someone has to think to ask). When that lands it
 * should be a branch in each of these, not a second prompt scattered elsewhere.
 */

/** Fast: snappy, 200K context. */
export const READER_CHAT_FAST_MODEL = "claude-haiku-4-5";
/** Deep: stronger, 1M context — the fallback when a book won't fit Fast. */
export const READER_CHAT_DEEP_MODEL = "claude-sonnet-5";

/**
 * Haiku 4.5's context window. Every other current model is 1M, which is why a
 * long novel has to be promoted rather than truncated.
 */
export const FAST_MODEL_CONTEXT_WINDOW = 200_000;

/** Headroom for the reply and count-vs-send drift before we promote. */
export const FAST_MODEL_HEADROOM = 8_000;

export const READER_CHAT_MAX_TOKENS = 1024;

/**
 * Char cap on the book text. Not the real gate — token counting is — just a
 * backstop so a pathological book can't build a multi-megabyte request.
 */
export const READER_CHAT_MAX_CONTEXT_CHARS = 3_000_000;

/**
 * A recap is read once and remembered, so it is always written by the stronger
 * model — unlike a chat turn, which is one of many and can simply be asked
 * again. The reader never chooses this; the picker in the panel governs the
 * follow-up questions.
 */
export const CHAPTER_SUMMARY_MODEL = READER_CHAT_DEEP_MODEL;

/** A few sentences of prose, with room to overrun rather than stop mid-word. */
export const CHAPTER_SUMMARY_MAX_TOKENS = 700;

export type ChapterSummaryPromptInput = {
  bookTitle: string;
  bookAuthor: string | null;
  /** The heading, exactly as the contents lists it. */
  chapterTitle: string;
  /** That chapter's text, and no other chapter's — see getChapterText. */
  chapterText: string;
  /** Whether the middle of the chapter was elided to fit. */
  truncated: boolean;
};

/**
 * The recap of a single chapter.
 *
 * The whole design of this prompt is the sentence about scope. The model is
 * given one chapter and told that is all there is, because a summary that
 * reaches for the rest of the book — or for what the model happens to know about
 * a famous novel — is exactly the thing a reader tapping a chapter title does
 * not want: they asked what they just read, not what it turns out to mean.
 *
 * No cache breakpoint, unlike the chat prompt. A chapter is summarized once and
 * regenerated rarely, so the write premium would be paid on nearly every call
 * and read back on almost none.
 */
export function buildChapterSummarySystem(
  input: ChapterSummaryPromptInput
): Anthropic.TextBlockParam[] {
  const rules: string[] = [
    "You are a reading companion inside a family reading app. The reader has " +
      "tapped a chapter's title and asked for a recap of that chapter.",
    "The text below is that ONE chapter, and it is everything you have. " +
      "Summarize it from the text itself — never from what you recall of this " +
      "work, its author, its adaptations, or its reputation. If something in " +
      "the chapter only resolves elsewhere in the book, say what this chapter " +
      "says about it and stop there rather than completing the thought.",
    "Write four to six sentences of flowing prose — the way a reader would " +
      "recap it to themselves before picking the book back up. No heading, no " +
      "bullet list, no preamble: open with what happens. Name people and " +
      "places the way the chapter names them.",
    "If the chapter argues rather than narrates, summarize the argument and " +
      "what it rests on instead of the events.",
  ];

  if (input.truncated) {
    rules.push(
      "The chapter was too long to send whole, so a stretch of its middle has " +
        "been elided and marked as such. Recap what you were given and say in " +
        "one clause that the middle is missing."
    );
  }

  const author = input.bookAuthor ? ` author="${input.bookAuthor}"` : "";
  return [
    { type: "text", text: rules.join("\n\n") },
    {
      type: "text",
      text:
        `<book title="${input.bookTitle}"${author}>\n` +
        `<chapter title="${input.chapterTitle}">\n${input.chapterText}\n</chapter>\n` +
        `</book>`,
    },
  ];
}

export type ReaderChatPromptInput = {
  bookTitle: string;
  bookAuthor: string | null;
  /** The (possibly page-marked) book text this chat is allowed to see. */
  bookText: string;
  /** Whether bookText carries "[p.N]" markers to cite. */
  hasPageMarkers: boolean;
  /** Whether bookText marks chapter starts with a "## " heading line. */
  hasChapterMarkers: boolean;
  /**
   * The book's headings, in order, exactly as they appear in bookText, each with
   * the pages it spans. Rendered as a <contents> index ahead of the text: without
   * it the model has to find a chapter by scanning a quarter-million tokens of
   * undifferentiated prose, which is how "summarize chapter 21" turns into "I
   * can't find chapter 21" — and without the page ranges it finds the start but
   * not the end, and reports the chapter over at the first scene break that reads
   * like one. Spoiler-scoped chats get only the chapters inside their boundary.
   */
  chapters: ChapterIndexEntry[];
  /** True when this chat is spoiler-scoped. */
  spoilerFree: boolean;
  /** The page the scope ends at, when known. */
  contextThroughPage: number | null;
  /** Selection-initiated chats: the passage the reader highlighted. */
  quotedText: string | null;
  /** Fork: the parent chat's transcript, carried forward as context. */
  priorTranscript: { role: "user" | "assistant"; content: string }[] | null;
  parentAnchorPage: number | null;
};

/**
 * One <contents> line per chapter: the heading verbatim, then the pages it
 * covers, in the same "[p.N]" vocabulary the text is marked up with — so a
 * chapter's last page is something the model can look up and then navigate to,
 * rather than something it has to infer by reading to the next heading.
 */
function contentsLine(chapter: ChapterIndexEntry): string {
  if (chapter.fromPage == null || chapter.throughPage == null) return chapter.title;
  return `${chapter.title} — [p.${chapter.fromPage}] through [p.${chapter.throughPage}]`;
}

/** Whether the index actually carries extents (it can't without a page map). */
function hasChapterExtents(chapters: ChapterIndexEntry[]): boolean {
  return chapters.some((c) => c.fromPage != null && c.throughPage != null);
}

/**
 * Returns the system blocks. Order matters for prompt caching: everything up to
 * and including the cache breakpoint must be byte-stable for a given
 * (book, boundary, model), so the whole book bills at ~0.1x on every turn after
 * the first. Nothing volatile — no dates, no names — may appear before it.
 */
export function buildReaderChatSystem(
  input: ReaderChatPromptInput
): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [];

  const rules: string[] = [
    "You are a reading companion inside a family reading app. The reader is " +
      "partway through a book and has opened a conversation anchored to a " +
      "specific spot in the text.",
    "Ground every answer in the book text provided below. If the text doesn't " +
      "settle a question, say so rather than speculating from outside knowledge.",
    "Be concise and conversational. This is marginalia — a remark in the margin, " +
      "not an essay. Match their register; a short question deserves a short answer.",
  ];

  if (input.hasPageMarkers) {
    rules.push(
      "The book text contains page markers like [p.212]. When you point at " +
        "something in the text, cite the nearest preceding marker in exactly " +
        "that bracketed form. Only cite markers that actually appear in the " +
        "text you were given. Do not write page numbers in prose (never " +
        '"on page 212") — use the [p.212] form alone, since the app turns it ' +
        "into a link and displays it in the reader's own terms."
    );
  }

  if (input.hasChapterMarkers) {
    rules.push(
      "Chapter and section starts in the book text are marked as Markdown " +
        'headings ("## Chapter 21"). A chapter is everything from its heading ' +
        "down to the next one. When the reader names a chapter, locate that " +
        "heading in the text and answer from the text between it and the " +
        "following heading — never from what you recall of this work. If they " +
        "name a chapter and you cannot find its heading, say which headings you " +
        "do see near where they mean rather than asking them to describe the " +
        "passage back to you." +
        (input.chapters.length > 0
          ? " The <contents> list ahead of the text is every heading in it, in " +
            "order, written exactly as it appears there."
          : "")
    );

    if (hasChapterExtents(input.chapters)) {
      rules.push(
        "Each <contents> entry also gives the pages that chapter runs through. " +
          "Treat that range as authoritative about where the chapter ends, " +
          "because a chapter routinely contains scene breaks, partings and " +
          "closing-sounding beats well before its last page. When you summarize " +
          "a chapter, cover it to the end of its stated range — check what is on " +
          "its final pages before you write, and never describe a chapter as " +
          "ending anywhere but there. Asked how a chapter ends or for its last " +
          "words, read to the very end of its range and quote from there."
      );
    }
  }

  if (input.spoilerFree) {
    const limit =
      input.contextThroughPage != null
        ? `page ${input.contextThroughPage}`
        : "the point they have reached";
    rules.push(
      `SPOILERS: the reader has read up to ${limit}, and the text above ends ` +
        "there. Never reveal, hint at, or foreshadow anything beyond that " +
        "point — not from the text, and not from your own knowledge of this " +
        "work, its author, its adaptations, or its reputation. Do not tell " +
        "them a question will be answered later, or that a detail becomes " +
        "important, or that a character is not what they seem: knowing there " +
        "is something to notice is itself a spoiler. If they ask directly " +
        "about later events, tell them plainly that you'll stay inside what " +
        "they've read, and offer to pick it up when they get there."
    );
  }

  blocks.push({ type: "text", text: rules.join("\n\n") });

  // The big stable prefix. Cached, so repeat turns skip re-reading the novel.
  // The contents index rides inside it: it is derived from the same (book,
  // boundary) the text is, so it is just as stable and costs nothing after the
  // first turn.
  const author = input.bookAuthor ? ` author="${input.bookAuthor}"` : "";
  const contents =
    input.chapters.length > 0
      ? `<contents>\n${input.chapters.map(contentsLine).join("\n")}\n</contents>\n`
      : "";
  blocks.push({
    type: "text",
    text: `<book title="${input.bookTitle}"${author}>\n${contents}${input.bookText}\n</book>`,
    cache_control: { type: "ephemeral" },
  });

  // Everything below the breakpoint: per-chat, and small.
  const tail: string[] = [];

  if (input.quotedText) {
    tail.push(
      "The reader highlighted this passage and started the conversation from " +
        `it:\n\n"""\n${input.quotedText}\n"""`
    );
  }

  if (input.priorTranscript && input.priorTranscript.length > 0) {
    const where =
      input.parentAnchorPage != null
        ? ` earlier, at page ${input.parentAnchorPage}`
        : " earlier";
    const rendered = input.priorTranscript
      .map((m) => `${m.role === "user" ? "Reader" : "You"}: ${m.content}`)
      .join("\n\n");
    tail.push(
      `This conversation continues one you had with them${where}. They have ` +
        "read further since. Earlier transcript:\n\n" +
        `<prior_conversation>\n${rendered}\n</prior_conversation>`
    );
  }

  if (tail.length > 0) {
    blocks.push({ type: "text", text: tail.join("\n\n") });
  }

  return blocks;
}
