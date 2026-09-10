/**
 * The notepad: the rules that decide what a place looks like in the stored
 * text, what a pill says, what each line records about where it was written
 * and when, how the assistant reads the whole thing — and, since the notepad
 * became an outline, what the tree looks like as markdown and what every key
 * does to it.
 *
 * None of these throw when they break. They show up as a pill that renders as
 * its own syntax, a line that says it was written today when it was written
 * last year, an assistant that quotes link markup back at the reader, or a
 * Tab that eats a line.
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
  stampLabel,
  STAMP_MIN_MOVE,
} from "../src/lib/reading/notes";
import {
  absorbPlacePills,
  appendBlock,
  blockHeadText,
  childrenLines,
  composeText,
  emptyDoc,
  newBlock,
  NOTEPAD_NO_STAMP_META,
  normalizeDoc,
  provenanceOf,
  quoteBlock,
  resolveMarkInDoc,
  threadHead,
  treeToMarkdown,
  type NoteBlockJSON,
  type NoteDoc,
} from "../src/lib/reading/note-tree";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, NodeSelection, Selection, TextSelection, type Command, type Transaction } from "@tiptap/pm/state";
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
import { NotepadCompose, blockScope, composeScope, quoteAbove } from "../src/components/reading/annotations/notepad-compose";
import { NotepadPill } from "../src/components/reading/annotations/notepad-pill";
import { NotepadThreadBlock } from "../src/components/reading/annotations/notepad-thread-block";
import { matchSlashItems, slashAllowed } from "../src/components/reading/annotations/notepad-slash";
import { provenancePlugin } from "../src/components/reading/annotations/notepad-provenance";

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
  NotepadThreadBlock,
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

/** The end of a named block's head text, as an absolute position. */
function endOfHead(doc: NoteDoc, id: string): number {
  const pm = schema.nodeFromJSON(doc);
  let at = -1;
  pm.descendants((n, pos) => {
    if (at < 0 && n.type.name === "noteBlock" && n.attrs.id === id) {
      at = pos + 2 + n.firstChild!.content.size;
    }
    return at < 0;
  });
  return at;
}

{
  // a / b, with a blank line nested under b. Enter on it steps it out.
  const doc: NoteDoc = {
    type: "doc",
    content: [
      newBlock(p("a"), [], { id: "a" }),
      newBlock(p("b"), [newBlock(p(""), [], { id: "blank" })], { id: "b" }),
    ],
  };
  const r = run(stateOf(doc, endOfHead(doc, "blank")), splitBlock);
  check("Enter on a blank nested line steps it out instead of adding another", r.handled && shape(r.state) === "a\n\nb\n", JSON.stringify(shape(r.state)));
  check("and the line is now at the top level", r.state.doc.childCount === 3 && r.state.doc.child(2).firstChild!.content.size === 0);
  const again = run(r.state, splitBlock);
  check("Enter again at the top level makes a line, as before", again.state.doc.childCount === 4);
}
{
  // A blank line with something under it still steps out, children and all.
  const doc: NoteDoc = {
    type: "doc",
    content: [
      newBlock(p("top"), [newBlock(p(""), [newBlock(p("kept"), [], { id: "kept" })], { id: "blank" })], { id: "top" }),
    ],
  };
  const r = run(stateOf(doc, endOfHead(doc, "blank")), splitBlock);
  check("a blank line with children takes them with it", shape(r.state) === "top\n\n- kept\n", JSON.stringify(shape(r.state)));
}
{
  // A line with words in it is not blank, however deep.
  const doc: NoteDoc = {
    type: "doc",
    content: [newBlock(p("a"), [newBlock(p("words"), [], { id: "w" })], { id: "a" })],
  };
  const r = run(stateOf(doc, endOfHead(doc, "w")), splitBlock);
  check("Enter at the end of a nested line with words still makes a line", shape(r.state) === "a\n- words\n- \n" || r.state.doc.child(0).childCount === 3, JSON.stringify(shape(r.state)));
}

/* ------------------------------------------------------------------ */
/* Where a line came from                                              */
/* ------------------------------------------------------------------ */

console.log("\nwhat a line records about itself");

const NOW = "2026-09-09T15:12:00.000Z";
const HERE = { char: 4200, label: "Ch. 3 · p. 84", mark: null };

/** A state that stamps new lines, standing at `spot`. */
function stamping(doc: NoteDoc, caret: number, spot = HERE as typeof HERE | null): EditorState {
  const pm = schema.nodeFromJSON(doc);
  return EditorState.create({
    schema,
    doc: pm,
    selection: TextSelection.create(pm, caret),
    plugins: [provenancePlugin({ spot: () => spot, now: () => NOW })],
  });
}

const blockAtIndex = (state: EditorState, i: number) => state.doc.child(i);
const recordOf = (state: EditorState, i: number) => provenanceOf(blockAtIndex(state, i).attrs);

{
  // One empty line, one written line that knows nothing — an old note.
  const doc: NoteDoc = {
    type: "doc",
    content: [newBlock(p(""), [], { id: "blank" }), newBlock(p("old words"), [], { id: "old" })],
  };
  const state = stamping(doc, 2);
  check("an empty line records nothing until it is written in", recordOf(state, 0).at === null);

  const typed = state.apply(state.tr.insertText("new", 2));
  check("the first words stamp the line", recordOf(typed, 0).at === NOW && recordOf(typed, 0).place?.char === 4200);
  check("a line that already had words is left alone", recordOf(typed, 1).at === null);

  const again = typed.apply(typed.tr.insertText("!", 5));
  check("writing more doesn't restamp", recordOf(again, 0).at === NOW);
}
{
  // Nowhere to be — the book hasn't reported a position.
  const state = stamping({ type: "doc", content: [newBlock(p(""))] }, 2, null);
  const typed = state.apply(state.tr.insertText("x", 2));
  check("a line written with no position still records the time", recordOf(typed, 0).at === NOW && recordOf(typed, 0).place === null);
}
{
  // Words arriving from outside, as a whole line: born now.
  const state = stamping({ type: "doc", content: [newBlock(p("here"))] }, 3);
  const pasted = schema.nodeFromJSON(newBlock(p("from elsewhere")));
  const typed = state.apply(state.tr.insert(state.doc.content.size, pasted));
  check("a line pasted from outside is born now", recordOf(typed, 1).at === NOW);
}
{
  // A copy of a line that already knew: its record comes with it.
  const state = stamping({ type: "doc", content: [newBlock(p("here"))] }, 3);
  const copy = schema.nodeFromJSON(
    newBlock(p("a copy"), [], { place: { char: 10, label: "p. 1", mark: null }, at: "2020-01-01T00:00:00.000Z" })
  );
  const typed = state.apply(state.tr.insert(state.doc.content.size, copy));
  check("a copied line keeps where it came from", recordOf(typed, 1).at === "2020-01-01T00:00:00.000Z" && recordOf(typed, 1).place?.char === 10);
}
{
  // Enter in the middle of a line: the tail is old words.
  const doc: NoteDoc = {
    type: "doc",
    content: [newBlock(p("one two"), [], { id: "x", place: { char: 10, label: "p. 1", mark: null }, at: "2020-01-01T00:00:00.000Z" })],
  };
  const r = run(stateOf(doc, 6), splitBlock);
  const tail = r.state.doc.child(1);
  check("splitting a line hands the new one the old one's record", provenanceOf(tail.attrs).at === "2020-01-01T00:00:00.000Z" && provenanceOf(tail.attrs).place?.char === 10);
  check("and says so, so nothing stamps it as new", r.tr?.getMeta(NOTEPAD_NO_STAMP_META) === true);
  check("but it is still a line of its own", tail.attrs.id !== "x");
}
{
  // Enter at the end: a new empty line, which knows nothing yet.
  const doc: NoteDoc = {
    type: "doc",
    content: [newBlock(p("one"), [], { id: "x", place: { char: 10, label: "p. 1", mark: null }, at: "2020-01-01T00:00:00.000Z" })],
  };
  const r = run(stateOf(doc, 5), splitBlock);
  check("a line opened at the end starts blank", provenanceOf(r.state.doc.child(1).attrs).at === null);
  check("and is not called old words", r.tr?.getMeta(NOTEPAD_NO_STAMP_META) !== true);
}
{
  // Backspace at the start of a quote: its paragraphs are its own words.
  const doc: NoteDoc = {
    type: "doc",
    content: [
      newBlock(p("above")),
      newBlock({ type: "blockquote", content: [p("One."), p("Two.")] }, [], { place: { char: 10, label: "p. 1", mark: "m" }, at: "2020-01-01T00:00:00.000Z" }),
    ],
  };
  const start = 12; // the first character of the quote's first paragraph
  const r = run(stateOf(doc, start), joinBlockBackward);
  check("unwrapping a quote gives its lines the quote's record", provenanceOf(r.state.doc.child(2).attrs).place?.char === 10);
  check("and never reads as new writing", r.tr?.getMeta(NOTEPAD_NO_STAMP_META) === true);
}
{
  // Moving a line around never changes what it knows.
  const doc: NoteDoc = {
    type: "doc",
    content: [
      newBlock(p("a"), [], { id: "a" }),
      newBlock(p("b"), [], { id: "b", place: { char: 99, label: "p. 9", mark: null }, at: NOW }),
    ],
  };
  const moved = run(stateOf(doc, 8), moveBlockUp);
  check("a line moved keeps its record", provenanceOf(moved.state.doc.child(0).attrs).place?.char === 99);
  const nested = run(stateOf(doc, 8), indentBlock);
  check("a line nested keeps its record", provenanceOf(nested.state.doc.child(0).child(1).attrs).place?.char === 99);
}

console.log("\nwhen a place is worth writing down");

{
  const near = (char: number, i: number) =>
    newBlock(p(`line ${i}`), [], { place: { char, label: `p. ${i}`, mark: null }, at: NOW });
  const md = treeToMarkdown({
    type: "doc",
    content: [near(1000, 1), near(1050, 2), near(1000 + STAMP_MIN_MOVE * 2, 3)],
  });
  check("the first place is written", md.startsWith("[p. 1](place:1000) line 1"));
  check("a place the reader hasn't moved from is not written again", !md.includes("place:1050"));
  check("a place they have moved to is", md.includes(`place:${1000 + STAMP_MIN_MOVE * 2}`));
  check("a line without a place reads as itself", treeToMarkdown({ type: "doc", content: [newBlock(p("plain"))] }) === "plain\n");
  check(
    "a blank line that knows where it was still says nothing",
    treeToMarkdown({ type: "doc", content: [newBlock(p(""), [], { place: { char: 5, label: "p. 1", mark: null }, at: NOW })] }) === ""
  );
  const heading = treeToMarkdown({
    type: "doc",
    content: [newBlock({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Ch. 3" }] }, [], { place: { char: 7, label: "p. 1", mark: null }, at: NOW })],
  });
  check("a heading keeps its hashes in front", heading === "## [p. 1](place:7) Ch. 3\n", JSON.stringify(heading));
  const nestedMd = treeToMarkdown({
    type: "doc",
    content: [newBlock(p("top"), [newBlock(p("under"), [], { place: { char: 8, label: "p. 1", mark: null }, at: NOW })])],
  });
  check("a nested line keeps its dash in front", nestedMd === "top\n- [p. 1](place:8) under\n", JSON.stringify(nestedMd));
}

console.log("\nan old note's stamps, lifted onto its lines");

{
  const old: NoteDoc = {
    type: "doc",
    content: [
      newBlock(p("", pill(1200, "Ch. 1 · p. 41"), { type: "text", text: " The bogey man." }), [], { id: "one" }),
      newBlock({ type: "blockquote", content: [p("Projection. ", pill(1100, "p. 40", "m1"))] }, [], { id: "two" }),
      newBlock(p("A thought at ", pill(900, "p. 30"), { type: "text", text: " about this." }), [], { id: "three" }),
      newBlock(p("Ask me. ", { type: "pill", attrs: { kind: "thread", thread: "t-1", label: "Ask" } }), [], { id: "four" }),
    ],
  };
  const lifted = absorbPlacePills(old);
  check("a note with stamps in it is changed", lifted !== null);
  const [a, b, c, d] = lifted!.content;
  check("a stamp at the front of a line moves onto the line", a.attrs.place?.char === 1200 && a.attrs.place?.label === "Ch. 1 · p. 41");
  check("and takes the space after it with it", treeToMarkdown({ type: "doc", content: [a] }) === "[Ch. 1 · p. 41](place:1200) The bogey man.\n");
  check("a stamp at the end of a quote moves onto the quote's line", b.attrs.place?.char === 1100 && b.attrs.place?.mark === "m1");
  check("and the quote reads as the book's words alone", treeToMarkdown({ type: "doc", content: [b] }) === "> Projection. [p. 40](place:1100?mark=m1)\n");
  check("a pill put in mid-sentence stays exactly where it is", c.attrs.place === null);
  check("a conversation is never mistaken for a stamp", d.attrs.place === null);
  check("nothing lifted claims to know when", a.attrs.at === null && b.attrs.at === null);
  check("a note with nothing to lift is left alone", absorbPlacePills(lifted!) === null);
  check("so is a note that never had a stamp", absorbPlacePills({ type: "doc", content: [newBlock(p("just words"))] }) === null);
  check("a line already knowing where it was is not overwritten", absorbPlacePills({ type: "doc", content: [newBlock(p("", pill(1, "1%")), [], { place: { char: 9, label: "p. 9", mark: null }, at: NOW })] }) === null);
}

{
  const pending: NoteDoc = { type: "doc", content: [quoteBlock("Words.", { char: 5, label: "1%", mark: "pending:abc" }, NOW)] };
  const fixed = resolveMarkInDoc(pending, "pending:abc", "real-id");
  check("a clip's mark becomes the real one on the line", fixed?.content[0].attrs.place?.mark === "real-id");
  check("nothing to fix is null", resolveMarkInDoc(fixed!, "pending:abc", "real-id") === null);
}

check("a line says when it was written, to the minute", /^Sep 9, 2026 at /.test(stampLabel("2026-09-09T15:12:00.000Z") ?? ""));
check("a time that isn't one says nothing", stampLabel("not a date") === null);

/* ------------------------------------------------------------------ */
/* A line that became a conversation                                   */
/* ------------------------------------------------------------------ */

console.log("\na line that became a conversation");

const threadPill = (thread: string, label: string) => ({ type: "pill", attrs: { kind: "thread", thread, label } });

{
  // The shapes a conversation used to leave behind, lifted on the way in.
  const raw = normalizeDoc({
    type: "doc",
    content: [
      newBlock(p("", threadPill("t-bare", "Ask")), [], { id: "bare" }),
      newBlock(p("Why is the maestro late? ", threadPill("t-trail", "Ask")), [newBlock(p("kid"), [], { id: "kid" })], { id: "trail", place: HERE, at: NOW }),
      newBlock(p("Sent to ", threadPill("t-jenny", "Jenny")), [], { id: "jenny" }),
      newBlock(p("", pill(1200, "p. 41"), { type: "text", text: " Stamped question " }, threadPill("t-stamped", "Ask")), [], { id: "stamped" }),
      newBlock(p("See ", threadPill("t-mid", "Ask"), { type: "text", text: " for more." }), [], { id: "mid" }),
      newBlock({ type: "threadBlock", attrs: { thread: "", title: "Orphan", kind: "ask", question: "q" } }, [], { id: "orphan" }),
      newBlock({ type: "threadBlock", attrs: { thread: "t-ok", title: null, kind: "weird", question: " q " } }, [], { id: "ok" }),
    ],
  });
  const [bare, trail, jenny, stamped, mid, orphan, ok] = raw.content;
  check("a stamp at the front of a sent line becomes the line's place, not its question", stamped.attrs.place?.char === 1200 && stamped.content[0].attrs?.question === "Stamped question");
  check("a pill alone on a line becomes a thread block", bare.content[0].type === "threadBlock" && bare.content[0].attrs?.thread === "t-bare");
  check("its question is the pill's label, having nothing else", bare.content[0].attrs?.question === "Ask" && bare.content[0].attrs?.kind === "ask");
  check("a pill at the end of a line becomes a thread block", trail.content[0].type === "threadBlock" && trail.content[0].attrs?.thread === "t-trail");
  check("with the words before it as the question", trail.content[0].attrs?.question === "Why is the maestro late?");
  check("keeping what was nested under it", trail.content.length === 2 && trail.content[1].attrs?.id === "kid");
  check("and where and when the line was written", trail.attrs.place?.char === HERE.char && trail.attrs.at === NOW);
  check("a pill to a person becomes a block to a person", jenny.content[0].type === "threadBlock" && jenny.content[0].attrs?.kind === "member");
  check("a pill mid-sentence stays a pill", mid.content[0].type === "paragraph" && mid.content[0].content?.[1]?.type === "pill");
  check("a block with no conversation behind it reads as a line", orphan.content[0].type === "paragraph" && orphan.content[0].content?.[0]?.text === "Orphan");
  check("a block's attrs are tidied", ok.content[0].attrs?.kind === "ask" && ok.content[0].attrs?.question === "q" && ok.content[0].attrs?.title === null);
  check("lifting twice is the same as once", JSON.stringify(normalizeDoc(raw)) === JSON.stringify(raw));
}

{
  const named = newBlock(threadHead({ thread: "t-1", kind: "ask", question: "Why is the maestro late?", title: "The maestro's lateness" }), [newBlock(p("notes on the answer"))], { id: "named", place: { char: 300, label: "p. 3", mark: null }, at: NOW });
  const unnamed = newBlock(threadHead({ thread: "t-2", kind: "member", question: "Did you see this bit?" }), [], { id: "unnamed" });
  const doc: NoteDoc = { type: "doc", content: [newBlock(p("Top"), [named]), unnamed] };
  const md = treeToMarkdown(doc);
  check(
    "a conversation is written as the link the pill wrote, wearing its name",
    md === "Top\n- [p. 3](place:300) [The maestro's lateness](thread:t-1)\n  - notes on the answer\n\n[Did you see this bit?](thread:t-2)\n",
    JSON.stringify(md)
  );
  check("every conversation is found in the derived markdown", pillsIn(md).filter((x) => x.kind === "thread").map((x) => x.thread).join(",") === "t-1,t-2");
  check("a name is not words", noteWordCount(md) === 5);
  const prompt = notesForPrompt(md)?.text ?? "";
  check("the assistant reads the name", prompt.includes("(a conversation branched off here: The maestro's lateness)"), prompt);
  check("and the question, when there is no name yet", prompt.includes("(a conversation branched off here: Did you see this bit?)"));
  check("a bare Ask says only that a conversation branched", notesForPrompt("x [Ask](thread:t)")?.text === "x (a conversation branched off here)");
  check("a conversation names itself in a breadcrumb", blockHeadText(named) === "The maestro's lateness" && blockHeadText(unnamed) === "Did you see this bit?");
  check("what a line under a conversation sends names it", composeText([named], named.content[1] as NoteBlockJSON).startsWith("Under: The maestro's lateness"));
}

{
  // /ask reads the same scope a chip did.
  const doc: NoteDoc = {
    type: "doc",
    content: [
      newBlock(p("A parent"), [
        quoteBlock("The passage.", { char: 50, label: "p. 5", mark: "m-5" }),
        newBlock(p("I don't get it. ", { type: "compose", attrs: { kind: "ask", handle: "ask", name: "Ask" } }), [newBlock(p("detail"))], { id: "q" }),
      ]),
    ],
  };
  const pm = schema.nodeFromJSON(doc);
  let chipPos = -1;
  pm.descendants((n, pos) => {
    if (n.type.name === "compose") chipPos = pos;
    return chipPos < 0;
  });
  const viaChip = composeScope(pm, chipPos)!;
  const viaAsk = blockScope(pm, pm.resolve(chipPos))!;
  check("/ask sends what a chip sent", viaChip.text === viaAsk.text && viaChip.text === "Under: A parent\n\nI don't get it.\n- detail", JSON.stringify(viaAsk.text));
  check("and is about the same quote", viaChip.quote?.place.mark === viaAsk.quote?.place.mark && viaAsk.quote?.text === "The passage.");
}

{
  // The / menu.
  check("/ offers everything", matchSlashItems("", { canStamp: true }).map((i) => i.id).join(",") === "ask,here,date");
  check("/a narrows to ask", matchSlashItems("a", { canStamp: true }).map((i) => i.id).join(",") === "ask");
  check("/x offers nothing", matchSlashItems("x", { canStamp: true }).length === 0);
  check("here is offered but not runnable with nowhere to point", matchSlashItems("h", { canStamp: false })[0]?.disabled === true);

  const doc: NoteDoc = {
    type: "doc",
    content: [
      newBlock(p("a line"), [], { id: "line" }),
      quoteBlock("Quoted words.", { char: 1, label: "1%", mark: null }),
    ],
  };
  const state = stateOf(doc, endOfHead(doc, "line"));
  check("a slash at the end of a line is a command", slashAllowed(state, state.selection.from));
  check("a slash mid-line is a slash", !slashAllowed(state, state.selection.from - 2));
  const inQuote = state.doc.content.size - 3;
  check("a slash inside a quote is a slash", !slashAllowed(state, inQuote));
}

{
  // What the keys do around a conversation.
  const threadDoc = (): NoteDoc => ({
    type: "doc",
    content: [
      newBlock(p("a"), [], { id: "a" }),
      newBlock(threadHead({ thread: "t-1", kind: "ask", question: "q" }), [newBlock(p("kid"), [], { id: "kid" })], { id: "t" }),
      newBlock(p("d"), [], { id: "d" }),
    ],
  });
  const posOf = (state: EditorState, id: string) => {
    let at = -1;
    state.doc.descendants((n, pos) => {
      if (at < 0 && n.type.name === "noteBlock" && n.attrs.id === id) at = pos;
      return at < 0;
    });
    return at;
  };
  const pickedUp = (state: EditorState, id: string) => {
    const sel = state.selection;
    return "node" in sel && (sel as NodeSelection).node?.attrs.id === id;
  };
  const isNode = (sel: Selection) => "node" in sel && (sel as { node?: unknown }).node != null;

  const base = stateOf(threadDoc(), 2);
  const picked = base.apply(base.tr.setSelection(NodeSelection.create(base.doc, posOf(base, "t"))));
  {
    const r = run(picked, joinBlockBackward);
    check("Backspace on a picked-up conversation takes the line out", r.handled && shape(r.state) === "a\n\nkid\n\nd\n", JSON.stringify(shape(r.state)));
    check("what was under it steps into its place", r.state.doc.child(1).attrs.id === "kid");
    check("the caret lands on the line above", caretText(r.state) === "a");
  }
  {
    const r = run(picked, joinBlockForward);
    check("Delete on a picked-up conversation does the same", r.handled && shape(r.state) === "a\n\nkid\n\nd\n");
  }
  {
    const r = run(picked, splitBlock);
    check("Enter on a picked-up conversation is taken and changes nothing", r.handled && r.tr === null);
  }
  {
    // Backspace at the start of the line below a conversation: picks it up, doesn't eat it.
    const doc = threadDoc();
    doc.content[1].attrs.collapsed = true; // folded, so the conversation IS the line above "d"
    const state = stateOf(doc, endOfHead(doc, "d") - 1);
    const r = run(state, joinBlockBackward);
    check("Backspace at the start of the line below picks the conversation up", r.handled && shape(r.state) === shape(state) && pickedUp(r.state, "t"), JSON.stringify(shape(r.state)));
    // Open, the line above "d" is the conversation's last child, and Backspace joins as usual. From its own first child:
    doc.content[1].attrs.collapsed = false;
    const state2 = stateOf(doc, endOfHead(doc, "kid") - 3);
    const r2 = run(state2, joinBlockBackward);
    check("Backspace at the start of its first child picks the conversation up", r2.handled && pickedUp(r2.state, "t"), JSON.stringify(shape(r2.state)));
    const r3 = run(r2.state, joinBlockBackward);
    check("and the second press takes it out", shape(r3.state) === "a\n\nkid\n\nd\n", JSON.stringify(shape(r3.state)));
  }
  {
    // Delete at the end of the line above a conversation.
    const doc = threadDoc();
    const state = stateOf(doc, endOfHead(doc, "a"));
    const r = run(state, joinBlockForward);
    check("Delete at the end of the line above picks the conversation up", r.handled && shape(r.state) === shape(state) && pickedUp(r.state, "t"));
  }
  {
    // The arrow keys step over it.
    const doc = threadDoc();
    const state = stateOf(doc, endOfHead(doc, "a"));
    const fwd = Selection.findFrom(state.doc.resolve(state.selection.from + 1), 1);
    check("→ from the line above lands on the next line with words", fwd != null && !isNode(fwd) && fwd.$from.parent.textContent === "kid");
    const back = Selection.findFrom(state.doc.resolve(endOfHead(doc, "kid") - 4), -1);
    check("← from the line below lands on the line above", back != null && !isNode(back) && back.$from.parent.textContent === "a");
  }
  {
    // Opening the note lands on a conversation at the end: picked up, not lost.
    const doc: NoteDoc = { type: "doc", content: [newBlock(p("a")), newBlock(threadHead({ thread: "t", kind: "ask", question: "q" }), [], { id: "t" })] };
    const r = run(stateOf(doc, 2), focusEndVisible);
    check("the end of a note that ends in a conversation is the conversation", pickedUp(r.state, "t"));
    check("a picked-up conversation is left where it is", liftHiddenSelection(r.state) === null);
  }
  {
    // Becoming a conversation keeps the line's record, and isn't a new line.
    const doc: NoteDoc = { type: "doc", content: [newBlock(p("words"), [], { id: "w", place: HERE, at: "2020-01-01T00:00:00.000Z" })] };
    const state = stamping(doc, 3);
    const head = state.schema.nodeFromJSON(threadHead({ thread: "t", kind: "ask", question: "words" }));
    const tr = state.tr.replaceWith(1, 1 + state.doc.child(0).firstChild!.nodeSize, head).setMeta(NOTEPAD_NO_STAMP_META, true);
    const next = state.apply(tr);
    check("a line that became a conversation keeps where it was written", recordOf(next, 0).at === "2020-01-01T00:00:00.000Z" && recordOf(next, 0).place?.char === HERE.char);
    check("and reads as one", next.doc.child(0).firstChild!.type.name === "threadBlock");
  }
}

/* ------------------------------------------------------------------ */

if (failures > 0) {
  console.error(`\n${failures} failure${failures === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("\nall good");
