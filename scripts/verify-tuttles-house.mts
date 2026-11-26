/**
 * The house in the Tuttles app: what the phone is allowed to send, and what
 * the street it's shown is made of (src/lib/tuttles/house.ts).
 *
 * None of these throw when they break. A house refused for one bad field is a
 * kid's purse that never reaches a new phone; a street that leaves out a kid
 * with no house yet is a brother who can't be found.
 *
 *   npm run verify:tuttles-house
 */

import assert from "node:assert/strict";
import { houseForPhone, parseHouseSync, street } from "../src/lib/tuttles/house";
import { MAX_STATE_BYTES } from "../src/lib/tuttles/math";

// What may be sent.
assert.deepEqual(parseHouseSync(null), { error: "the body must be a JSON object", status: 400 });
assert.deepEqual(parseHouseSync([]), { error: "the body must be a JSON object", status: 400 });
assert.deepEqual(parseHouseSync({}), { state: null, phoneRev: null, dropped: false });
assert.deepEqual(parseHouseSync({ state: null }), { state: null, phoneRev: null, dropped: false });
assert.deepEqual(parseHouseSync({ state: { rev: 4, json: { coins: 120 } } }), { state: { rev: 4, json: { coins: 120 } }, phoneRev: 4, dropped: false });

// A house that can't be kept is dropped and said to be; its rev still says how new the phone's is.
assert.deepEqual(parseHouseSync({ state: { rev: 4, json: [1] } }), { state: null, phoneRev: 4, dropped: true });
assert.deepEqual(parseHouseSync({ state: { rev: -1, json: {} } }), { state: null, phoneRev: Infinity, dropped: true });
assert.deepEqual(parseHouseSync({ state: "x" }), { state: null, phoneRev: Infinity, dropped: true });
const big = { state: { rev: 2, json: { owned: "x".repeat(MAX_STATE_BYTES) } } };
assert.deepEqual(parseHouseSync(big), { state: null, phoneRev: 2, dropped: true });

// What goes back: only a house newer than the phone's, and never over one that couldn't be read.
const kept = { rev: 5, json: { coins: 900 } };
assert.equal(houseForPhone(kept, null), kept);
assert.equal(houseForPhone(kept, 4), kept);
assert.equal(houseForPhone(kept, 5), null);
assert.equal(houseForPhone(kept, Infinity), null);
assert.equal(houseForPhone(null, null), null);

// The street: every kid, in order, with or without a house, and their look from Math.
const kids = [
  { kid: "a", name: "Oscar Mason" },
  { kid: "b", name: "Sebastian Mason" },
];
const houses = new Map([["a", { rev: 3, json: { coins: 10, rooms: ["bedroom"] } }]]);
const maths = new Map([
  ["a", { rev: 9, json: { look: { head: "male-a" }, stars: 0 } }],
  ["b", { rev: 2, json: { look: "not a look" } }],
]);
assert.deepEqual(street(kids, "b", houses, maths), [
  { kid: "a", name: "Oscar", me: false, state: { coins: 10, rooms: ["bedroom"] }, look: { head: "male-a" } },
  { kid: "b", name: "Sebastian", me: true, state: null, look: null },
]);
// The parents have no house: nobody on the street is them.
assert.ok(street(kids, null, houses, maths).every((n) => !n.me));
assert.deepEqual(street([], "a", houses, maths), []);

console.log("tuttles house: ok");
