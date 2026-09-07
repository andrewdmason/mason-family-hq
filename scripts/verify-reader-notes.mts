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

if (failures > 0) {
  console.error(`\n${failures} failure${failures === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("\nall good");
