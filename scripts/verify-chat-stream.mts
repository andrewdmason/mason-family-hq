/**
 * The reader chat's wire format, checked against streams that arrive badly.
 *
 * Everything here fails silently in production if it's wrong, which is why it's
 * measured rather than reasoned about:
 *
 *  - A STATUS FRAME MUST NEVER REACH THE BUBBLE. It's a control character and
 *    some text; rendered by mistake it appears as an invisible glyph followed by
 *    the words "Searching the web…" wedged into the middle of the answer, and
 *    then persists in the message row forever.
 *  - TWO STATUSES CAN REPLACE EACH OTHER WITH NO CLEAR IN BETWEEN. Deep thinks
 *    and searches in the same turn, and the route only sends a frame when the
 *    line changes — so "Thinking…" is followed directly by "Searching the web…"
 *    rather than by a clear. Every earlier case here had at most one status in
 *    flight, which is the assumption this breaks.
 *  - A FRAME SPLIT ACROSS CHUNKS IS THE NORMAL CASE, not the edge case. The
 *    network decides where the boundaries fall, and the separator, the status
 *    text and the terminating newline routinely land in different reads.
 *  - MULTI-BYTE CHARACTERS MUST SURVIVE THE SPLIT. The answer is full of em
 *    dashes and curly quotes, and a UTF-8 sequence cut in half by a chunk
 *    boundary must not become a replacement character.
 *  - THE ERROR TAIL MUST STILL BE READ. It's how a dead turn is told apart from
 *    a finished one, and the frame handling runs in front of it.
 *
 * The streams are driven at every chunk size from one byte upward, so any
 * arithmetic that only works when a frame arrives whole is caught immediately.
 *
 *   npx tsx scripts/verify-chat-stream.mts
 */

import { statusFrame, streamReply } from "../src/lib/reading/chat-stream";
import {
  buildReaderChatSections,
  buildReaderChatSystem,
  type PromptSection,
  type ReaderChatPromptInput,
  READER_CHAT_DEEP_EFFORT,
  READER_CHAT_DEEP_MAX_TOKENS,
  READER_CHAT_DEEP_MODEL,
  READER_CHAT_FAST_MODEL,
  READER_CHAT_MAX_TOKENS,
  READER_CHAT_PROMOTION_MODEL,
  THINKING_STATUS,
  type ReaderChatDepth,
} from "../src/lib/reading/chat-prompt";
import { SEARCHING_STATUS } from "../src/lib/reading/web-sources";
import { INLINE_RE } from "../src/components/reading/annotations/chat-message-text";

let failures = 0;

function check(what: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    // Indented ones are the detail lines of a failure above; don't announce them.
    if (!what.startsWith(" ")) console.log(`  ✓ ${what}`);
    return;
  }
  failures += 1;
  console.error(`  ✗ ${what}\n      got      ${a}\n      expected ${e}`);
}

/** A stream that hands out `size` bytes at a time, splitting anything. */
function chunked(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

type Run = { text: string; statuses: (string | null)[]; error: string | null };

async function run(wire: string, size: number): Promise<Run> {
  const statuses: (string | null)[] = [];
  let text = "";
  const error = await streamReply(
    chunked(wire, size),
    (soFar) => {
      text = soFar;
    },
    (status) => statuses.push(status)
  );
  return { text, statuses, error };
}

/**
 * Every chunk size from 1 byte to the whole thing at once. One byte is the
 * cruel case and the one that matters: it puts a read boundary inside the
 * separator's own frame, inside the status text, and inside every multi-byte
 * character in the answer.
 */
async function forEverySplit(
  name: string,
  wire: string,
  expected: Omit<Run, never>
) {
  const sizes = [];
  for (let s = 1; s <= new TextEncoder().encode(wire).length; s++) sizes.push(s);
  let worst: { size: number; got: Run } | null = null;
  for (const size of sizes) {
    const got = await run(wire, size);
    if (
      got.text !== expected.text ||
      JSON.stringify(got.statuses) !== JSON.stringify(expected.statuses) ||
      got.error !== expected.error
    ) {
      worst = { size, got };
      break;
    }
  }
  if (worst) {
    failures += 1;
    console.error(`  ✗ ${name} — first failure at ${worst.size}-byte chunks`);
    check("  text", worst.got.text, expected.text);
    check("  statuses", worst.got.statuses, expected.statuses);
    check("  error", worst.got.error, expected.error);
  } else {
    console.log(`  ✓ ${name} (${sizes.length} chunk sizes)`);
  }
}

console.log("chat stream");

// The ordinary searched answer: search first, status cleared the moment the
// first character of prose arrives, sources appended at the end.
await forEverySplit(
  "search, then answer, then sources",
  statusFrame("Searching the web…") +
    statusFrame(null) +
    "Towton was real — about 28,000 died.\n\nSources: [Battle of Towton](https://en.wikipedia.org/wiki/Battle_of_Towton)",
  {
    text: "Towton was real — about 28,000 died.\n\nSources: [Battle of Towton](https://en.wikipedia.org/wiki/Battle_of_Towton)",
    statuses: ["Searching the web…", null],
    error: null,
  }
);

// No search at all — the overwhelmingly common turn. Not one status callback.
await forEverySplit("an answer with no search", "The text doesn't say.", {
  text: "The text doesn't say.",
  statuses: [],
  error: null,
});

// A second search after the model has already started talking. This is the case
// that makes the status a stream signal rather than a header.
await forEverySplit(
  "a search that starts mid-answer",
  "One moment — " +
    statusFrame("Searching the web…") +
    statusFrame(null) +
    "it was 1461.",
  {
    text: "One moment — it was 1461.",
    statuses: ["Searching the web…", null],
    error: null,
  }
);

// The failure marker still has to be found with frames in front of it.
await forEverySplit(
  "a turn that dies after searching",
  statusFrame("Searching the web…") + "\n\n[error: overloaded_error]",
  {
    text: "\n\n[error: overloaded_error]",
    statuses: ["Searching the web…"],
    error: "overloaded_error",
  }
);

// Page citations and em dashes are what the answers are actually made of, and
// both must come through a one-byte-at-a-time stream unharmed.
await forEverySplit(
  "citations and multi-byte characters",
  statusFrame("Searching the web…") +
    statusFrame(null) +
    "She says so at [p.212] — “plainly”, even.",
  {
    text: "She says so at [p.212] — “plainly”, even.",
    statuses: ["Searching the web…", null],
    error: null,
  }
);

// Deep's ordinary turn. The thinking is never shown, so this line is the only
// thing standing between the reader and an empty bubble.
await forEverySplit(
  "think, then answer",
  statusFrame(THINKING_STATUS) +
    statusFrame(null) +
    "He's telling you what he wishes had happened.",
  {
    text: "He's telling you what he wishes had happened.",
    statuses: [THINKING_STATUS, null],
    error: null,
  }
);

// The case the route's only-send-on-change rule creates: one status replacing
// another with no clear between them, twice over. Nothing before this sent two
// non-empty frames back to back.
await forEverySplit(
  "thinking and searching, swapping without a clear",
  statusFrame(THINKING_STATUS) +
    statusFrame(SEARCHING_STATUS) +
    statusFrame(THINKING_STATUS) +
    statusFrame(null) +
    "Nabokov called it that in 1967 — “a shattering”.",
  {
    text: "Nabokov called it that in 1967 — “a shattering”.",
    statuses: [THINKING_STATUS, SEARCHING_STATUS, THINKING_STATUS, null],
    error: null,
  }
);

// A turn that dies while thinking leaves the line standing unless the marker is
// still found underneath it.
await forEverySplit(
  "a turn that dies while thinking",
  statusFrame(THINKING_STATUS) + "\n\n[error: overloaded_error]",
  {
    text: "\n\n[error: overloaded_error]",
    statuses: [THINKING_STATUS],
    error: "overloaded_error",
  }
);

// A status carrying a newline would end its own frame early and spill the rest
// into the bubble. statusFrame flattens whitespace so it can't.
check(
  "statusFrame flattens newlines",
  statusFrame("Searching\nthe web"),
  "Searching the web\n"
);
check("statusFrame(null) is a bare clear", statusFrame(null), "\n");

// ============================================================
// The other half: what the panel does with the line once it has it.
// ============================================================
//
// The sources line is markdown the route writes, not the model, so it has to
// come out as links every time — and adding a link rule to a regex that already
// owns "[p.212]" is exactly the kind of change that quietly breaks the older
// one. Both are checked against the same expression.

console.log("\nsources line");

function tokens(source: string) {
  const re = new RegExp(INLINE_RE.source, "g");
  const out: { kind: string; a: string; b?: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const [, page, bold, italic, code, linkText, linkHref] = m;
    if (page != null) out.push({ kind: "page", a: page });
    else if (bold != null) out.push({ kind: "bold", a: bold });
    else if (italic != null) out.push({ kind: "italic", a: italic });
    else if (code != null) out.push({ kind: "code", a: code });
    else out.push({ kind: "link", a: linkText, b: linkHref });
  }
  return out;
}

check("a citation stays a citation, not a broken link", tokens("She says so at [p.212]."), [
  { kind: "page", a: "212" },
]);

check(
  "the sources line becomes links",
  tokens(
    "Sources: [Battle of Towton](https://en.wikipedia.org/wiki/Battle_of_Towton) · [britannica.com](https://www.britannica.com/event/x)"
  ),
  [
    {
      kind: "link",
      a: "Battle of Towton",
      b: "https://en.wikipedia.org/wiki/Battle_of_Towton",
    },
    { kind: "link", a: "britannica.com", b: "https://www.britannica.com/event/x" },
  ]
);

check(
  "a citation and a source in the same answer",
  tokens("It's at [p.7], and confirmed by [a source](https://example.com/a)."),
  [
    { kind: "page", a: "7" },
    { kind: "link", a: "a source", b: "https://example.com/a" },
  ]
);

// A bare URL is left as plain text rather than half-matched into a link, which
// is part of why the model is told not to write them.
check("a bare URL is not a link", tokens("See https://example.com for more."), []);

// ============================================================
// What Deep is given to think with.
// ============================================================
//
// Both of these fail silently. A shared reply budget doesn't error, it
// truncates — and a remark cut off mid-sentence still reads like a remark, so
// nothing downstream can tell.
//
// The effort level is pinned because lowering it looks like a free latency win
// and is not: measured on this prompt shape, adaptive thinking does not engage
// at all below high, so anything less quietly turns the feature off while
// leaving every sign of it in place — the config, the status line, the picker
// that promises it. See READER_CHAT_DEEP_EFFORT for the numbers.

console.log("\ndeep settings");

check(
  "thinking gets its own room, on top of the reply",
  READER_CHAT_DEEP_MAX_TOKENS > READER_CHAT_MAX_TOKENS,
  true
);
check(
  "at an effort that actually engages it",
  READER_CHAT_DEEP_EFFORT,
  "high"
);

// ============================================================
// What the picker actually changes.
// ============================================================
//
// The failure this section exists for: the picker changed the model and nothing
// else. The system prompt was assembled before the model was chosen and took no
// argument for the reader's choice, so Deep bought a stronger model and then
// read Fast's instruction telling it to write "a remark in the margin, not an
// essay". Every symptom followed from that one omission — Deep felt like Fast
// with a delay, and a chat window running the same model with no instructions
// at all produced a far better conversation about the same book.

console.log("\nthe four layers");

/** A minimal prompt input; every check below varies one thing about it. */
const chatInput = (depth: ReaderChatDepth): ReaderChatPromptInput => ({
  bookTitle: "The Unconsoled",
  bookAuthor: "Kazuo Ishiguro",
  bookText: "Once, a porter carried three suitcases across a lobby.",
  hasPageMarkers: false,
  hasChapterMarkers: false,
  chapters: [],
  fiction: null,
  spoilerFree: false,
  contextThroughPage: null,
  readerPosition: null,
  quotedText: null,
  hasReaderNotes: false,
  readerIntent: null,
  readerProfile: null,
  depth,
  template: null,
  priorCheckIns: null,
  priorCheckInsTruncated: false,
});

/**
 * The prompt is assembled from four layers — agent, brief, constraints, context
 * — and they are checked as layers rather than as strings wherever possible.
 * The old tests asserted exact sentences, which meant every rewording broke
 * them without ever testing the thing that mattered.
 */
const sectionsFor = (over: Partial<ReaderChatPromptInput> = {}): PromptSection[] =>
  buildReaderChatSections({ ...chatInput("deep"), ...over });

const layersOf = (over: Partial<ReaderChatPromptInput> = {}) =>
  sectionsFor(over).map((s) => s.layer);
const layerText = (layer: string, over: Partial<ReaderChatPromptInput> = {}) =>
  sectionsFor(over)
    .filter((s) => s.layer === layer)
    .map((s) => s.text)
    .join("\n");

check(
  "every prompt opens agent, brief, constraints",
  layersOf().slice(0, 3),
  ["agent", "brief", "constraints"]
);
check(
  "and everything after that is context",
  layersOf().slice(3).every((l) => l === "context"),
  true
);
// The layers exist to be looked at. A split nobody can see stops being true.
check(
  "the sections carry the same text the blocks do",
  sectionsFor()
    .map((s) => s.text)
    .join("\n\n") ===
    buildReaderChatSystem(chatInput("deep"))
      .map((b) => b.text)
      .join("\n\n"),
  true
);

console.log("\nthe agent");

check(
  "a novel gets the literature teacher",
  layerText("agent", { fiction: true }).includes(
    "a great literature professor and teacher"
  ),
  true
);
check(
  "an argument gets a teacher on its subject",
  layerText("agent", { fiction: false }).includes(
    "a great teacher on the subject this book is about"
  ),
  true
);
check(
  "an unclassified book gets a plain teacher",
  layerText("agent", { fiction: null }).includes("the role of a great teacher:"),
  true
);
// Named rather than described. Which agent a book gets is the most consequential
// line in its prompt and the hardest to check by eye — the two personas are four
// sentences each and read alike at a glance, so a wrong classification looks
// like a subtly odd answer rather than like a mistake.
check(
  "each agent says which one it is",
  [true, false, null].map(
    (f) => sectionsFor({ fiction: f }).find((s) => s.layer === "agent")?.title
  ),
  ["Literature professor", "Subject teacher", "Generalist"]
);
// Both are TEACHERS. The prompts had grown an adversarial streak nobody asked
// for — demanding an argument, testing whether the evidence bore the weight put
// on it, saying when it found a book unconvincing. It reads as rigour and is
// the wrong relationship.
// Both are TEACHERS, and the whole guard against the adversarial drift is now
// that word rather than a sentence disclaiming the alternative. Judging a book
// is easier to write than teaching it and sounds smarter, so it keeps coming
// back — if it returns, this is where to look first.
check(
  "both agents are framed as teachers",
  [true, false, null].every((f) => layerText("agent", { fiction: f }).includes("teacher")),
  true
);
check(
  "and the old examiner framing is gone for good",
  layerText("agent", { fiction: false }).includes(
    "whether the evidence bears the weight put on it"
  ),
  false
);
// The bar for anything in this layer: would an unprompted Claude get it wrong?
// A model does not need telling to use contractions, so that line went — along
// with everything else describing HOW to talk rather than who is talking.
check(
  "the agent says who is talking and nothing about how to talk",
  layerText("agent", { fiction: true }).includes("Talk the way a person talks"),
  false
);
// A bound rather than a sentence count: the point is that this layer stays
// small enough to read at a glance, which is what stops it accreting.
check(
  "and every agent stays under 200 characters",
  [true, false, null].every((f) => layerText("agent", { fiction: f }).length < 200),
  true
);
// The agent is who is talking, not what this turn is. It must not move when the
// surface or the model does.
check(
  "the agent is the same on every surface",
  layerText("agent", { template: "check_in" }) === layerText("agent", { template: null }),
  true
);
check(
  "and does not change with the model picked",
  layerText("agent", { depth: "fast" }) === layerText("agent", { depth: "deep" }),
  true
);

console.log("\nthe brief");

// The largest deletion in the rewrite. Fast/Deep used to mean two things at
// once — which model answers, and what shape the answer takes — and the second
// fought every brief that wanted a conversation. It is a model picker now.
check(
  "the model picker no longer changes the register",
  layerText("brief", { depth: "fast" }) === layerText("brief", { depth: "deep" }),
  true
);
check(
  "and neither do the constraints",
  layerText("constraints", { depth: "fast" }) ===
    layerText("constraints", { depth: "deep" }),
  true
);
check(
  "the old Deep register is gone entirely",
  layerText("brief").includes("HAVE A POSITION AND COMMIT TO IT") ||
    layerText("brief").includes("Interpretation is the JOB here") ||
    layerText("brief").includes("They want an argument about this book") ||
    layerText("brief").includes("The reader chose the DEEP conversation"),
  false
);
check(
  "an anchored chat lets the question set the length",
  layerText("brief").includes("Let the question set the length"),
  true
);

// Each surface gets its own brief, and only its own.
check(
  "the key's brief is the machinery rule",
  layerText("brief", { template: "reading_key" }).includes(
    "A KEY DESCRIBES THE MACHINERY; A SPOILER DESCRIBES THE OUTPUT"
  ),
  true
);
check(
  "and it is told to use the whole book rather than decline",
  layerText("brief", { template: "reading_key" }).includes("Use the whole book to do it"),
  true
);
check(
  "the check-in's brief is a class discussion",
  layerText("brief", { template: "check_in" }).includes(
    "the type of interaction they might get in a class"
  ),
  true
);
check(
  "and it opens the conversation rather than answering one",
  layerText("brief", { template: "check_in" }).includes(
    "kick things off with something interesting"
  ),
  true
);
// The reader's marks are gone from this conversation entirely — see the context
// checks below — so the brief says nothing about them either. An instruction not
// to lean on something you were never given is one more thing to read and a
// small invitation to go looking for it.
check(
  "the brief carries no instruction about marks",
  layerText("brief", { template: "check_in" }).includes("Don't oversteer toward them"),
  false
);
check(
  "and it holds the spoiler line while holding the whole book",
  layerText("brief", { template: "check_in" }).includes(
    "don't give away spoilers that go into parts they haven't read"
  ),
  true
);
check(
  "and it remembers the earlier ones",
  layerText("brief", { template: "check_in" }).includes("<earlier_check_ins>"),
  true
);
check(
  "the two templates are different briefs",
  layerText("brief", { template: "check_in" }) !==
    layerText("brief", { template: "reading_key" }),
  true
);
// A template chat is about the book; an ordinary one is about the passage under
// it. Getting this backwards pointed a six-hundred-page check-in at the last
// three pages the reader had turned.
check(
  "a template is not framed as anchored to a spot",
  layerText("brief", { template: "check_in" }).includes("anchored to a spot in the text"),
  false
);
check(
  "but an ordinary chat is",
  layerText("brief").includes("anchored to a spot in the text"),
  true
);

console.log("\nthe constraints");

// These are orthogonal to who is talking and to what the turn is, which is why
// they are their own layer. What matters is that each one fires on its own
// condition and on nothing else.
check(
  "a scoped chat is told where the boundary is",
  layerText("constraints", { spoilerFree: true, contextThroughPage: 90 }).includes(
    "SPOILERS: the reader has read up to page 90"
  ),
  true
);
check(
  "and an unscoped one is not",
  layerText("constraints").includes("SPOILERS: the reader has read up to"),
  false
);
check(
  "the text outranks the web either way",
  layerText("constraints").includes("outranks anything you find"),
  true
);
check(
  "page citations are asked for when there are page markers",
  layerText("constraints", { hasPageMarkers: true }).includes("[p.212]"),
  true
);
check(
  "and not when there are none",
  layerText("constraints", { hasPageMarkers: false }).includes("[p.212]"),
  false
);

console.log("\nthe context");

const withHistory = sectionsFor({
  readerPosition: { page: null, percent: 40 },
  template: "check_in",
  priorCheckIns: [
    {
      page: 40,
      quote: null,
      notes: [],
      exchanges: [
        { question: "Let's check in on how this is going.", answer: "Watch Gustav." },
      ],
      isChapterSummary: false,
      template: "check_in",
      starred: false,
    },
  ],
});
const historyText = withHistory
  .filter((s) => s.layer === "context")
  .map((s) => s.text)
  .join("\n");

check(
  "the book is context, and cached",
  withHistory.some((s) => s.layer === "context" && s.title === "The book" && s.cached),
  true
);
check(
  "earlier check-ins are their own cached block",
  withHistory.some(
    (s) => s.layer === "context" && s.title === "Earlier check-ins" && s.cached
  ),
  true
);
check(
  "and carry what was actually said",
  historyText.includes("Watch Gustav"),
  true
);

// A FIRST check-in must be told so out loud. Silence produced a transcript that
// opened "Last time I said watch what happens to Ryder's promises to Boris" when
// there had been no last time at all.
check(
  "a first check-in is told plainly that there is no last time",
  sectionsFor({ template: "check_in", priorCheckIns: [] })
    .map((s) => s.text)
    .join("\n")
    .includes('<earlier_check_ins count="0">'),
  true
);

// THE READER'S MARKS ARE NO LONGER SENT AT ALL. Every version of using them went
// wrong: a companion that theorised about his highlighting, then one that read
// the absence of it as a diagnosis, then one that mistook an old briefing for a
// conversation. Ordinary marks are ordinary.
const marked = sectionsFor({
  template: "check_in",
  priorCheckIns: [],
})
  .map((s) => s.text)
  .join("\n");
check(
  "a check-in is given no highlights, notes or margin questions",
  marked.includes("their_marks") || marked.includes("earlier_briefings"),
  false
);
check(
  "and the brief no longer talks about marks",
  layerText("brief", { template: "check_in" }).toLowerCase().includes("their marks"),
  false
);
check(
  "an ordinary chat gets no history block either",
  layerText("context").includes("earlier_check_ins"),
  false
);
check(
  "and neither does the key, which is a one-shot briefing",
  sectionsFor({ template: "reading_key" })
    .map((s) => s.text)
    .join("\n")
    .includes("earlier_check_ins"),
  false
);

// Promotion is about FITTING, not depth. Sharing one constant meant a long book
// silently upgraded the conversation: a reader who picked Fast and asked a
// one-line question got Deep's model, budget and thinking because their novel
// was long.
// Compared as plain strings: these are `const` literal types, so TypeScript
// proves the inequality at compile time and rejects the comparison as
// pointless. The point is to fail if a later edit collapses them back into one.
const promotionModel: string = READER_CHAT_PROMOTION_MODEL;
check(
  "promotion has its own model, distinct from Deep's",
  promotionModel !== (READER_CHAT_DEEP_MODEL as string),
  true
);
check(
  "and is still an upgrade on Fast",
  promotionModel !== (READER_CHAT_FAST_MODEL as string),
  true
);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall good");
