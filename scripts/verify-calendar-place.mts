/**
 * Calendar: where an event is, apart from how it's joined (src/lib/calendar/place.ts).
 *
 * None of this throws when it breaks. A link read as a place shows up as a map
 * pin that searches Maps for a URL and a Zoom lesson that wants a driver; a
 * place read as a link shows up as a practice with no drop-off to arrange.
 *
 * The link itself is found by the database (calendar_join_url, migration
 * 00221); the same cases are in ios/Calendar/Tests/CalendarRulesTests.swift.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json scripts/verify-calendar-place.mts
 */

import assert from "node:assert/strict";
import { isPlace, isRemote, joinName, placeText, whereLine } from "@/lib/calendar/place";

// The location without its link.
assert.equal(placeText("Crowden School, 1475 Rose St, Berkeley"), "Crowden School, 1475 Rose St, Berkeley");
assert.equal(placeText("https://us02web.zoom.us/j/8123?pwd=abc"), null);
assert.equal(placeText("Click to join meeting: https://book.example.com/m/42"), null);
assert.equal(placeText("Zoom Meeting - https://zoom.us/j/1"), null);
assert.equal(placeText("Room 4, Crowden School — https://zoom.us/j/1"), "Room 4, Crowden School");
assert.equal(placeText("Room 4, zoom.us/j/123"), "Room 4");
assert.equal(placeText("St. Mary's Hall\n2501 Grove St"), "St. Mary's Hall\n2501 Grove St");
assert.equal(placeText("  "), null);
assert.equal(placeText(null), null);

// Somewhere to map and drive to.
assert.equal(isPlace("Field 3"), true);
assert.equal(isPlace("Room 4 https://zoom.us/j/1"), true);
for (const nowhere of ["TBD", "n/a", "Zoom", "Online", "Phone call", "https://meet.google.com/abc-defg-hij", null]) {
  assert.equal(isPlace(nowhere), false, String(nowhere));
}

// On a call and nowhere else: no drop-off or pick-up.
const zoom = "https://zoom.us/j/1";
assert.equal(isRemote({ location: zoom, join_url: zoom }), true);
assert.equal(isRemote({ location: null, join_url: zoom }), true); // link in the description
assert.equal(isRemote({ location: "TBD", join_url: zoom }), true);
assert.equal(isRemote({ location: "Zoom", join_url: null }), true);
assert.equal(isRemote({ location: "Crowden School", join_url: zoom }), false); // in person, with a remote option
assert.equal(isRemote({ location: "TBD", join_url: null }), false);
assert.equal(isRemote({ location: null, join_url: null }), false);

// What the link is called.
assert.equal(joinName("https://us02web.zoom.us/j/8123"), "Zoom");
assert.equal(joinName("https://meet.google.com/abc-defg-hij"), "Google Meet");
assert.equal(joinName("https://teams.microsoft.com/l/meetup-join/19%3a"), "Microsoft Teams");
assert.equal(joinName("https://teams.live.com/meet/9334"), "Microsoft Teams");
assert.equal(joinName("https://acme.webex.com/meet/bob"), "Webex");
assert.equal(joinName("https://facetime.apple.com/join#v=1"), "FaceTime");
assert.equal(joinName("https://www.book.example.com/m/42"), "book.example.com");
assert.equal(joinName("https://notzoom.us/j/1"), "notzoom.us");

// The one line a compact view shows.
assert.deepEqual(whereLine({ location: "Field 3", join_url: null }), { text: "Field 3", call: false });
assert.deepEqual(whereLine({ location: zoom, join_url: zoom }), { text: "Zoom", call: true });
assert.deepEqual(whereLine({ location: "Room 4 " + zoom, join_url: zoom }), { text: "Room 4", call: false });
assert.deepEqual(whereLine({ location: null, join_url: "https://meet.google.com/abc" }), { text: "Google Meet", call: true });
assert.deepEqual(whereLine({ location: "TBD", join_url: null }), { text: "TBD", call: false });
assert.deepEqual(whereLine({ location: "Zoom", join_url: null }), { text: "Zoom", call: true });
assert.equal(whereLine({ location: null, join_url: null }), null);

console.log("calendar place: ok");
