/**
 * The notepad: the rules that decide what a place looks like in the stored
 * text, what a pill says, when a new paragraph gets stamped, and how the
 * assistant reads the whole thing.
 *
 * None of these throw when they break. They show up as a pill that renders as
 * its own syntax, a stamp on every line, or an assistant that quotes link
 * markup back at the reader.
 *
 *   npx tsx scripts/verify-reader-notes.mts
 */

import {
  noteBlurb,
  notesForPrompt,
  noteWordCount,
  NOTES_PROMPT_MAX_CHARS,
  parsePlaceHref,
  placeHref,
  placeLabel,
  placeMarkdown,
  placesIn,
  shortChapter,
  shouldStamp,
  STAMP_MIN_MOVE,
} from "../src/lib/reading/notes";

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
  "[Ch. 1 · p. 41](place:1200) The bogey man story is doing a lot of work.",
  "",
  "> Projection is always easier than assimilation. [p. 40](place:1100?mark=m1)",
  "",
  "See also [this](https://example.com) and [27%](place:9000).",
].join("\n");

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

const prompt = notesForPrompt(doc);
check("an empty note is nothing", notesForPrompt("   \n") === null);
check("places become asides", prompt?.text.includes("(at Ch. 1 · p. 41) The bogey man") === true);
check("a mark's place is an aside too", prompt?.text.includes("assimilation. (at p. 40)") === true);
check("no link syntax survives", !/place:\d+/.test(prompt?.text ?? ""));
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

if (failures > 0) {
  console.error(`\n${failures} failure${failures === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("\nall good");
