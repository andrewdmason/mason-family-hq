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

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall good");
