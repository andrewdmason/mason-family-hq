import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { ChapterIndexEntry } from "@/lib/reading/context-markup";
import type { BookDocumentContext, ReaderMark } from "@/lib/reading/book-document-context";
import type { ReaderChatTemplate } from "@/lib/reading/annotation-types";
import { agentFor, AGENT_LABELS, agentPrompt } from "@/lib/reading/reading-agent";
import { isReaderProfileEmpty, type ReaderProfile } from "@/lib/reading/reader-profile";

/**
 * The ONE place the reader's system prompts are assembled — the anchored chat,
 * the chapter recap below it, and the reader's own preface and afterword below
 * that.
 *
 * Kept together deliberately: a kid-appropriate variant will need to behave very
 * differently (an AI that will summarize a chapter on demand is a cheat engine
 * for the reading quizzes, which pay out Mason Bucks — and the recap makes that
 * a tap rather than a question someone has to think to ask). When that lands it
 * should be a branch in each of these, not a second prompt scattered elsewhere.
 */

/** Fast: snappy, 200K context. */
export const READER_CHAT_FAST_MODEL = "claude-haiku-4-5";

/**
 * Deep: the best model there is, because Deep is now a different KIND of
 * conversation rather than a better-answered version of the same one.
 *
 * It was Sonnet while both modes wrote marginalia and the only difference was
 * how well. Deep now writes an interpretive essay — the register below — and
 * that is the one thing in the reader where the gap between models is the whole
 * product. The comparison that moved it: the same book, the same question,
 * answered here and answered by Opus in a chat window with no instructions at
 * all. The chat window won so completely that the feature read as broken.
 */
export const READER_CHAT_DEEP_MODEL = "claude-opus-5";

/**
 * What a book too long for Fast is answered with — NOT the Deep model.
 *
 * These were one constant, and conflating them was a real bug rather than a
 * tidy simplification. "Deep" now means two unrelated things: a reader asking
 * for an argument, and a book that does not fit in 200K. Promotion is about
 * FITTING. A reader who picked Fast, asked "who is Judith again?", and happens
 * to be reading a very long novel wants the short answer they asked for — at
 * the cheapest model that can hold the book, not at Opus with an essay's budget.
 *
 * So the model follows what FITS and the register follows what they PICKED.
 * Sonnet holds a million tokens, which is the only property this needs.
 */
export const READER_CHAT_PROMOTION_MODEL = "claude-sonnet-5";

/**
 * Haiku 4.5's context window. Every other current model is 1M, which is why a
 * long novel has to be promoted rather than truncated.
 */
export const FAST_MODEL_CONTEXT_WINDOW = 200_000;

/** Headroom for the reply and count-vs-send drift before we promote. */
export const FAST_MODEL_HEADROOM = 8_000;

/**
 * What the search tool costs, counted by hand.
 *
 * The count-tokens endpoint rejects any request carrying a server tool — the
 * whole call 400s rather than counting what it can — so the tool has to be left
 * out of the count and added back as a number. Leaving it out silently was the
 * bug this constant exists to close: the count threw, the promotion check fell
 * open to Fast, and a book far too long for Fast was sent anyway.
 *
 * Generous on purpose. The definition serializes to about 120 tokens and the
 * API wraps it in an instruction block of unknown size, so this is an upper
 * bound rather than a measurement — and it is spent against 8K of headroom, so
 * being wrong high costs nothing.
 */
export const SEARCH_TOOL_TOKEN_ALLOWANCE = 1_500;

/**
 * Chars per token, for the estimate used only when counting fails outright.
 *
 * Deliberately below the ~4 that English prose actually runs at, so the
 * estimate reads high and a borderline book goes to Deep. Promoting a book that
 * would have fit costs a slightly slower answer; not promoting one that doesn't
 * costs the reader an error where their answer should be.
 */
export const FALLBACK_CHARS_PER_TOKEN = 3.5;

/**
 * The reply budget for a Fast turn, and the room reserved for a reply when
 * deciding whether a book fits Fast at all. Prose only — Fast does not think.
 *
 * Raised from 1024 when the picker stopped being a register. Fast used to be
 * told it was writing marginalia, so a small ceiling and the instruction agreed
 * with each other; now that the question sets the length on either model, a
 * reader who picks the quick model and asks a real question can want more than
 * a thousand tokens. Sized generously rather than snugly, because nothing is
 * billed for room it doesn't use and the failure it prevents is the invisible
 * kind: an answer cut off mid-sentence still reads like an answer.
 */
export const READER_CHAT_MAX_TOKENS = 2048;

/**
 * The same budget for Deep, which does.
 *
 * `max_tokens` caps thinking AND reply together, so a ceiling sized for the
 * prose alone truncates the answer mid-sentence once reasoning is spending out
 * of the same allowance — and the failure is invisible from the outside,
 * because a cut-off remark still reads like a remark. Sized generously rather
 * than snugly: nothing is billed for room it doesn't use, and the length of the
 * answer is governed by the prompt anyway.
 *
 * 3072 was sized for a marginal remark plus some thinking. Deep now writes an
 * interpretive essay: eight hundred words of prose is ~1,200 tokens before
 * high-effort reasoning takes its share of the same allowance, so the old
 * ceiling would have cut the good answers off in their second half — exactly
 * the failure the reader's afterword hit, and the one nobody sees, because an
 * essay that stops early reads as an essay that rambled.
 */
export const READER_CHAT_DEEP_MAX_TOKENS = 8192;

/**
 * Deep reasons before it answers; Fast can't — Haiku has no effort dial and no
 * adaptive thinking, so this is the whole of the difference the picker buys
 * beyond the model itself.
 *
 * HIGH, THOUGH THE OBVIOUS CHOICE IS LOW — and the honest summary is that this
 * setting buys less than it looks like it should. Adaptive thinking decides for
 * itself whether to engage, and on this prompt it mostly decides not to.
 * Measured rather than reasoned about:
 *
 *   effort   a lookup ("who is Judith again?")   an interpretive question
 *   low      never thought,     ~0.9s            never thought,     ~1.0s
 *   medium   thought,           ~2.8s            never thought,     ~1.9s
 *   high     thought,           ~4.0s            thought 1 run in 6
 *
 * Two things follow. Low is not a cheap version of this feature, it is the
 * absence of one: indistinguishable from thinking switched off. And medium is
 * worse than either, engaging on the lookup that needs it least and skipping
 * the interpretive question that is the whole reason to want it.
 *
 * High is the only level that ever engages on the questions worth engaging on,
 * but it engaged rarely — six runs of the same interpretive question thought
 * once. The suspected cause was this file's own prompt: it told the model
 * repeatedly that this is marginalia, a remark in the margin, a short answer to
 * a short question, and a model weighing whether to reason first reads all of
 * that as permission not to.
 *
 * That suspicion is now being tested, because Deep no longer says any of it —
 * it asks for an argument and lets the question set the length (see the
 * register below). If the theory was right, engagement should rise on its own
 * without this dial moving. The numbers above were also taken with no book in
 * the prompt, and a large context is exactly the condition under which
 * triggering is said to change, so re-measure in place before concluding
 * anything from them.
 *
 * What it costs meanwhile is small and paid on every Deep turn: ~2.1s to the
 * first character against ~1.0s with thinking off. What it buys, on the turn
 * where it does engage, is the reasoning the picker implies. Lowering this to
 * "low" is a one-word revert that turns the feature off while leaving every
 * sign of it standing — see the check in verify-chat-stream.mts.
 */
export const READER_CHAT_DEEP_EFFORT = "high" as const;

/**
 * What the panel shows while Deep is reasoning. See chat-stream.ts.
 *
 * Reasoning is returned redacted, so there is nothing to show but the fact of
 * it — which is the entire point of this line. Thinking happens BEFORE the
 * first visible character, so without it the reader watches an empty bubble for
 * several seconds with nothing to say why. The same problem searching has, and
 * the same fix.
 */
export const THINKING_STATUS = "Thinking…";

/**
 * Char cap on the book text. Not the real gate — token counting is — just a
 * backstop so a pathological book can't build a multi-megabyte request.
 */
export const READER_CHAT_MAX_CONTEXT_CHARS = 3_000_000;

/**
 * How many searches one answer may run.
 *
 * Every search is several seconds of an empty bubble, so this is a latency
 * budget rather than a cost one. Four rather than one or two because "what have
 * critics made of this" is a real question here and rarely has a single source:
 * the first result is a review, the second is the author disagreeing with it.
 * Past four it stops being a remark in the margin.
 */
const WEB_SEARCH_MAX_USES = 4;

/**
 * Sites the reader's chat may never see.
 *
 * Everything here is a plot summary wearing some other hat. They are blocked
 * because a search snippet arrives BEFORE the model has decided whether to use
 * the result — so for a reader who is midway through, no instruction about
 * spoilers can act in time. Blocking is the only guard that runs early enough.
 *
 * Nothing of value is lost. The reason to search about a book is the critical
 * conversation around it, and none of it happens on these sites: a study guide
 * is a summary, a fan wiki is a synopsis, a Goodreads page is a thousand people
 * describing the ending in the first line. Reviews and criticism proper — the
 * papers, the literary press, the journals, the author's own interviews — are
 * all reachable and all where the answer actually lives.
 *
 * A blocklist rather than an allowlist because the legitimate use is most of the
 * open web, and no allowlist survives that.
 *
 * The same list serves both interviews. For the afterword the reader has
 * finished and nothing needs protecting, so the reason changes from spoilers to
 * quality: asked what the author or the critics made of a book, a study guide
 * answers with a summary of it, and outranks the real criticism in every result.
 * For the preface the original reason applies harder than anywhere — they have
 * not opened the book at all.
 *
 * Wikipedia is deliberately NOT here — it is the best single source for the
 * real-world questions this answers, and for a book's publication history and
 * reception. Its plot section is the risk, and the prompt handles that.
 */
const WEB_SEARCH_BLOCKED_DOMAINS = [
  // Study guides: summary machines, and the first hit for any book query.
  "sparknotes.com",
  "cliffsnotes.com",
  "shmoop.com",
  "litcharts.com",
  "gradesaver.com",
  "bookrags.com",
  "enotes.com",
  "novelguide.com",
  "supersummary.com",
  "bookcompanion.com",
  // Fan wikis: a character's name is enough to land on a full synopsis.
  "fandom.com",
  "wikia.com",
  // Reader reviews and adaptations, which give away endings in the first line.
  "goodreads.com",
  "thestorygraph.com",
  "imdb.com",
];

/**
 * The tools a searching turn is given — the anchored chat's, and both document
 * interviews'. One tool, and the same one every turn.
 *
 * Note for anyone adding a token count to a route that uses this: the
 * count-tokens endpoint refuses a request carrying a server tool and 400s the
 * whole call. See SEARCH_TOOL_TOKEN_ALLOWANCE.
 *
 * Byte stability matters more here than anywhere else in this file: tools are
 * rendered AHEAD of the system blocks, so anything that varies per chat would
 * sit in front of the cached novel and re-bill it on every turn. Nothing in
 * this depends on the book, the reader, or the boundary — only on the model,
 * which scopes the cache anyway.
 *
 * The Fast model is a generation behind the dynamically-filtered search tool,
 * so it gets the basic one. Same name, same behaviour from the prompt's side.
 */
export function readerWebSearchTools(model: string): Anthropic.ToolUnion[] {
  return [
    {
      type:
        model === READER_CHAT_FAST_MODEL
          ? ("web_search_20250305" as const)
          : ("web_search_20260209" as const),
      name: "web_search",
      max_uses: WEB_SEARCH_MAX_USES,
      blocked_domains: WEB_SEARCH_BLOCKED_DOMAINS,
    },
  ];
}

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
  /**
   * Whether this book is a story. Null when nothing has classified it yet, which
   * is a real state and gets no branch at all — a companion that guesses wrong
   * about what kind of book it's in is worse than one that stays neutral.
   *
   * Distinct from `spoilerFree` below, which is about this CHAT's boundary rather
   * than the book's kind. The two used to be the same field and it went badly.
   */
  fiction: boolean | null;
  /** True when this chat is spoiler-scoped. */
  spoilerFree: boolean;
  /** The page the scope ends at, when known. */
  contextThroughPage: number | null;
  /**
   * How far the reader has actually got, for chats that are NOT spoiler-scoped
   * and therefore hold the whole book. Null for a scoped chat (the text already
   * stops there) and for an article (there is no "further on" to protect).
   */
  readerPosition: { page: number | null; percent: number | null } | null;
  /** Selection-initiated chats: the passage the reader highlighted. */
  quotedText: string | null;
  /**
   * When the reader was reading in Plain English: the plain rendering of the
   * paragraph(s) the mark sits on, and the plain sentence they selected. The
   * author's words are always in `quotedText`; these are what the reader saw.
   */
  plainFace?: string | null;
  plainQuotedText?: string | null;
  /** True when the transcript carries notes the reader wrote to themselves. */
  hasReaderNotes: boolean;
  /**
   * The preface the reader wrote before starting this book, if they wrote one —
   * their own statement of why they're reading it. Null otherwise, which is the
   * common case.
   *
   * The only place their stated intent travels to. Deliberately not the chapter
   * recap, which should say what a chapter said rather than filter it through an
   * agenda, and deliberately nowhere that could interrupt them mid-book.
   */
  readerIntent: string | null;
  /**
   * Who the reader is, from the journal. Null when they have filled none of it
   * in, which is the ordinary case for a kid.
   */
  readerProfile: ReaderProfile | null;
  /**
   * Which conversation the reader asked for — THEIR pick, not the model that
   * ended up serving it.
   *
   * These came apart deliberately. A book too long for Fast is promoted to a
   * bigger model, and reading the register off the resolved model would hand a
   * reader who asked for a quick lookup an essay, purely because their novel is
   * long. What they picked governs how it is written; what fits governs what
   * writes it.
   */
  depth: ReaderChatDepth;
  /**
   * Which margin-menu conversation this is, or null for an ordinary chat the
   * reader started by typing.
   *
   * Governs the register for the whole thread rather than just its first turn,
   * which is the reason it is a column on the row rather than a well-written
   * opening message: this prompt is rebuilt from scratch on every turn, so an
   * instruction carried in the first message would govern the answer to it and
   * evaporate immediately afterwards.
   */
  template: ReaderChatTemplate | null;
  /**
   * Earlier check-ins in this book, oldest first, excluding this one.
   *
   * Only ever set for the check-in template, and deliberately nothing else: not
   * highlights, not notes, not questions asked in the margin. Ordinary marks
   * were sent for a while and every version of using them went wrong — see
   * chat-context.ts.
   */
  priorCheckIns: ReaderMark[] | null;
  /** Whether the char budget dropped any of them. */
  priorCheckInsTruncated: boolean;
};

/**
 * The two conversations this chat can be, which is what the Fast/Deep picker
 * has always implied and never delivered.
 *
 * Until now the picker changed the model and nothing else: the prompt was built
 * before the model was chosen and took no argument for the reader's choice, so
 * Deep bought a stronger model and then read Fast's instruction telling it to
 * write a remark in the margin. Paying for reasoning and then asking for a
 * margin note is the whole of why Deep felt like Fast with a delay.
 */
export type ReaderChatDepth = "fast" | "deep";

/**
 * THE FOUR LAYERS every reader prompt is assembled from.
 *
 * Naming them is not decoration — it is the fix for what went wrong here. Each
 * of these used to be written per surface, so the same idea got restated in
 * slightly different words in four places and then drifted apart: "make a claim,
 * not a menu" was learned once by the afterword interview and again, separately,
 * weeks later, by the check-in. Five families of rule were duplicated that way.
 *
 *   agent       — WHO is talking. Varies by the kind of book. See reading-agent.
 *   brief       — WHAT THIS TURN IS. Varies by surface: a remark in the margin,
 *                 a briefing, office hours, one interview question, a document
 *                 that gets kept. Owns shape, length, and how the turn ends.
 *   constraints — WHAT MAY BE SAID. Spoilers, where the reader is standing, what
 *                 the web is for, how to cite. Orthogonal to both of the above.
 *   context     — WHAT IS KNOWN. The book, the reader's marks, who they are,
 *                 what they said they came for. Data rather than instruction.
 *
 * The agent and the brief being written together, over and over, is what
 * produced the sprawl. They are independent and they are now assembled that way.
 */
export type PromptLayer = "agent" | "brief" | "constraints" | "context";

/**
 * One labelled piece of a prompt.
 *
 * Carried alongside the blocks purely so the panel's prompt inspector can show
 * the seams. A layering nobody can see is a layering that quietly stops being
 * true — and the inspector is how it stays honest.
 */
export type PromptSection = {
  layer: PromptLayer;
  /** A few words naming this piece, for the inspector. */
  title: string;
  text: string;
  /** True when the API block this sits in carries a cache breakpoint. */
  cached?: boolean;
};

/**
 * Char budget for the reader's marks inside a CHAT, well under the afterword's.
 *
 * An afterword sends the book once. A chat sends it on every turn, so the marks
 * ride alongside a novel rather than instead of one, and the two together have
 * to leave room for a long book plus a Deep reply. ~50K tokens of marks is far
 * more than any real book produces; the cap exists so a shelf imported with
 * hundreds of Kindle highlights can't quietly double the size of every turn.
 */
export const READER_CHAT_MAX_MARK_CHARS = 200_000;

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
 * Who the reader is, from the journal — shared by the anchored chat and by both
 * of the reader's own documents.
 *
 * The framing is the whole design here, and it is the same one the reader-intent
 * block already uses: this is BACKGROUND, not an instruction. What it buys is
 * that a guess can be about a real person — "you have a teenager about to leave
 * home" rather than "was it X, or Y?" — and that the name someone drops mid-
 * sentence resolves to somebody instead of stopping the conversation.
 *
 * What it must not become is a companion with a thesis about your life. Hence
 * the explicit prohibitions: it can shape what is asked, never get recited back,
 * and a chat about a book stays a chat about a book.
 *
 * Returns null when the journal is empty, which is the ordinary case for a kid —
 * so the block is absent rather than present and hollow.
 */
export function readerProfileBlock(profile: ReaderProfile | null): string | null {
  if (!profile || isReaderProfileEmpty(profile)) return null;

  const parts: string[] = [
    "WHO YOU ARE TALKING TO. What follows is what this app knows about the " +
      "reader, written by them and their family elsewhere in it — not about " +
      "this book.",
  ];

  if (profile.family) {
    parts.push(
      `<their_family>\nWho is around them. Use it to know who a name belongs ` +
        `to when they drop one — a reader who says "my wife" or "Jenny" should ` +
        `not have to explain who that is.\n\n${profile.family}\n</their_family>`
    );
  }
  if (profile.present) {
    parts.push(
      `<their_life_now>\nTheir own account of where they are at the moment: ` +
        `what they are doing, who is around them, what is on their ` +
        `mind.\n\n${profile.present}\n</their_life_now>`
    );
  }
  if (profile.timeline) {
    parts.push(
      `<their_life_so_far>\nTheir life as dated events.\n\n${profile.timeline}\n</their_life_so_far>`
    );
  }

  parts.push(
    "Use this to know who is asking, and to make what you say land on the " +
      "person actually in front of you. Three things it is NOT. It is not " +
      "something to quote, recite or show off knowing — nobody wants to be read " +
      "their own biography. It is not a subject: they came to talk about a " +
      "book, and steering the conversation onto their life is a worse " +
      "conversation, not a more personal one. And it is not evidence about the " +
      "book — never claim it explains why they are reading this unless they " +
      "have said so themselves."
  );

  return parts.join("\n\n");
}

/**
 * LAYER 2 — THE BRIEFS for the two mid-book templates.
 *
 * Both are much shorter than they were, and the deletions are the point. Most of
 * what was here was scar tissue from wounds this file inflicted on itself: the
 * check-in fixated on the reader's highlights because another block told it
 * marks were what every claim must rest on; it wrote essays because the Deep
 * register demanded several hundred words; it invented a previous conversation
 * because briefings and check-ins shared one section. Each was patched with a
 * long prohibition. Removing the CAUSE lets the bandage come off too, and a
 * prompt made mostly of prohibitions produces a companion that sounds like it is
 * avoiding things.
 *
 * What is kept is the small amount that describes a genuine model tendency
 * rather than a mistake of ours — the fork that draws "both", the pull toward
 * summarising a book instead of reading it — plus the rules that ARE the
 * feature, like the key's line between machinery and outcome.
 */
/** What the brief is called, for the inspector. */
function briefTitle(template: ReaderChatTemplate | null): string {
  if (template === "reading_key") return "The brief — how to read this book";
  if (template === "check_in") return "The brief — a check-in";
  return "The brief — an anchored chat";
}

function templateRules(
  template: ReaderChatTemplate,
  fiction: boolean | null
): string[] {
  if (template === "reading_key") {
    const rules = [
      "The reader has opened a conversation ABOUT THE BOOK — not about the " +
        "passage they happen to be standing next to. They have an anchor in " +
        "the text, and it tells you how far they have read and nothing else.",
      "THIS TURN: they have asked how to read this book — how to approach it, " +
        "what to attend to, what to stop waiting for. A briefing from someone " +
        "who has read the whole thing to someone who has not. A few hundred " +
        "words, then stop.",
      // The rule that IS this feature, and the reason it is safe to hand a
      // mid-book reader something drawn from the last chapter.
      "A KEY DESCRIBES THE MACHINERY; A SPOILER DESCRIBES THE OUTPUT. How the " +
        "book is built, what it is doing to its reader and by what means, what " +
        "a first-timer reliably misreads — all yours to say, and saying it is " +
        "the point. What happens, who turns out to be what, how it resolves — " +
        "none of it, ever, however much it would help.",
      // Without this the model reads the position block in the constraints and
      // refuses the thing it was just asked for, which is the worse failure:
      // the reader gets a shrug where the feature should be.
      "Use the whole book to do it. A key cannot be written from the half they " +
        "have read, so declining on those grounds would refuse the question " +
        "they asked. \"The people he meets keep turning out to be versions of " +
        "himself, so read each encounter as pressure on one man rather than as " +
        "plot\" is exactly right — naming the scene where that becomes " +
        "undeniable is not.",
    ];

    if (fiction === true) {
      rules.push(
        "Often the most useful thing you can give them is permission to stop " +
          "reading it for the wrong thing — a plot that is not coming, a " +
          "mystery that is not the point. That is what makes a book feel " +
          "tedious when it isn't."
      );
    } else if (fiction === false) {
      rules.push(
        "For this one that means where the idea actually lives: which chapters " +
          "carry the argument and which restate it, whether it repays reading " +
          "straight through or can be stopped early, and where its method is " +
          "weakest. Be honest about padding."
      );
    }

    return rules;
  }

  return [
    "The reader is partway through the book — there's an anchor in the text " +
      "that will tell you how far they are — and they're taking a break to " +
      "discuss the book with you. They're looking for the type of interaction " +
      "they might get in a class where they've been asked to read up to that " +
      "point and then there's a class discussion, or a weekly check-in for a " +
      "book club. Your job is to kick things off with something interesting — " +
      "helping guide the reader toward a meaningful interpretation.",
    "If they've done earlier check-ins like this, keep those in mind. Read " +
      "<earlier_check_ins> first. If that section reports none, this is the " +
      "first time you have spoken about this book, and treat it as such.",
    // A line stood here saying "you also have their marks, which may or may not
    // be noteworthy — don't oversteer toward them". It went when the marks did:
    // an instruction not to lean on something you were not given is one more
    // thing to read and a small invitation to go looking for it.
    "You have access to the whole book, but don't give away spoilers that go " +
      "into parts they haven't read yet.",
  ];
}

/**
 * Returns the system blocks. Order matters for prompt caching: everything up to
 * and including the cache breakpoint must be byte-stable for a given
 * (book, boundary, model), so the whole book bills at ~0.1x on every turn after
 * the first. Nothing volatile — no dates, no names — may appear before it.
 */
function assembleReaderChatPrompt(input: ReaderChatPromptInput): {
  blocks: Anthropic.TextBlockParam[];
  sections: PromptSection[];
} {
  const blocks: Anthropic.TextBlockParam[] = [];

  // LAYER 1 — WHO IS TALKING. One block, the same person in every surface.
  const agent = agentPrompt(input.fiction);

  // LAYER 2 — WHAT THIS TURN IS.
  //
  // The Fast/Deep REGISTER is gone from here, and that is the largest deletion
  // in this file. The picker used to mean two things at once: which model
  // answers, and what kind of answer it writes. The second was always the
  // weaker idea — a reader picking a model has said nothing about whether their
  // question deserves a paragraph or a page — and it was actively harmful,
  // because a register that demanded an essay fought every brief that wanted a
  // conversation. The picker is now a MODEL picker and nothing more. What the
  // turn should look like is the brief's business, which is where it belongs:
  // the question sets the length, on either model.
  const brief: string[] = [];

  if (input.template) {
    brief.push(...templateRules(input.template, input.fiction));
  } else {
    brief.push(
      "THIS TURN: they are partway through the book and have opened a " +
        "conversation anchored to a spot in the text. Answer what they " +
        "actually asked."
    );
    brief.push(
      "Let the question set the length. A short question gets a short answer — " +
        "a remark in the margin, not an essay — and a real one gets the room " +
        "it needs. No headings, and never a bulleted list of themes: that is a " +
        "study guide, which is the opposite of this."
    );
    // There was a third line here giving permission to reach outside the book —
    // the author's other work, the tradition it sits in, another book that does
    // the same thing better. Cut: a well-read companion does that unprompted,
    // and nothing else in this prompt tells it to stay inside the covers. The
    // rule below about the text outranking the web is about FACTS about this
    // book, not about where an idea may come from.
  }

  // LAYER 3 — WHAT MAY BE SAID.
  const constraints: string[] = [];

  // Web search. The rule that governs it is about PRIMACY, not permission.
  //
  // The obvious version of this — "never search about the book" — is wrong, and
  // was the first thing this got wrong. Half of what a reader wants from a
  // companion is the conversation around the book: what the author said they
  // were doing, what critics made of it, what it was answering. None of that is
  // in the text, and refusing to fetch it makes the chat a worse reader than the
  // person using it.
  //
  // What the text IS still authoritative for is itself. The failure to prevent
  // isn't searching about the book, it's outsourcing the book: answering "what
  // happens in chapter 21" from a summary when chapter 21 is sitting below.
  constraints.push(
    "You can search the web. Two things it is for. First, the world outside " +
      "the book: a real event, person, place or date the text refers to; a " +
      "word, phrase or allusion the reader wouldn't be expected to know; " +
      "whether something the book asserts is actually true. Second, the " +
      "conversation around the book: what its author has said about it, how " +
      "critics and other readers have read it, what it was responding to, how " +
      "it was received, where it sits in the author's work. Interpretation is " +
      "a good reason to search — a reader asking what to make of something " +
      "usually wants to know what has been made of it."
  );
  constraints.push(
    "The book text below IS the book, and it outranks anything you find. Use " +
      "the web for what people have MADE of the book, never as a substitute " +
      "for reading it: what happens, what a passage contains, how a chapter " +
      "goes, what a character does — all of that you read below, and looking " +
      "up somebody's summary of it instead would be worse and slower. When a " +
      "critic's reading and the page in front of you disagree, the page wins: " +
      "say what the text actually does, then what they make of it."
  );
  // A line stood here telling it not to search what it could already answer, on
  // the grounds that a search is several seconds of an empty bubble. Cut as one
  // more thing the model does not need telling. If turns start feeling slow, a
  // latency budget belongs in the tool's max_uses rather than in prose.
  // An attribution rule stood here — say whose reading it is, keep an argument
  // distinguishable from a fact. Cut for the same reason as the voice line in
  // the agent: it describes something the model does anyway, and it had already
  // cost more than it earned once, in a version that read as an instruction to
  // go and find somebody else to have the opinion.
  // KEPT DELIBERATELY, and the only line in this block that is not about the
  // model's judgement. It is a fact about the app: the route collects the search
  // results itself and appends a "Sources:" line under every answer (see
  // web-sources.ts). Without this the model writes its own list too and the
  // reader gets the same links twice.
  constraints.push(
    "Do not write out URLs or list your sources: the app puts the links " +
      "underneath your answer."
  );

  if (input.hasPageMarkers) {
    constraints.push(
      "The book text contains page markers like [p.212]. When you point at " +
        "something in the text, cite the nearest preceding marker in exactly " +
        "that bracketed form. Only cite markers that actually appear in the " +
        "text you were given. Do not write page numbers in prose (never " +
        '"on page 212") — use the [p.212] form alone, since the app turns it ' +
        "into a link and displays it in the reader's own terms."
    );
  }

  if (input.hasChapterMarkers) {
    constraints.push(
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
      constraints.push(
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
    constraints.push(
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

    // The one place the general permission to search about the book is taken
    // back, and it has to be taken back rather than qualified. A critical essay
    // is written for someone who has finished: it moves through the whole arc as
    // a matter of course, and the ending is usually its subject. There is no way
    // to read one from page 90 and use only the safe parts — by the time the
    // model is deciding what to quote, it has already read the ending, and the
    // next thing it says is downstream of knowing it.
    //
    // The escape hatch is real and worth telling them about: an unscoped chat in
    // the same book can go and get exactly this, and the toggle that starts one
    // is right there in the panel.
    constraints.push(
      "That extends to searching, and it is the only limit on it: while this " +
        "conversation is spoiler-scoped, do not search for this book, for its " +
        "author on the subject of it, or for anything written about it. " +
        "Criticism, interviews and reviews are all written for someone who has " +
        "finished, so there is no safe way to read them from where the reader " +
        "is standing. Searching the world OUTSIDE the book is still fine and " +
        "still encouraged. If what they want is the critical conversation, say " +
        "plainly that you can't fetch it without spoiling them from here, and " +
        "that a chat started with the spoiler boundary off can — it's their " +
        "call, not yours to make quietly."
    );
  }

  const sections: PromptSection[] = [
    {
      layer: "agent",
      // Named rather than described. Which agent a book gets is the most
      // consequential line in its prompt and the hardest to eyeball.
      title: AGENT_LABELS[agentFor(input.fiction)],
      text: agent,
    },
    { layer: "brief", title: briefTitle(input.template), text: brief.join("\n\n") },
    { layer: "constraints", title: "What may be said", text: constraints.join("\n\n") },
  ];

  // One API block for the three instruction layers. They are split for reading
  // and for reasoning about, not for the wire — and keeping them in one block
  // keeps the cached prefix byte-identical to what it was.
  blocks.push({
    type: "text",
    text: sections.map((s) => s.text).join("\n\n"),
  });

  // The big stable prefix. Cached, so repeat turns skip re-reading the novel.
  // The contents index rides inside it: it is derived from the same (book,
  // boundary) the text is, so it is just as stable and costs nothing after the
  // first turn.
  const author = input.bookAuthor ? ` author="${input.bookAuthor}"` : "";
  const contents =
    input.chapters.length > 0
      ? `<contents>\n${input.chapters.map(contentsLine).join("\n")}\n</contents>\n`
      : "";
  const bookBlock = `<book title="${input.bookTitle}"${author}>\n${contents}${input.bookText}\n</book>`;
  sections.push({
    layer: "context",
    title: "The book",
    text: bookBlock,
    cached: true,
  });
  blocks.push({
    type: "text",
    text: bookBlock,
    cache_control: { type: "ephemeral" },
  });

  // The reader's marks, on their OWN breakpoint — the same arrangement the
  // preface and afterword use, and for the same reason. These are large on a
  // heavily-marked book and would be re-billed in full on every turn if they
  // rode below the last breakpoint with the small per-chat tail. Their own block
  // means marking something new mid-conversation invalidates this and nothing
  // else: the novel above it still reads from cache.
  //
  // Only ever present for a template. An ordinary chat's prefix is byte-for-byte
  // what it always was, so nothing here changes what an existing chat costs.
  // Earlier check-ins, on their OWN breakpoint — the same arrangement the
  // preface and afterword use. Sent for the check-in and nothing else.
  //
  // Emitted even when there are none, and that is the point of it. A silent
  // absence left the model to infer whether it had been here before, and it
  // guessed in the flattering direction: one transcript opened "Last time I said
  // watch what happens to Ryder's promises to Boris" on a reader's first ever
  // check-in. An explicit zero is what stops that.
  if (input.priorCheckIns) {
    const priorBlock =
      input.priorCheckIns.length > 0
        ? `<earlier_check_ins count="${input.priorCheckIns.length}">\n` +
          "Check-ins this reader has already had with you in this book, oldest " +
          "first, with everything that was actually said in them.\n" +
          input.priorCheckIns.map(markBlock).join("\n") +
          (input.priorCheckInsTruncated
            ? "\n(Older ones omitted for length.)"
            : "") +
          "\n</earlier_check_ins>"
        : '<earlier_check_ins count="0">\n' +
          "This is the first check-in this reader has had in this book. You " +
          "have never discussed it with them before. There is no last time.\n" +
          "</earlier_check_ins>";
    sections.push({
      layer: "context",
      title: "Earlier check-ins",
      text: priorBlock,
      cached: true,
    });
    blocks.push({
      type: "text",
      text: priorBlock,
      cache_control: { type: "ephemeral" },
    });
  }

  // Everything below the breakpoint: per-chat, and small.
  const tail: string[] = [];

  // The reader's position belongs here rather than up in the rules, volatile by
  // nature: it moves as they read, and pinning it above the cache breakpoint
  // would rewrite the prefix — and re-bill the whole novel — on every turn.
  if (!input.spoilerFree && input.readerPosition) {
    const { page, percent } = input.readerPosition;
    const at = [
      page != null && input.hasPageMarkers ? `[p.${page}]` : null,
      percent != null ? `about ${percent}% of the way in` : null,
    ]
      .filter(Boolean)
      .join(", ");
    if (at) {
      tail.push(
        `WHERE THE READER IS: they have read up to ${at}. Everything after ` +
          "that point is text they have not seen yet. You were given the whole " +
          "book rather than only the part they have read, so you may answer " +
          "directly about anything they ask, the ending included — the mistake " +
          "to avoid is volunteering it. Never say or imply they have finished " +
          "the book, or that they stopped anywhere but that point. Do not " +
          "raise, allude to or foreshadow a later event, reveal or ending " +
          "unless their question actually calls for it, and never discuss " +
          "later material as though they had already read it. When answering " +
          "honestly does mean reaching past where they are, say so in a few " +
          "words first, then answer. This governs what you find on the web as " +
          "much as what you read below: criticism is written for someone who " +
          "has finished the book, so a review you fetch will hand you the " +
          "ending whether or not their question wanted it." +
          // Used to carry a second paragraph for Deep, binding "the argument
          // you were asked for" — which went with the register that asked for
          // one. The rule above already says the whole of it, and said once it
          // reads as a rule rather than as an argument with itself.
          //
          // This block sits AFTER the rules and would otherwise be the last
          // word — which for the key template means overriding the one thing it
          // was built to do. The exemption is narrow and is stated here, at the
          // point of collision, rather than left to whichever instruction the
          // model happens to weight more heavily.
          (input.template === "reading_key"
            ? " ONE EXEMPTION, for the question they asked this time: a key to " +
              "HOW the book is read may be drawn from the whole of it, " +
              "including pages ahead of them. That exemption covers method and " +
              "nothing else — how the book is built, what it is doing to a " +
              "reader, what a first-timer misreads. Every word of the rule " +
              "above still governs events, reveals, fates and endings, which " +
              "remain off the table no matter how much they would sharpen the " +
              "point."
            : "")
      );
    }
  }

  // Below the breakpoint with everything else about the reader rather than the
  // book. Editing a profile doc is rare, but it is not something the book's
  // cache key should depend on.
  const profile = readerProfileBlock(input.readerProfile);
  if (profile) tail.push(profile);

  // Below the cache breakpoint with the reader's position, and for the same
  // reason: it is a property of the reader rather than of the book, and it can
  // change — rewriting their preface must not re-bill the novel on every chat in
  // it. Framed as context rather than as an instruction, because a chat that
  // bent every answer back toward a stated agenda would be worse than one that
  // never knew: what this buys is an answer pitched at what they came for, not
  // a companion with a thesis.
  if (input.readerIntent) {
    tail.push(
      "WHAT THEY CAME FOR: before starting this book, the reader wrote down " +
        "why they were reading it and what they wanted from it.\n\n" +
        `"""\n${input.readerIntent}\n"""\n\n` +
        "Treat that as background on what they care about. Let it shape what " +
        "you lead with and how much you assume, not what you claim. Never " +
        "quote it back at them, never tell them whether they are getting what " +
        "they came for, and never decline to answer something because it sits " +
        "outside it."
    );
  }

  if (input.quotedText) {
    tail.push(
      "The reader highlighted this passage and started the conversation from " +
        `it:\n\n"""\n${input.quotedText}\n"""`
    );
  }

  if (input.plainFace) {
    tail.push(
      "The reader was reading this book in PLAIN ENGLISH — a paragraph-for-" +
        "paragraph plain-prose rendering the app made of the author's text. " +
        "This is the rendering they saw for the passage above" +
        (input.plainQuotedText
          ? `, and the sentence they actually selected was: \"${input.plainQuotedText}\"`
          : "") +
        `:\n\n"""\n${input.plainFace}\n"""\n\n` +
        "Answer against the author's own words (the passage above). Use the " +
        "plain rendering only to understand what the reader has in front of " +
        "them; if it has flattened or lost something the author's words carry, " +
        "say so."
    );
  }

  // Notes are shown to the model but were never addressed to it. Said plainly
  // here because the alternative — hiding them — makes the reader's own words
  // invisible to the thing they are talking to, so a follow-up that says "that"
  // or "this idea" refers to something only one side of the conversation can
  // see. Marked rather than silently folded in, so the model does not answer a
  // thought that was not a question.
  if (input.hasReaderNotes) {
    tail.push(
      "Some lines in this conversation are marked [Reader's note]. Those are " +
        "the reader thinking on the page, not questions to you — they were " +
        "written without expecting a reply. Treat them as context for what the " +
        "reader believes and cares about, and answer only what they actually ask."
    );
  }

  if (tail.length > 0) {
    const tailBlock = tail.join("\n\n");
    sections.push({
      layer: "context",
      title: "This reader, and where they are",
      text: tailBlock,
    });
    blocks.push({ type: "text", text: tailBlock });
  }

  return { blocks, sections };
}

/**
 * The system blocks, for sending. What almost everything wants.
 */
export function buildReaderChatSystem(
  input: ReaderChatPromptInput
): Anthropic.TextBlockParam[] {
  return assembleReaderChatPrompt(input).blocks;
}

/**
 * The same prompt, split into its four layers, for the panel's inspector.
 *
 * Built by the same pass as the blocks rather than reconstructed, so what the
 * inspector shows cannot drift from what is sent — the same reason the whole
 * context builder is shared with the chat route.
 */
export function buildReaderChatSections(
  input: ReaderChatPromptInput
): PromptSection[] {
  return assembleReaderChatPrompt(input).sections;
}

// ============================================================
// The reader's own preface and afterword
// ============================================================

/**
 * One model for both documents and both of their phases.
 *
 * These are the two things in the reader that are written once and kept, so they
 * get the best model there is and the whole book to write them from — unlike a
 * chat turn, which is one of many and can simply be asked again. There is no
 * picker: nothing about "which model should write the thing I'll still be
 * reading in three years" is a decision worth handing to the reader.
 */
export const BOOK_DOCUMENT_MODEL = "claude-opus-5";

/**
 * Which turn of the work this is.
 *
 * "converse" is the interview — and, once a document exists, anything else the
 * reader wants to say about it. "document" writes the preface or afterword.
 * Deliberately one prompt builder with a branch rather than two: everything
 * above the branch is the same book and the same reader, and the two drifting
 * apart is how an interview starts promising something the document won't do.
 */
export type BookDocumentPhase = "converse" | "document";

/**
 * Both of these are budgets for THINKING PLUS TEXT, which is the trap.
 *
 * This model reasons adaptively before it answers and those tokens come out of
 * the same allowance, so a cap sized to the prose alone silently truncates the
 * prose. The afterword ran into exactly that: an 800-word target under a 2,500
 * ceiling, and every document stopped mid-sentence somewhere in its second
 * half — which read as rambling with no ending, because it was.
 *
 * Sized generously rather than snugly. Nothing here is billed for room it
 * doesn't use, the length is governed by the prompt anyway, and the failure
 * these prevent is invisible: the document looks finished until you read to the
 * bottom of it.
 */
export const BOOK_DOCUMENT_CONVERSE_MAX_TOKENS = 2_000;
export const BOOK_DOCUMENT_WRITE_MAX_TOKENS = 8_000;

/**
 * Interview turns are conversational and want to feel quick; the document is
 * read once and kept. Opus 5 runs adaptive thinking by default, and disabling it
 * has failure modes that low effort doesn't — so the lever here is effort.
 */
export const BOOK_DOCUMENT_EFFORT: Record<BookDocumentPhase, "low" | "high"> = {
  converse: "low",
  document: "high",
};

/** How an earlier templated thread announces itself among the marks. */
const TEMPLATE_MARK_LABEL: Record<ReaderChatTemplate, string> = {
  reading_key: "(an earlier briefing on how to read this book)",
  check_in: "(an earlier check-in — this same conversation, further back)",
};

/** One reader mark, rendered for the model. */
function markBlock(mark: ReaderMark, index: number): string {
  const where = mark.page != null ? ` page="${mark.page}"` : "";
  const lines: string[] = [];
  if (mark.template) lines.push(TEMPLATE_MARK_LABEL[mark.template]);
  if (mark.isChapterSummary) lines.push("(a chapter recap they asked for)");
  if (mark.quote) lines.push(`HIGHLIGHTED: "${mark.quote}"`);
  for (const note of mark.notes) lines.push(`THEIR NOTE: ${note}`);
  for (const ex of mark.exchanges) {
    if (ex.question) lines.push(`THEY ASKED: ${ex.question}`);
    if (ex.answer) lines.push(`ANSWER: ${ex.answer}`);
  }
  return `<mark n="${index + 1}"${where}>\n${lines.join("\n")}\n</mark>`;
}

/** What the reader has finished lately, and what they made of it. */
function historyBlock(ctx: BookDocumentContext): string | null {
  if (ctx.history.length === 0) return null;
  const lines = ctx.history.map((h) => {
    const author = h.author ? ` by ${h.author}` : "";
    const rating = h.rating ? ` — they said: ${h.rating}` : "";
    const when = h.finishedAt ? ` (finished ${h.finishedAt.slice(0, 10)})` : "";
    return `- ${h.title}${author}${when}${rating}`;
  });
  return `<recently_finished>\n${lines.join("\n")}\n</recently_finished>`;
}

/** How the book got onto the shelf, when anyone can say. */
function provenanceBlock(ctx: BookDocumentContext): string | null {
  const parts: string[] = [];
  if (ctx.recommendedBy) parts.push(`Recommended by ${ctx.recommendedBy}.`);
  if (ctx.recommendationNote) parts.push(`They said: "${ctx.recommendationNote}"`);
  if (ctx.genres.length > 0) parts.push(`Genres: ${ctx.genres.join(", ")}.`);
  return parts.length > 0 ? `<how_they_found_it>\n${parts.join("\n")}\n</how_they_found_it>` : null;
}

/**
 * The one-question rule and the evidence rule, which are the whole character of
 * these interviews and are identical for both of them.
 *
 * The evidence rule is the load-bearing half. A question that guesses is worth
 * far more than one that doesn't — it gives the reader something to push against
 * instead of a blank page — but only while the guess comes from something real.
 * A guess assembled from the book's reputation is worse than no guess at all: it
 * sounds knowing, it is unfalsifiable, and agreeing with it is easier than
 * thinking, which is the one thing this is for.
 *
 * The no-menus rule is the one this feature got wrong first, and it took a real
 * transcript to see. Every turn of it was a forced choice — "was it X, or Y?",
 * "for yourself, or to say to your wife?" — and the reader answered "Both" and
 * "Sure, I'm 45", because picking from a list is the cheapest thing in the world
 * to do. An A-or-B is a guess that cannot be wrong, which is exactly why a model
 * reaches for it and exactly why it is worthless here. The fix is not a better
 * question; it is to stop asking one and make a claim instead.
 */
function interviewRules(ctx: BookDocumentContext): string[] {
  const rules = [
    "Ask exactly ONE question per turn. Not two, not a question with parts, " +
      "not a list. A second question in the same turn splits their attention " +
      "and they answer neither well.",
    "Lead with a CLAIM, not a menu. State what you think is true about them — " +
      "specific, falsifiable, in a sentence — and then ask them what is wrong " +
      "with it. \"My guess is you are here because X\" is worth ten times " +
      "\"is it X, or Y?\", because a wrong claim still moves them somewhere " +
      "and a menu never does.",
    "NEVER offer them a choice between two options. No \"is it A, or B?\", no " +
      "\"would you say X, or more Y?\", no \"A — or is it closer to B?\". This " +
      "is the single easiest sentence to write here and the single worst: it " +
      "reads as thoughtful, it cannot be wrong, and the honest reply to it is " +
      "\"both\", which tells you nothing. If you catch yourself building an " +
      "or, throw away the weaker half and assert the stronger one.",
    // The rule above, stated once, gets obeyed in its interrogative form and
    // dodged in every other. The probe that caught this came back with "what
    // I'm less sure of is whether you'd have picked this up on your own, or
    // whether the appeal is that she said together" — no question mark, same
    // menu, same shrug. What is banned is the FORK, not the punctuation.
    "That ban is on the fork itself, however it is dressed. \"What I'm less " +
      "sure of is whether X or Y\", \"the question is whether A or B\", \"I " +
      "can't tell if it's X or Y\" — all of these are the same menu with a " +
      "declarative hat on, and they draw the same useless \"both\". Any turn " +
      "of yours that sets two readings of them side by side and waits is " +
      "broken. Pick the one you actually believe, say it as flatly as you can, " +
      "and let them tell you it is wrong. Being wrong out loud is the job.",
    // Where the fork kept surviving: the claim would land, and then the turn
    // would close on "is that the wariness, or is it that you think you're
    // early?" — the menu smuggled back in as the question. So the closing move
    // is specified, not just the opening one.
    "The sentence that ENDS your turn is one of exactly two things: an " +
      "invitation to correct the claim you just made (\"where's that wrong?\", " +
      "\"what am I missing?\"), or one genuinely open question — one that " +
      "starts with what, how, or why and has no options in it. Never a yes/no, " +
      "and never a fork. Having made a good claim does not buy you a menu at " +
      "the end of it.",
    "Ground the claim in something real in the material below — who they are, " +
      "where they are in their life, a book they finished recently, who " +
      "recommended this one and what they said about it, what they have " +
      "already told you, or (for the afterword) what they actually marked. If " +
      "nothing supports a claim, ask plainly instead. NEVER invent one from " +
      "this book's reputation, from its author, or from what readers generally " +
      "want out of books like it — a guess that sounds knowing but rests on " +
      "nothing is worse than no guess, because agreeing with it is easier than " +
      "thinking.",
    // The other half of what went wrong in that transcript: a two-word answer
    // is the loudest signal in an interview, and the model treated it as a
    // completed turn and moved on. Nothing here told it not to.
    "A short answer is not an answer. If they reply in a few words, or agree " +
      "without adding anything, stay on that subject — say what you think they " +
      "actually mean and let them correct it. Do NOT change the subject: a new " +
      "question after a thin answer wastes the one place they were about to " +
      "say something.",
    "Two or three sentences per turn. This is a conversation, not an essay: " +
      "no preamble, no summarising back what they just said, no praise for " +
      "their answer. Say your piece, ask, and stop.",
    "Never ask them about the app or about the mechanics of reading — how they " +
      "like to take notes, what makes them highlight something, how they want " +
      "this written. That asks them to design the feature instead of think " +
      "about the book.",
    "After four or five exchanges, say you have enough and offer to write it. " +
      "Stop asking the moment they tell you to write it — and if they say so " +
      "on the first turn, that is a complete answer.",
    "If they ask you something instead of answering, answer it and then " +
      "continue where you were.",
  ];
  if (ctx.scope === "preface") {
    rules.push(
      "You are helping them think before they read, not selling them the book " +
        "and not summarising it. The subject of every question is THEM: why " +
        "this book now, what they are bringing to it, what they want out of it, " +
        "what would make it worth the hours."
    );
  } else {
    // The afterword's interview has something a preface's never has: evidence.
    // Every passage they stopped on is a fact about what caught them, which is
    // why this one can open by putting a draft on the table rather than asking
    // an open question. Reacting to a wrong takeaway is far easier than
    // producing a right one cold — and unlike a menu, a wrong one is wrong,
    // so correcting it produces the sentence the document needed.
    rules.push(
      "This interview has ONE job: to settle what they actually took from this " +
        "book. Not how they feel about it, not whether they enjoyed it — the " +
        "handful of things they now think, or think differently, because they " +
        "read it. Everything you ask serves that."
    );
    rules.push(
      "You have their marks, which is real evidence about where they stopped " +
        "and what they wrote. Work from it. Name the thing you think they took " +
        "from a run of marks and let them tell you it is wrong, rather than " +
        "asking them what they took."
    );
    if (ctx.preface) {
      rules.push(
        "You also have the preface they wrote before starting, which says what " +
          "they came for. Use it as the sharpest question you have: they " +
          "wanted a specific thing, and what they marked either delivered it " +
          "or did not. If it plainly did not, say so — that is more useful to " +
          "them than a takeaway they will not recognise."
      );
    }
  }
  return rules;
}

/** What the two documents have in common, said once. */
function writingRules(ctx: BookDocumentContext): string[] {
  return [
    "Address the reader as \"you\". This is written back to them about their " +
      "own reading — not in their voice, and not about the book in the " +
      "abstract.",
    // The preface is one short argument and reads as prose. The afterword is a
    // set of takeaways meant to be lifted out one at a time, so it needs the
    // headings the preface must not have — see its own brief below.
    ctx.scope === "preface"
      ? "Flowing prose. No headings, no bullet lists, no bold labels, no title " +
        "at the top — the app supplies the title. Open with the first real " +
        "sentence. The structure below is the order to write in, not a set of " +
        "sections to label: each part should run into the next."
      : "No title at the top and no bullet lists — the app supplies the title, " +
        "and each takeaway is prose under its own heading, not a bulleted " +
        "note. The only headings are the takeaway headings specified below.",
    // The document is read down a narrow column beside a book. A 150-word
    // paragraph there is a wall, and the fix is paragraphing.
    "Break paragraphs often: one turn of thought each, and never longer than " +
      "about six sentences. This is read down a narrow column, where a long " +
      "block of prose is a wall rather than a paragraph.",
    "Italicise the titles of books and other works with single asterisks " +
      "(*Being and Time*). Nothing else takes emphasis — no bold, and no " +
      "italics for stress.",
    "Do not pad. Cover the substance and stop: no summary of what you just " +
      "said, no closing flourish about the pleasures of reading, no " +
      "restatement of the book's blurb. If you have little to say because " +
      "there is little in the material, write less. A short honest " +
      (ctx.scope === "preface" ? "preface" : "afterword") +
      " is worth more than a long invented one.",
    "Do not praise the book, the author, or the reader.",
    // Left to itself it reaches into the book for a name to stand in for
    // someone in the reader's life — one draft offered "say it out loud to
    // Judith-equivalent" where the reader had said "my wife". Their people are
    // theirs, and the book's are the book's.
    "Refer to the people in the reader's life exactly as they did — \"your " +
      "wife\", \"a friend\". Never borrow a name or a detail from the book to " +
      "stand in for one of them, and never invent one.",
  ];
}

/**
 * What an interview may do with the web, for whichever document it is.
 *
 * The two halves of this differ more than they look. An AFTERWORD is talking to
 * someone who has finished: nothing needs protecting, and "what did the author
 * say this was for" is one of the first things a person wants at the end. A
 * PREFACE is talking to someone holding an unopened book, and its governing
 * rule is that everything said about it must be knowable without reading it.
 *
 * Which is not the same as forbidding search there, and the distinction is the
 * whole design: the preface is ALREADY allowed to draw on the book's general
 * reputation — jacket copy, what it is taken to be, how it landed. Before this
 * it could only do that from memory, which is exactly the failure mode worth
 * removing. Searching doesn't widen what a preface may say; it makes the part
 * it could always say true.
 */
function webSearchRules(ctx: BookDocumentContext): string[] {
  const rules: string[] = [];

  if (ctx.scope === "afterword") {
    rules.push(
      "You can search the web, and this is a good place for it. They have " +
        "finished the book, so nothing needs protecting: what the author has " +
        "said about it, how critics read it, what it was answering, how it " +
        "landed when it came out — all of it is fair game, and it is often " +
        "exactly what someone wants at the end of a book. Search when they " +
        "ask something the book and their marks can't settle, and answer " +
        "from what is in front of you when they can."
    );
    rules.push(
      "What you find never overrules them. The book above is what the book " +
        "says, their marks are what they made of it, and a critic is a third " +
        "party with an opinion. If a critic's account and their experience " +
        "of the book pull apart, that gap is the interesting thing and worth " +
        "putting to them — never a mistake of theirs to correct."
    );
  } else {
    rules.push(
      "You can search the web, and here it is for one thing: what this book " +
        "is KNOWN for. How it was received, what the author has said they " +
        "were doing, what it was answering, what kind of book it is taken to " +
        "be, why people pick it up. That is jacket-and-reputation material, " +
        "which you are already allowed to use — searching just means getting " +
        "it right instead of half-remembering it."
    );
    // The load-bearing rule of the whole preface, restated for the one input
    // that arrives already violating it. A review's second paragraph is the
    // plot; an interview's is what the author was getting at by the end.
    rules.push(
      "Everything you bring back faces the same test as everything else you " +
        "say here: COULD THEY HAVE LEARNED THIS WITHOUT READING THE BOOK? A " +
        "review or an interview will hand you the plot, the ending and the " +
        "author's conclusions on the way past. Take the part that would be on " +
        "the jacket and leave the rest. If you can't tell which part is " +
        "which, say nothing about it — a preface that quietly imports a " +
        "reviewer's account of the ending is the worst thing this can do."
    );
    if (ctx.isStory) {
      rules.push(
        "This one is a story, so almost nothing a search returns about it is " +
          "usable. Expect to find the plot and discard it. What survives is " +
          "the kind of thing a bookshop table would tell them: what sort of " +
          "novel this is, how it was received, what the author is known for."
      );
    }
  }

  // Shared. The first is the reason the tool is here at all — the model's
  // instinct without it is to decline rather than invent, which is right and
  // is also a dead end for the reader.
  rules.push(
    "Never pass off a half-remembered quote as a real one. If you are asked " +
      "what the author said and you are not certain, go and find out — that " +
      "is what the tool is for. Attribute what you bring back: whose reading " +
      "it is, and roughly when or where they said it."
  );
  // Without this the tool quietly rewrites the interview: a model holding a
  // stack of criticism starts quizzing the reader on it, and the one rule that
  // makes these interviews worth doing — every question is about THEM — goes
  // out from under it.
  rules.push(
    "Searching does not loosen the rule about guesses. A question is still " +
      "built on what THEY marked, said and read, never on the book's " +
      "reputation. What you find is for answering what they ask you, not for " +
      "generating things to ask them."
  );
  rules.push(
    "Do not write out URLs or list your sources: the app puts the links " +
      "underneath your answer."
  );

  return rules;
}

/**
 * Whether a preface/afterword turn may search the web: either interview, and
 * neither writing turn. The reasoning is with `canSearch` in
 * buildBookDocumentSystem, which calls this.
 *
 * Exported so the route arms the tool from the same predicate that writes the
 * rules. Handing the model a search tool the prompt never mentions — or rules
 * about searching with no tool to do it — are both silent failures, and the two
 * live in different files.
 */
export function bookDocumentCanSearch(
  scope: BookDocumentContext["scope"],
  phase: BookDocumentPhase
): boolean {
  // `scope` is unused now that both documents may search. Kept in the signature
  // because the two differ so much in what they may DO with a result (see
  // webSearchRules) that a future "not this one" belongs here, not at a call site.
  void scope;
  return phase === "converse";
}

/**
 * The system blocks for a preface or afterword, in either phase.
 *
 * Ordering is for the cache, and it is the reverse of the anchored chat's. The
 * book goes FIRST, with the breakpoint on it, so one cached prefix serves both
 * documents and both phases for a given book — an interview is many turns, and
 * re-reading a novel on each of them would be the whole cost of the feature. The
 * reader's own material takes the second breakpoint for the same reason: it is
 * large on a heavily-marked book and stable across a sitting. Only the rules and
 * the ask below them are volatile.
 */
export function buildBookDocumentSystem(
  ctx: BookDocumentContext,
  phase: BookDocumentPhase,
  options?: {
    /** Whether the transcript carries notes the reader wrote to themselves. */
    hasReaderNotes?: boolean;
  }
): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [];

  const author = ctx.bookAuthor ? ` author="${ctx.bookAuthor}"` : "";
  const contents =
    ctx.chapters.length > 0
      ? `<contents>\n${ctx.chapters.map(contentsLine).join("\n")}\n</contents>\n`
      : "";
  blocks.push({
    type: "text",
    text: `<book title="${ctx.bookTitle}"${author}>\n${contents}${ctx.bookText}\n</book>`,
    cache_control: { type: "ephemeral" },
  });

  // Everything about this reader, as opposed to about this book.
  const reader: string[] = [];
  const profile = readerProfileBlock(ctx.profile);
  if (profile) reader.push(profile);
  const provenance = provenanceBlock(ctx);
  if (provenance) reader.push(provenance);
  const history = historyBlock(ctx);
  if (history) reader.push(history);
  if (ctx.preface) {
    reader.push(
      `<their_preface>\nBefore reading, they wrote this about why they were ` +
        `reading it:\n\n${ctx.preface}\n</their_preface>`
    );
  }
  if (ctx.marks) {
    reader.push(
      ctx.marks.length > 0
        ? `<their_marks count="${ctx.markCount}">\n` +
            `Everything they marked in this book, in reading order.\n` +
            ctx.marks.map(markBlock).join("\n") +
            // Not "later marks" any more: what survives the budget is no longer
            // a prefix of the list, because anything they starred is held back
            // from the trim. Which ones those are is deliberately not said —
            // see ReaderMark.starred.
            (ctx.marksTruncated
              ? `\n(Some marks omitted for length — there were ${ctx.markCount} in ` +
                `all, and everything they starred is here.)`
              : "") +
            `\n</their_marks>`
        : `<their_marks count="0">\nThey marked nothing in this book.\n</their_marks>`
    );
  }
  if (reader.length > 0) {
    blocks.push({
      type: "text",
      text: reader.join("\n\n"),
      cache_control: { type: "ephemeral" },
    });
  }

  /**
   * Whether this turn may search the web: either interview, neither writing
   * turn.
   *
   * An interview is a conversation, so a question like "what has the author
   * said about this" has somewhere to be asked and answered, and a person is
   * reading the answer as it arrives. What each document may DO with a result
   * differs enormously — see webSearchRules — but both may look.
   *
   * The writing turns are left out for reasons that are not about permission.
   * They are handed the whole transcript, so anything the interview found is
   * already in front of them; a single long generation that stops to search
   * would keep the reader waiting on the one turn where waiting is worst; and
   * the tool's absence keeps the document grounded in what they marked and said
   * rather than in what the book is known for.
   */
  const canSearch = bookDocumentCanSearch(ctx.scope, phase);

  // Volatile: the rules for this phase, and the ask.
  //
  // LAYER 1 first, and it is the same agent the chats get — a preface, an
  // afterword and a mid-book conversation are the same person doing different
  // jobs, and they read as one app only if that is literally true rather than
  // separately drafted three times. `isStory` rather than a raw fiction flag
  // because that is what this context carries; it falls back to the book's
  // spoiler switch for anything unclassified.
  const rules: string[] = [
    agentPrompt(ctx.isStory),
    "You are writing inside one person's private reading app. The book above " +
      "is the whole book, and everything below it is what is known about this " +
      "reader." +
      (canSearch
        ? " Those two are your primary sources and outrank everything else. " +
          "Never work from what you merely RECALL of this work, its author or " +
          "its reputation — but you can search the web, and what you find " +
          "there is a real source you may use. See the rules on it below."
        : " Work from those and nothing else — never from what you recall " +
          "of this work, its author, its adaptations or its reputation."),
  ];

  if (ctx.truncated) {
    rules.push(
      "A stretch of the book's middle was too long to include and has been " +
        "elided, marked as such in the text. Work from what you were given."
    );
  }

  if (ctx.scope === "preface") {
    rules.push(
      "This is the reader's PREFACE: their own front matter, written before " +
        "they start the book, about why they are reading it and what they want " +
        "from it. It is not a review, a summary, or a reading plan."
    );

    // The rule that governs everything a preface says about the book, and the
    // one this feature got wrong first: a preface was told it could "say
    // plainly what the book argues", read that as license to report where the
    // author personally lands, and asked the reader whether they had been
    // drawn to a destination three hundred pages in. Both halves of that are
    // failures — it gave away the ending, and it asked a question nobody who
    // hadn't read the book could answer.
    //
    // Stated as a test the model can actually apply, rather than a list of
    // things not to mention. "Could they have known this before opening it?"
    // is answerable about any given sentence; "is this a spoiler?" is not,
    // which is how a cave in New Mexico gets through.
    rules.push(
      "THE READER HAS NOT OPENED THIS BOOK. Everything you say about it must " +
        "be something they could already have learned WITHOUT reading it: " +
        "from the cover, the jacket copy, the contents, the opening pages, or " +
        "its general reputation. You were given the whole book so that you " +
        "understand what they are walking into — not so that you can tell " +
        "them. Never mention where it ends up, what it concludes, what the " +
        "author comes to believe, or any scene, anecdote, argument or turn " +
        "from beyond its opening. Never cite a page: a [p.284] here points " +
        "somewhere they cannot go and says out loud that you have read ahead."
    );
    rules.push(
      "It follows that a question can never assume they know something from " +
        "inside the book. \"What drew you — X, or the fact that the author " +
        "ends up doing Y?\" is broken twice over: they cannot answer it, " +
        "because they do not know Y, and asking it is how they find out. Your " +
        "guesses are about THEM — what they have read lately, who recommended " +
        "this and what that person said, what they have already told you — " +
        "and about what the book advertises itself to be, never about what it " +
        "turns out to contain."
    );

    if (ctx.isStory) {
      rules.push(
        "This one is a story, so hold that line hard. Never reveal, hint at " +
          "or foreshadow anything that happens — not the plot, not a turn, " +
          "not a character who is not what they seem, and not \"pay attention " +
          "to X\". Knowing there is something to notice is itself a spoiler. " +
          "The subject of every question is the reader, not the book."
      );
    } else {
      rules.push(
        "This one is not a story, so you may name what the book is about, the " +
          "questions it takes up, and how it is organised — jacket-and-" +
          "contents level, the sort of thing they would get from a bookshop " +
          "table. Use that to sharpen what you ask: which of the questions it " +
          "takes on are the ones they came for, and what it looks like it " +
          "will not cover despite its title. What you must still not do is " +
          "report its findings, its conclusions, or where the author " +
          "personally lands — that is the reading, and it is theirs to do."
      );
    }
  } else {
    rules.push(
      "This is the reader's AFTERWORD: their own back matter, and the one " +
        "thing this book leaves behind. It is a set of TAKEAWAYS — the handful " +
        "of things they now think, or think differently, because they read " +
        "this. Not a review, not a summary, and not an account of how the " +
        "reading went. Assume they read the whole thing: the app does not " +
        "reliably know where anyone stopped, and hedging about it in a " +
        "document meant to outlast the reading is worse than being wrong about " +
        "it. Nothing in the book needs protecting."
    );

    // The line the whole document is written to, and the one it was failing
    // before: an afterword that opens "Koch's doubts about physicalism" is
    // useless to the person it is FOR, who by then will not remember who Koch
    // was, what physicalism was, or why either mattered to them.
    rules.push(
      "WRITE IT FOR THEM FIVE YEARS FROM NOW, when they have forgotten this " +
        "book almost completely. That is the whole job. They will not remember " +
        "the argument, the people in it, the vocabulary, or why they cared. " +
        "Every sentence has to survive that. Introduce each person, term and " +
        "idea the first time it appears — \"Christof Koch, a neuroscientist " +
        "who had spent his career sure that consciousness was physical\", not " +
        "\"Koch\" — and never use a word like panpsychism as though it still " +
        "means something to them."
    );

    rules.push(
      "Their marks are the evidence, and the only evidence. Every takeaway " +
        "must trace to something they actually highlighted, wrote, or asked. " +
        "If they marked almost nothing, say the record is thin and write the " +
        "one or two takeaways it supports. What you must NOT do is turn the " +
        "marks into a list: a run of quotations each followed by a page number " +
        "is an index, and an index is the one thing they can already generate " +
        "for themselves."
    );
    rules.push(
      "If this conversation contains answers they gave you, those outrank " +
        "everything else. A highlight is a guess about what someone thought; " +
        "a sentence they typed is what they thought. Where the two disagree, " +
        "believe them, and use their own words rather than your inference."
    );
  }

  // Both documents, and only in the interview. Placed after the scope's own
  // rules so the test a result has to pass — theirs to use, or theirs to
  // discard — is already established when the tool is granted.
  if (canSearch) rules.push(...webSearchRules(ctx));

  // Afterword only. A citation is a way back to a page you have read, which is
  // the whole of its value here — and in a preface it is worse than useless: a
  // reference to page 284 of a book you have not opened both points somewhere
  // you cannot go and advertises that the thing talking to you has read ahead.
  if (ctx.hasPageMarkers && ctx.scope === "afterword") {
    rules.push(
      "The book text contains page markers like [p.212]. When you quote or " +
        "point at something in it, cite the nearest preceding marker in " +
        "exactly that bracketed form — never page numbers in prose. The app " +
        "turns [p.212] into a tap back to the page."
    );
  }

  // Same rule as the anchored chat's, and for the same reason: hiding the
  // reader's own writing from the thing they are talking to makes a follow-up
  // that says "that" mean something different to each side.
  if (options?.hasReaderNotes) {
    rules.push(
      "Some lines in this conversation are marked [Reader's note]. Those are " +
        "the reader thinking on the page, not questions or answers to you — " +
        "they were written without expecting a reply. Treat them as context " +
        "for what they believe and care about."
    );
  }

  if (phase === "converse") {
    rules.push(...interviewRules(ctx));
    rules.push(
      ctx.scope === "preface"
        ? "If there is nothing from the reader yet, this turn is your opening " +
          "question. Do not greet them, explain yourself, or describe what you " +
          "are about to do — lead with the claim, then the question."
        : // The afterword opens with a draft rather than a question. It can,
          // because by now it has evidence: the passages they stopped on are
          // facts about what caught them, and naming what those add up to is a
          // claim they can knock down. A reader who is handed two wrong
          // takeaways will tell you the right one in a sentence; the same
          // reader asked "what did you take from this?" says "not sure".
          "If there is nothing from the reader yet, this turn puts a draft on " +
          "the table. Name the two or three things you believe they took from " +
          "this book, one short sentence each, drawn from what they actually " +
          "marked — then ask which of them are wrong and what you have missed. " +
          "Do not greet them or explain yourself. This is the one turn allowed " +
          "more than one idea in it, because they are reacting rather than " +
          "answering; every turn after it follows the one-question rule."
    );
  } else {
    rules.push(...writingRules(ctx));
    if (ctx.scope === "preface") {
      rules.push(
        "Write the preface now, in 150 to 250 words. Open with why they are " +
          "reading this book now. Then what they are bringing to it. Close on " +
          "what would make it worth the time, in their terms rather than " +
          "yours. Ground all of it in what they actually said — where they " +
          "said nothing, write less rather than inventing a motive for them." +
          (ctx.isStory
            ? " Nothing about what happens in the book."
            : " One or two sentences on which of the questions this book takes " +
              "up bear on what they came for, and what it looks like it will " +
              "not cover despite its title — but not what it concludes.")
      );
    } else {
      // The shape of this document, and the reason it is not an essay.
      //
      // It used to open with a long recap written for the reader five years on,
      // then say how the book landed, then what they took. That recap is the
      // part they can regenerate on demand any time they want it, and it was
      // crowding out the part they cannot: the specific things they now think.
      // So the takeaways became the whole body — and, because each one is meant
      // to be lifted out of here and filed somewhere else eventually, each one
      // has to carry the context that makes it legible on its own.
      rules.push(
        "Write the afterword now. Do not open with a dateline or any " +
          "statistics — the app puts those above your first line."
      );
      rules.push(
        "SHAPE. One sentence first, naming what this book was — no more than " +
          "one, and no recap: they can ask for a summary any time they want " +
          "one, and it is not what this document is for. Then the takeaways, " +
          "which are the whole of the rest of it."
      );
      rules.push(
        "EACH TAKEAWAY is a markdown heading (\"## \") naming the idea, then " +
          "100 to 200 words underneath it. The heading is the idea in a phrase, " +
          "in plain words rather than the book's vocabulary — a sentence " +
          "fragment they would recognise years later, not a label like " +
          "\"On attention\". The paragraphs under it do three things, run " +
          "together as prose: state the idea plainly, say what in the book " +
          "produced it, and — where they actually said something — say what " +
          "they made of it."
      );
      // The rule that makes these notes rather than sections. Written as a
      // test, because "make it self-contained" is advice and "read it with the
      // others deleted" is something the model can actually check.
      rules.push(
        "THE TEST EVERY TAKEAWAY MUST PASS: it has to read correctly with all " +
          "the others deleted. Assume this one is the only thing they ever see " +
          "again — no \"as above\", no \"this second point\", no term " +
          "introduced in an earlier takeaway and used bare in this one, no " +
          "pronoun pointing at something outside its own paragraphs. Each " +
          "carries its own grounding, which is why there is no recap above " +
          "them."
      );
      rules.push(
        "HOW MANY: as many as the book earned, and no more. A heavily-marked " +
          "book might give five or six; one they marked twice gives two, and " +
          "you say the record is thin rather than padding to a respectable " +
          "number. There is no target. A takeaway they will not recognise as " +
          "theirs is worse than a short afterword."
      );
      rules.push(
        "WHAT COUNTS AS A TAKEAWAY: something they now think. An idea they " +
          "have taken on, a belief the book sharpened or broke, a distinction " +
          "they did not have before, a question it left them holding. Not " +
          "\"the book argues X\" — that is a fact about the book. If you " +
          "cannot say why it matters to THIS reader, it is not one of theirs."
      );
      if (ctx.preface) {
        rules.push(
          "They wrote a preface before starting, saying what they came for. If " +
            "what they marked answers it, one of the takeaways should be that " +
            "answer. If they came for one thing and left with another, say so " +
            "plainly in the takeaway it belongs to — that is the most useful " +
            "thing in this document and the one only you can see."
        );
      }
      rules.push(
        "Quote sparingly: at most one short highlight per takeaway, worked " +
          "into your own sentences, and only where their words say it better " +
          "than yours would. Cite a page only where the quote is worth going " +
          "back to. A takeaway carrying three quotations and three citations " +
          "is an index of their highlights, which is not what this is for."
      );
    }
  }

  blocks.push({ type: "text", text: rules.join("\n\n") });

  return blocks;
}
