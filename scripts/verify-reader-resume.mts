/**
 * Which book Reader opens to.
 *
 * The installed app's start URL is /reader, so this decision is the whole first
 * impression: get it wrong and the app opens to the wrong book every single
 * time, with no gesture that fixes it. That's not hypothetical — a phone parked
 * on I, Claudius went on opening there for days while the reading happened in
 * The Unconsoled on a Boox, because the per-device cookie had no way to lose.
 *
 * The scenarios below are that failure and the ones the fix must not break.
 *
 *   npx tsx scripts/verify-reader-resume.mts
 */

import {
  parseReaderPlace,
  resumeTarget,
  type ResumeCandidate,
} from "../src/lib/reading/last-place";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const CLAUDIUS = "6b108c94-5afd-44d0-be8f-ba807fb7247d";
const UNCONSOLED = "9f7c37a6-082f-4ba9-bcb1-20036f516a7b";
const DALLOWAY = "8fee6c3f-3a0a-478c-aad4-ccc20184037d";

const SUNDAY = "2026-08-02T02:36:19.674Z";
const MONDAY = "2026-08-03T20:45:38.996Z";

function book(bookId: string, lastReadAt: string): ResumeCandidate {
  return { bookId, lastReadAt };
}

function opensTo(place: string | undefined, candidates: ResumeCandidate[]) {
  const target = resumeTarget(parseReaderPlace(place), candidates);
  return target.kind === "book" ? target.bookId : "library";
}

// The bug. The phone last landed on I, Claudius; the reading since has all been
// in The Unconsoled, on another device.
check(
  "a book read since, elsewhere, beats where this device last was",
  opensTo(`book:${CLAUDIUS}`, [
    book(UNCONSOLED, MONDAY),
    book(CLAUDIUS, SUNDAY),
  ]) === UNCONSOLED
);

// The feature, which the fix must not undo: two devices genuinely can be in two
// books, and the one you're holding stays in its own book while it's the one
// being read.
check(
  "the device's own book holds while it's the most recently read",
  opensTo(`book:${CLAUDIUS}`, [
    book(CLAUDIUS, MONDAY),
    book(UNCONSOLED, SUNDAY),
  ]) === CLAUDIUS
);

// Positive evidence only: a book opened deliberately and not yet read has no
// timestamp to lose with, and keeps its place.
check(
  "a book opened but not yet read keeps its place",
  opensTo(`book:${CLAUDIUS}`, [book(UNCONSOLED, MONDAY)]) === CLAUDIUS
);

// Same clock, same book: nothing has overtaken anything.
check(
  "an equal timestamp is not overtaking",
  opensTo(`book:${CLAUDIUS}`, [
    book(UNCONSOLED, MONDAY),
    book(CLAUDIUS, MONDAY),
  ]) === CLAUDIUS
);

// An archived or deleted book isn't a candidate at all. It still goes to the
// read route, which bounces to the shelf and rewrites the cookie — the existing
// self-heal, which only works if we send them there.
check(
  "a book that's gone still goes to the read route to self-heal",
  opensTo(`book:${CLAUDIUS}`, []) === CLAUDIUS
);

// ---- No cookie, or a cookie saying the shelf ------------------------------

check(
  "a device that's never been here opens the most recently read book",
  opensTo(undefined, [book(UNCONSOLED, MONDAY), book(DALLOWAY, SUNDAY)]) ===
    UNCONSOLED
);

check(
  "a brand-new reader with nothing to resume lands on the shelf",
  opensTo(undefined, []) === "library"
);

// Stopping on the shelf is a deliberate act, and the shelf is one tap from every
// book — it's a place to be returned to, not a trap to be rescued from.
check(
  "leaving off on the shelf returns you to the shelf",
  opensTo("library", [book(UNCONSOLED, MONDAY)]) === "library"
);

check(
  "a cookie we didn't write is ignored",
  opensTo("book:not-a-uuid", [book(UNCONSOLED, MONDAY)]) === UNCONSOLED
);

console.log(
  failures === 0
    ? "\nReader opens where you left off, unless the reading says otherwise."
    : `\n${failures} failed`
);
process.exit(failures === 0 ? 0 : 1);
