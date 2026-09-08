/**
 * The notepad: the rules that decide what a place looks like in the stored
 * text, what a pill says, when a new paragraph gets stamped, how the
 * assistant reads the whole thing — and, since the notepad became an
 * outline, what the tree looks like as markdown and what every key does to
 * it.
 *
 * None of these throw when they break. They show up as a pill that renders as
 * its own syntax, a stamp on every line, an assistant that quotes link markup
 * back at the reader, or a Tab that eats a line.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-reader-notes.mts
 */

import {
  appendClipMarkdown,
  dateLabel,
  datesIn,
  noteBlurb,
  notesForPrompt,
  noteWordCount,
  NOTES_PROMPT_MAX_CHARS,
  parsePlaceHref,
  placeHref,
  placeLabel,
  placeMarkdown,
  pillMarkdown,
  pillsIn,
  placesIn,
  shortChapter,
  shouldStamp,
  STAMP_MIN_MOVE,
} from "../src/lib/reading/notes";
import {
  appendBlock,
  childrenLines,
  composeText,
  emptyDoc,
  newBlock,
  normalizeDoc,
  quoteBlock,
  resolveMarkInDoc,
  treeToMarkdown,
  type NoteBlockJSON,
  type NoteDoc,
} from "../src/lib/reading/note-tree";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, TextSelection, type Command, type Transaction } from "@tiptap/pm/state";
import { NoteBlock, NotepadDoc } from "../src/components/reading/annotations/notepad-block";
import {
  focusEndVisible,
  indentBlock,
  joinBlockBackward,
  joinBlockForward,
  liftHiddenSelection,
  moveBlockDown,
  moveBlockUp,
  outdentBlock,
  setCollapsed,
  setCollapsedAt,
  splitBlock,
} from "../src/components/reading/annotations/notepad-block-commands";
import { NotepadCompose, composeScope, quoteAbove } from "../src/components/reading/annotations/notepad-compose";
import { NotepadPill } from "../src/components/reading/annotations/notepad-pill";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------------------ */
/* The stored form                                                     */
/* ------------------------------------------------------------------ */

console.log("\nwhat a place looks like in the markdown");

check(
  "a stamped place is a link with the place scheme",
  placeMarkdown({ char: 12345, label: "p. 41", mark: null }) === "[p. 41](place:12345)"
);
check(
  "a place from a mark carries the mark",
  placeMarkdown({ char: 12345, label: "27%", mark: "9f1c-abc" }) ===
    "[27%](place:12345?mark=9f1c-abc)"
);
check(
  "brackets in a label can't break the link",
  placeMarkdown({ char: 1, label: "p. [4]", mark: null }) === "[p. 4](place:1)"
);
check("the char is rounded and clamped", placeHref({ char: -3.7, mark: null }) === "place:0");

const href = parsePlaceHref("place:12345?mark=9f1c-abc");
check("a href parses back", href?.char === 12345 && href?.mark === "9f1c-abc");
check("a plain place has no mark", parsePlaceHref("place:7")?.mark === null);
check("an ordinary link is not a place", parsePlaceHref("https://example.com") === null);
check("a malformed place is not a place", parsePlaceHref("place:abc") === null);

const doc = [
  "# Owning your own shadow",
  "",
  "[Sep 7, 2026](date:2026-09-07) [Ch. 1 · p. 41](place:1200) The bogey man story is doing a lot of work.",
  "",
  "> Projection is always easier than assimilation. [p. 40](place:1100?mark=m1)",
  "",
  "I don't get what he's trying to say here. [Ask](thread:t-1)",
  "",
  "See also [this](https://example.com) and [27%](place:9000).",
].join("\n");

check("a date is a link with the date scheme", pillMarkdown({ kind: "date", date: "2026-09-07", label: "Sep 7, 2026" }) === "[Sep 7, 2026](date:2026-09-07)");
check("a thread is a link with the thread scheme", pillMarkdown({ kind: "thread", thread: "t-1", label: "Ask" }) === "[Ask](thread:t-1)");
check("every pill is found, in order", pillsIn(doc).map((p) => p.kind).join(",") === "date,place,place,thread,place");
check("days are found", datesIn(doc).join(",") === "2026-09-07");
check("a date reads with its year", dateLabel("2026-09-07") === "Sep 7, 2026");
check("a bad date is left as it was", dateLabel("nope") === "nope");

const places = placesIn(doc);
check("every place is found, in order", places.map((p) => p.char).join(",") === "1200,1100,9000");
check("labels come back verbatim", places[0].label === "Ch. 1 · p. 41");
check("the mark rides along", places[1].mark === "m1" && places[0].mark === null);

/* ------------------------------------------------------------------ */
/* What a pill says                                                    */
/* ------------------------------------------------------------------ */

console.log("\nwhat a pill says");

check(
  "a real page is named by page",
  placeLabel({ chapterTitle: null, page: 41, percent: 27, hasRealPages: true }) === "p. 41"
);
check(
  "a synthetic page is named by progress",
  placeLabel({ chapterTitle: null, page: 41, percent: 27, hasRealPages: false }) === "27%"
);
check(
  "no page at all is named by progress",
  placeLabel({ chapterTitle: null, page: null, percent: 27.4, hasRealPages: true }) === "27%"
);
check(
  "a numbered chapter goes in front",
  placeLabel({ chapterTitle: "Chapter 3", page: 41, percent: 27, hasRealPages: true }) ===
    "Ch. 3 · p. 41"
);
check(
  "a titled chapter stays out of the pill",
  placeLabel({ chapterTitle: "The Shadow", page: 41, percent: 27, hasRealPages: true }) ===
    "p. 41"
);

check("Chapter 3 → Ch. 3", shortChapter("Chapter 3") === "Ch. 3");
check("Chapter 3: The Shadow → Ch. 3", shortChapter("Chapter 3: The Shadow") === "Ch. 3");
check("CHAPTER XII → Ch. XII", shortChapter("CHAPTER XII") === "Ch. XII");
check("chapter iv → Ch. IV", shortChapter("chapter iv") === "Ch. IV");
check("Ch. 7 → Ch. 7", shortChapter("Ch. 7") === "Ch. 7");
check("a bare number is a chapter", shortChapter("12") === "Ch. 12");
check("12. The Bogey Man → Ch. 12", shortChapter("12. The Bogey Man") === "Ch. 12");
check("Introduction is not a chapter number", shortChapter("Introduction") === null);
check("Chapters (plural) is not a chapter number", shortChapter("Chapters") === null);
check("null stays null", shortChapter(null) === null);

/* ------------------------------------------------------------------ */
/* When a paragraph gets stamped                                        */
/* ------------------------------------------------------------------ */

console.log("\nwhen a new paragraph gets a stamp");

check("the first paragraph always does", shouldStamp(null, 0));
check("standing still doesn't", !shouldStamp(5000, 5000));
check("a few words on doesn't", !shouldStamp(5000, 5000 + STAMP_MIN_MOVE - 1));
check("a page on does", shouldStamp(5000, 5000 + STAMP_MIN_MOVE));
check("going back a page does too", shouldStamp(5000, 5000 - STAMP_MIN_MOVE));

/* ------------------------------------------------------------------ */
/* Counting and describing                                             */
/* ------------------------------------------------------------------ */

console.log("\nwhat the Contents says");

check("an empty note has no words", noteWordCount("") === 0);
check("pills aren't words", noteWordCount("[p. 41](place:1) hello there") === 2);
check("markdown furniture isn't words", noteWordCount("## Heading\n\n- one\n- two") === 3);
check("an empty note gets the invitation", noteBlurb("", null) === "Somewhere to think while you read");
check(
  "a written note is counted",
  noteBlurb("one two three", null) === "3 words"
);
check("one word is singular", noteBlurb("one", null) === "1 word");
check(
  "a dated note carries the date",
  /^3 words · \S+ \S+$/.test(noteBlurb("one two three", "2026-09-07T12:00:00Z"))
);

/* ------------------------------------------------------------------ */
/* How the assistant reads it                                          */
/* ------------------------------------------------------------------ */

console.log("\nhow the assistant reads it");

console.log("\nwhat a highlight looks like when it lands on its own");
const landed = appendClipMarkdown("Some notes.\n", "First line.\nSecond line.", { char: 777, label: "p. 7", mark: "m-1" });
check("a clip is a quote after the notes", landed === "Some notes.\n\n> First line.\n>\n> Second line. [p. 7](place:777?mark=m-1)\n", JSON.stringify(landed));
check("an empty note starts with the quote", appendClipMarkdown("", "Words.", { char: 1, label: "1%", mark: null }) === "> Words. [1%](place:1)\n");
check("the quote round-trips through placesIn", placesIn(landed).at(-1)?.mark === "m-1");

const prompt = notesForPrompt(doc);
check("an empty note is nothing", notesForPrompt("   \n") === null);
check("places become asides", prompt?.text.includes("(at Ch. 1 · p. 41) The bogey man") === true);
check("a mark's place is an aside too", prompt?.text.includes("assimilation. (at p. 40)") === true);
check("no link syntax survives", !/place:\d+|date:\d|thread:/.test(prompt?.text ?? ""));
check("a day is an aside", prompt?.text.includes("(Sep 7, 2026) (at Ch. 1 · p. 41) The bogey") === true);
check("a thread is named as one", prompt?.text.includes("say here. (a conversation branched off here)") === true);
check("ordinary links are left alone", prompt?.text.includes("[this](https://example.com)") === true);
check("a short note isn't truncated", prompt?.truncated === false);

const long = Array.from({ length: 2000 }, (_, i) => `Line ${i} of a very long note about the book.`).join("\n");
const cut = notesForPrompt(long);
check("a long note is cut", cut?.truncated === true);
check(
  "cut under budget, at a line break",
  (cut?.text.length ?? 0) <= NOTES_PROMPT_MAX_CHARS && !cut?.text.endsWith("\n") && /\.$/.test(cut?.text ?? "")
);
check("the front survives", cut?.text.startsWith("Line 0 of") === true);

/* ------------------------------------------------------------------ */
/* The tree                                                            */
/* ------------------------------------------------------------------ */

console.log("\nthe note as a tree, and as markdown");

const p = (text: string, ...rest: object[]) => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }, ...rest] : rest,
});
const pill = (char: number, label: string, mark: string | null = null) => ({
  type: "pill",
  attrs: { kind: "place", label, char, mark },
});

const tree: NoteDoc = {
  type: "doc",
  content: [
    newBlock({ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Owning your own shadow" }] }, [
      newBlock(p("The bogey man story is doing a lot of work."), [
        newBlock(p("", { type: "text", text: "Really ", marks: [{ type: "bold" }] }, { type: "text", text: "a lot" }), [], { id: "gc" }),
      ], { id: "child" }),
      newBlock(p("Second thought"), [], { id: "second", collapsed: true }),
    ], { id: "top" }),
    quoteBlock("First line.\nSecond line.", { char: 777, label: "p. 7", mark: "m-1" }),
    newBlock(p("I don't get it. ", { type: "compose", attrs: { kind: "ask", handle: "ask", name: "Ask" } })),
    newBlock(p("See "), [newBlock({ type: "blockquote", content: [p("Nested quote. ", pill(9, "27%"))] })]),
  ],
};

const md = treeToMarkdown(tree);
check(
  "a nested note reads as bare lines with a tight list under each",
  md ===
    [
      "# Owning your own shadow",
      "- The bogey man story is doing a lot of work.",
      "  - **Really **a lot",
      "- Second thought",
      "",
      "> First line.",
      ">",
      "> Second line. [p. 7](place:777?mark=m-1)",
      "",
      "I don't get it. @ask",
      "",
      "See ",
      "- > Nested quote. [27%](place:9000)".replace("9000", "9"),
      "",
    ].join("\n"),
  JSON.stringify(md)
);
check("a flat note reads exactly as it did", treeToMarkdown({ type: "doc", content: [newBlock(p("One")), newBlock(p("Two")), newBlock(p("Three"))] }) === "One\n\nTwo\n\nThree\n");
check(
  "a landed quote reads the same whichever path wrote it",
  treeToMarkdown(appendBlock(emptyDoc(), quoteBlock("Words.", { char: 1, label: "1%", mark: null }))) ===
    appendClipMarkdown("", "Words.", { char: 1, label: "1%", mark: null })
);
check(
  "a quote after notes reads the same whichever path wrote it",
  treeToMarkdown(appendBlock({ type: "doc", content: [newBlock(p("Some notes."))] }, quoteBlock("First line.\nSecond line.", { char: 777, label: "p. 7", mark: "m-1" }))) ===
    appendClipMarkdown("Some notes.\n", "First line.\nSecond line.", { char: 777, label: "p. 7", mark: "m-1" })
);
check("an empty note is empty markdown", treeToMarkdown(emptyDoc()) === "");
check("every pill is found in the derived markdown", placesIn(md).map((x) => x.char).join(",") === "777,9");
check("list markers aren't words", noteWordCount(treeToMarkdown({ type: "doc", content: [newBlock(p("a"), [newBlock(p("b"), [newBlock(p("c"))])])] })) === 3);
check("the assistant reads a nested note with its indents", notesForPrompt(md)?.text.includes("  - **Really **a lot") === true);

const raw = normalizeDoc({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "bare" }] },
    { type: "noteBlock", attrs: { id: "dup" }, content: [{ type: "paragraph" }] },
    { type: "noteBlock", attrs: { id: "dup", collapsed: true }, content: [{ type: "paragraph" }, { type: "paragraph", content: [{ type: "text", text: "loose" }] }] },
    { type: "horizontalRule" },
  ],
});
check("a bare paragraph is lifted into a block", raw.content[0].type === "noteBlock" && raw.content[0].content[0].type === "paragraph");
check("every block has an id and duplicates are renamed", raw.content[1].attrs.id === "dup" && raw.content[2].attrs.id !== "dup" && raw.content[0].attrs.id.length > 0);
check("collapsed is kept", raw.content[2].attrs.collapsed === true && raw.content[1].attrs.collapsed === false);
check("a loose paragraph among children becomes a child block", raw.content[2].content[1].type === "noteBlock");
check("what fits nowhere is dropped", raw.content.length === 3);
check("nothing becomes one empty line", normalizeDoc(null).content.length === 1 && normalizeDoc({}).content[0].content[0].type === "paragraph");
check("appending to an untouched note replaces the empty line", appendBlock(emptyDoc(), newBlock(p("x"))).content.length === 1);
check("appending to a note adds at the end", appendBlock({ type: "doc", content: [newBlock(p("a"))] }, newBlock(p("b"))).content.length === 2);

const askBlock = (tree.content[0].content[1] as NoteBlockJSON);
check("children read as lines", childrenLines(askBlock).join("|") === "- Really a lot");
check(
  "what a chip sends: crumbs, the line, what's under it",
  composeText([tree.content[0]], askBlock) === "Under: Owning your own shadow\n\nThe bogey man story is doing a lot of work.\n- Really a lot"
);
check("a top-level line sends no crumbs", composeText([], tree.content[2]) === "I don't get it.");

const landedNow = appendBlock(emptyDoc(), quoteBlock("Now.", { char: 5, label: "p. 1", mark: "pending:abc" }));
const fixed = resolveMarkInDoc(landedNow, "pending:abc", "real-id");
check("a stand-in mark is swapped for the real one", fixed != null && treeToMarkdown(fixed).includes("?mark=real-id") && !treeToMarkdown(fixed).includes("pending"));
check("nothing to swap is nothing", resolveMarkInDoc(landedNow, "other", "x") === null);
check("the swap leaves the original alone", treeToMarkdown(landedNow).includes("pending:abc"));

/* ------------------------------------------------------------------ */
/* The keys                                                            */
/* ------------------------------------------------------------------ */

console.log("\nwhat the keys do to the outline");

const schema = getSchema([
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: false,
    document: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    horizontalRule: false,
    trailingNode: false,
    dropcursor: false,
  }),
  NotepadDoc,
  NoteBlock,
  NotepadPill,
  NotepadCompose,
]);

/** A state over a tree, with the caret at `caret` (an absolute position). */
function stateOf(doc: NoteDoc, caret: number): EditorState {
  const pm = schema.nodeFromJSON(doc);
  return EditorState.create({ schema, doc: pm, selection: TextSelection.create(pm, caret) });
}

function run(state: EditorState, cmd: Command): { state: EditorState; handled: boolean; tr: Transaction | null } {
  let tr: Transaction | null = null;
  const handled = cmd(state, (t) => {
    tr = t;
  });
  return { state: tr ? state.apply(tr) : state, handled, tr };
}

const shape = (state: EditorState) => treeToMarkdown(state.doc.toJSON() as NoteDoc);
const caretText = (state: EditorState) => state.selection.$from.parent.textContent;
const caretOffset = (state: EditorState) => state.selection.$from.parentOffset;

/** a / b / c with c under b. Positions: a's text starts at 2. */
const abc = (): NoteDoc => ({
  type: "doc",
  content: [
    newBlock(p("a"), [], { id: "a" }),
    newBlock(p("b"), [newBlock(p("c"), [], { id: "c" })], { id: "b" }),
    newBlock(p("d"), [], { id: "d" }),
  ],
});
// Layout of abc: [a: 0..5) [b: 5..15) with head 6..9, c: 9..14 [d: 15..20).
// AT_X is the END of x's one-letter text; AT_X - 1 is its start.
const AT_A = 3, AT_B = 8, AT_C = 12, AT_D = 18;

{
  const r = run(stateOf(abc(), AT_B), indentBlock);
  check("Tab nests a line under the one above, with its children", r.handled && shape(r.state) === "a\n- b\n  - c\n\nd\n", JSON.stringify(shape(r.state)));
  check("Tab keeps the caret in the moved line", caretText(r.state) === "b" && caretOffset(r.state) === 1);
}
{
  const r = run(stateOf(abc(), AT_A), indentBlock);
  check("Tab on the first line does nothing but is taken", r.handled && r.tr === null);
}
{
  const r = run(stateOf(abc(), AT_C), indentBlock);
  check("Tab on a first child does nothing", r.tr === null);
}
{
  const r = run(stateOf(abc(), AT_C), outdentBlock);
  check("Shift-Tab steps a line out after its parent", shape(r.state) === "a\n\nb\n\nc\n\nd\n", JSON.stringify(shape(r.state)));
  check("Shift-Tab keeps the caret", caretText(r.state) === "c");
}
{
  const nested: NoteDoc = { type: "doc", content: [newBlock(p("p"), [newBlock(p("x")), newBlock(p("y")), newBlock(p("z"))])] };
  const r = run(stateOf(nested, 12), outdentBlock); // caret in y
  check("Shift-Tab takes the lines after it along as children", shape(r.state) === "p\n- x\n\ny\n- z\n", JSON.stringify(shape(r.state)));
}
{
  const r = run(stateOf(abc(), AT_A), outdentBlock);
  check("Shift-Tab at the top level does nothing", r.handled && r.tr === null);
}
{
  const r = run(stateOf(abc(), AT_D), moveBlockUp);
  check("⌥↑ moves a line above its neighbour and everything under it", shape(r.state) === "a\n\nd\n\nb\n- c\n", JSON.stringify(shape(r.state)));
  check("⌥↑ keeps the caret", caretText(r.state) === "d");
}
{
  const r = run(stateOf(abc(), AT_A), moveBlockDown);
  check("⌥↓ moves a line below its neighbour's whole subtree", shape(r.state) === "b\n- c\n\na\n\nd\n", JSON.stringify(shape(r.state)));
  const r2 = run(stateOf(abc(), AT_D), moveBlockDown);
  check("⌥↓ on the last line does nothing", r2.tr === null);
}
{
  const r = run(stateOf(abc(), AT_B), setCollapsed(true));
  const b = r.state.doc.child(1);
  check("⌘↑ folds the line the caret is on", b.attrs.collapsed === true);
  check("folding is not a history step", r.tr?.getMeta("addToHistory") === false);
  const r2 = run(r.state, setCollapsed(true));
  check("folding twice is nothing", r2.tr === null && r2.handled);
  const r3 = run(stateOf(abc(), AT_A), setCollapsed(true));
  check("⌘↑ on a childless line is taken and does nothing", r3.handled && r3.tr === null);
  const r4 = run(stateOf(abc(), AT_C), setCollapsedAt(5, true));
  check("folding over the caret brings it up to the head", r4.state.doc.child(1).attrs.collapsed === true && caretText(r4.state) === "b");
  check("the folded line's markdown is unchanged", shape(r.state) === shape(stateOf(abc(), AT_B)));
}
{
  const r = run(stateOf(abc(), AT_A), splitBlock); // end of "a"
  check("Enter at the end makes the next line", shape(r.state) === "a\n\n\n\nb\n- c\n\nd\n".replace("\n\n\n\n", "\n\n") && r.state.doc.childCount === 4, JSON.stringify(shape(r.state)));
  check("the caret is on the new, empty line", caretText(r.state) === "" && r.state.doc.child(1).firstChild?.content.size === 0);
  check("Enter is not tagged as structural (the stamp watches it)", !r.tr?.getMeta("notepad-insert"));
}
{
  const r = run(stateOf(abc(), AT_B), splitBlock); // end of "b", which has c showing
  check("Enter at the end of an open parent makes its first child", r.state.doc.child(1).childCount === 3 && r.state.doc.child(1).child(1).firstChild?.content.size === 0);
}
{
  const folded = abc();
  folded.content[1].attrs.collapsed = true;
  const r = run(stateOf(folded, AT_B), splitBlock);
  check("Enter at the end of a folded parent makes the next line after everything under it", r.state.doc.childCount === 4 && r.state.doc.child(2).firstChild?.content.size === 0);
}
{
  const doc: NoteDoc = { type: "doc", content: [newBlock(p("hello world"), [newBlock(p("kid"))])] };
  const r = run(stateOf(doc, 7), splitBlock); // after "hello"
  check("Enter mid-line moves the rest down and keeps the children", shape(r.state) === "hello\n- kid\n\n world\n", JSON.stringify(shape(r.state)));
  check("the caret is at the start of the new line", caretText(r.state) === " world" && caretOffset(r.state) === 0);
}
{
  const r = run(stateOf(abc(), AT_A - 1), splitBlock); // start of "a"
  check("Enter at the start opens an empty line above", r.state.doc.child(0).firstChild?.content.size === 0 && caretText(r.state) === "a" && caretOffset(r.state) === 0);
}
{
  const doc: NoteDoc = { type: "doc", content: [newBlock({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Head" }] })] };
  const r = run(stateOf(doc, 6), splitBlock);
  check("Enter after a heading makes a plain line", r.state.doc.child(1).firstChild?.type.name === "paragraph");
}
{
  const doc: NoteDoc = { type: "doc", content: [newBlock({ type: "blockquote", content: [p("Quoted."), p("")] })] };
  const r = run(stateOf(doc, 12), splitBlock); // in the empty last paragraph
  check("Enter on an empty last quote line steps out of the quote", r.state.doc.childCount === 2 && r.state.doc.child(0).firstChild?.childCount === 1 && caretText(r.state) === "");
  const r2 = run(stateOf(doc, 5), splitBlock);
  check("Enter inside a quote is the editor's own", !r2.handled);
}
{
  const doc: NoteDoc = { type: "doc", content: [newBlock(p("a")), newBlock(p(""))] };
  const r = run(stateOf(doc, 7), joinBlockBackward);
  check("Backspace on an empty line removes it and lands at the end of the one above", r.state.doc.childCount === 1 && caretText(r.state) === "a" && caretOffset(r.state) === 1);
}
{
  const doc: NoteDoc = { type: "doc", content: [newBlock(p("a")), newBlock(p(""), [newBlock(p("kid"))])] };
  const r = run(stateOf(doc, 7), joinBlockBackward);
  check("Backspace on an empty line with children lifts them into its place", shape(r.state) === "a\n\nkid\n", JSON.stringify(shape(r.state)));
}
{
  const r = run(stateOf(abc(), AT_D - 1), joinBlockBackward); // start of "d"
  check("Backspace at the start of a line joins it to the visible line above (c)", shape(r.state) === "a\n\nb\n- cd\n", JSON.stringify(shape(r.state)));
  check("the caret sits at the join", caretText(r.state) === "cd" && caretOffset(r.state) === 1);
}
{
  const folded = abc();
  folded.content[1].attrs.collapsed = true;
  const r = run(stateOf(folded, AT_D - 1), joinBlockBackward);
  check("…but not to something folded away: it joins the folded line itself", shape(r.state) === "a\n\nbd\n- c\n", JSON.stringify(shape(r.state)));
}
{
  const doc: NoteDoc = { type: "doc", content: [newBlock(p("a"), [newBlock(p("kid"), [newBlock(p("x"))])])] };
  const r = run(stateOf(doc, 6), joinBlockBackward); // start of "kid"
  check("Backspace at the start of a first child joins its parent and lifts its own children", shape(r.state) === "akid\n- x\n", JSON.stringify(shape(r.state)));
}
{
  const r = run(stateOf(abc(), AT_A - 1), joinBlockBackward);
  check("Backspace at the start of the note does nothing", r.handled && r.tr === null);
  const r2 = run(stateOf(abc(), AT_A), joinBlockBackward);
  check("Backspace mid-line is the editor's own", !r2.handled);
}
{
  const doc: NoteDoc = { type: "doc", content: [newBlock({ type: "blockquote", content: [p("One."), p("Two.")] }, [newBlock(p("kid"))])] };
  const r = run(stateOf(doc, 3), joinBlockBackward);
  check("Backspace at the start of a quote unwraps it into lines", shape(r.state) === "One.\n- kid\n\nTwo.\n", JSON.stringify(shape(r.state)));
}
{
  const r = run(stateOf(abc(), AT_A), joinBlockForward); // end of "a"
  check("Delete at the end pulls the next line up, its children stepping in", shape(r.state) === "ab\n\nc\n\nd\n", JSON.stringify(shape(r.state)));
}
{
  const r = run(stateOf(abc(), AT_D), joinBlockForward);
  check("Delete at the end of the note does nothing", r.handled && r.tr === null);
}
{
  const folded = abc();
  folded.content[1].attrs.collapsed = true;
  const r = run(stateOf(folded, AT_A), focusEndVisible);
  check("the end of the note is the last visible line", caretText(r.state) === "d");
  const folded2 = abc();
  folded2.content[2] = newBlock(p("e"), [newBlock(p("f"))], { collapsed: true });
  const r2 = run(stateOf(folded2, AT_A), focusEndVisible);
  check("…even when that line is folded", caretText(r2.state) === "e");
  const open = abc();
  const r3 = run(stateOf(open, AT_A), focusEndVisible);
  check("…and the deepest open child when not", caretText(r3.state) === "d");
}
{
  const folded = abc();
  folded.content[1].attrs.collapsed = true;
  const lifted = liftHiddenSelection(stateOf(folded, AT_C));
  check("a caret under a fold is brought up to the folded line", lifted != null && lifted.selection.$from.parent.textContent === "b");
  check("a caret in the open is left alone", liftHiddenSelection(stateOf(abc(), AT_C)) === null);
}
{
  const doc: NoteDoc = {
    type: "doc",
    content: [
      newBlock({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Ch. 3" }] }, [
        quoteBlock("The passage.", { char: 40, label: "p. 4", mark: "m" }),
        newBlock(p("Thought. ", { type: "compose", attrs: { kind: "ask", handle: "ask", name: "Ask" } }), [newBlock(p("under"))]),
        newBlock(p("sibling")),
      ]),
    ],
  };
  const pm = schema.nodeFromJSON(doc);
  let chipPos = -1;
  pm.descendants((n, pos) => {
    if (n.type.name === "compose") chipPos = pos;
    return chipPos < 0;
  });
  const scope = composeScope(pm, chipPos);
  check("what a chip sends names where it sits and what's under it, not what's beside it", scope?.text === "Under: Ch. 3\n\nThought.\n- under", JSON.stringify(scope?.text));
  check("the quote above rides along", scope?.quote?.text === "The passage." && scope?.quote?.place.char === 40);
  check("quoteAbove agrees", quoteAbove(pm, chipPos));
  const under: NoteDoc = { type: "doc", content: [newBlock({ type: "blockquote", content: [p("Q. ", pill(1, "1%"))] }, [newBlock(p("about it"))])] };
  const pmUnder = schema.nodeFromJSON(under);
  check("a line nested under a quote is about that quote", quoteAbove(pmUnder, pmUnder.nodeSize - 6));
}

/* ------------------------------------------------------------------ */

if (failures > 0) {
  console.error(`\n${failures} failure${failures === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("\nall good");
