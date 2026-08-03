/**
 * When one device offers you another device's place in the book.
 *
 * The scenarios below are the ones that actually happen in this house — a phone
 * at bedtime and a Boox on the kitchen table — and every one of them is a case
 * where getting it wrong is invisible until someone loses an evening's reading.
 * The rules are cheap to state and easy to break by "improving" one of them, so
 * they're pinned here rather than left to the reading of shouldOfferElsewhere.
 *
 *   npx tsx scripts/verify-position-sync.mts
 */

import {
  ELSEWHERE_MIN_CHARS,
  localPositionWins,
  shouldOfferElsewhere,
} from "../src/lib/reading/position-sync";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const MONDAY = "2026-08-03T20:00:00.000Z";
const TUESDAY = "2026-08-04T20:00:00.000Z";

// The whole point of the feature: a device sitting open on yesterday's page,
// woken after an evening's reading somewhere else.
check(
  "a device left open is offered the place the phone reached",
  shouldOfferElsewhere({
    remote: { charOffset: 400_000, savedAt: TUESDAY },
    ourSavedAt: MONDAY,
    current: 150_000,
    answered: null,
  })
);

// The common case, and the one that must stay quiet: the row we're being shown
// is the row we wrote. Nothing has happened.
check(
  "our own position coming back is not an offer",
  !shouldOfferElsewhere({
    remote: { charOffset: 400_000, savedAt: TUESDAY },
    ourSavedAt: TUESDAY,
    current: 400_000,
    answered: null,
  })
);

// Same, with clock skew between the device and the server: the time test passes
// but the position is ours, so the position test has to be the one that saves it.
check(
  "a server clock a minute ahead of ours doesn't invent an offer",
  !shouldOfferElsewhere({
    remote: { charOffset: 400_000, savedAt: "2026-08-04T20:01:00.000Z" },
    ourSavedAt: TUESDAY,
    current: 400_000,
    answered: null,
  })
);

// Two devices laying the same book out differently land a few characters apart.
check(
  "a difference smaller than a paragraph is not worth asking about",
  !shouldOfferElsewhere({
    remote: { charOffset: 400_000 + ELSEWHERE_MIN_CHARS - 1, savedAt: TUESDAY },
    ourSavedAt: MONDAY,
    current: 400_000,
    answered: null,
  })
);

// Backwards is a real place to have left off — someone re-read a chapter on
// their phone. A furthest-page-wins rule would make that impossible to sync.
check(
  "going back on another device is offered too",
  shouldOfferElsewhere({
    remote: { charOffset: 5_000, savedAt: TUESDAY },
    ourSavedAt: MONDAY,
    current: 400_000,
    answered: null,
  })
);

check(
  "a book nobody has ever read is not an offer",
  !shouldOfferElsewhere({
    remote: null,
    ourSavedAt: null,
    current: 0,
    answered: null,
  })
);

// A row with no timestamp is from before positions were timed; there's no way to
// tell whose it is, and guessing wrong moves someone's page.
check(
  "an untimed row is not an offer",
  !shouldOfferElsewhere({
    remote: { charOffset: 400_000, savedAt: null },
    ourSavedAt: MONDAY,
    current: 150_000,
    answered: null,
  })
);

// Opening a book on a device that has never read it: nothing of ours to compare
// against, and the server's position is the resume point we already opened at.
check(
  "a fresh device with no history of its own still isn't asked about its own resume point",
  !shouldOfferElsewhere({
    remote: { charOffset: 400_000, savedAt: TUESDAY },
    ourSavedAt: null,
    current: 400_000,
    answered: null,
  })
);

// "No thanks" has to stick, or every glance at the device asks again — a device
// left open elsewhere goes on re-saving the same position with a new time.
check(
  "a place already turned down doesn't ask again",
  !shouldOfferElsewhere({
    remote: { charOffset: 400_000, savedAt: TUESDAY },
    ourSavedAt: MONDAY,
    current: 150_000,
    answered: 400_000,
  })
);

check(
  "but somewhere genuinely different does",
  shouldOfferElsewhere({
    remote: { charOffset: 460_000, savedAt: TUESDAY },
    ourSavedAt: MONDAY,
    current: 150_000,
    answered: 400_000,
  })
);

// ---- Restoring the device's own unsynced position -------------------------

check(
  "reading offline is restored over the place the book opened at",
  localPositionWins(TUESDAY, MONDAY)
);

check(
  "a book never read on the server restores whatever the device has",
  localPositionWins(MONDAY, null)
);

// The one that would take a reader backwards, and then publish the backwards
// place over the good one on the first page turn.
check(
  "an unsynced position older than the server's is not restored",
  !localPositionWins(MONDAY, TUESDAY)
);

console.log(
  failures === 0
    ? "\nA device only offers another device's place when there is one, and only once."
    : `\n${failures} failed`
);
process.exit(failures === 0 ? 0 : 1);
