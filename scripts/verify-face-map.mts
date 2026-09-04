/**
 * Carrying an in-paragraph position between faces.
 *
 * Every saved place and every anchor's offset is measured off whatever text is
 * on screen and then expressed in the original char space. The mapping is
 * proportional per paragraph; what matters is that it clamps, round-trips at
 * the ends, is monotonic, and never lands outside either paragraph.
 *
 *   npx tsx scripts/verify-face-map.mts
 */

import { mapOffset, shownLength, toOriginalOffset, toPlainOffset } from "../src/lib/reading/face-map";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const original = 1200;
const plain = 950;

check("offset 0 maps to 0 both ways", toOriginalOffset(0, original, plain) === 0 && toPlainOffset(0, original, plain) === 0);
check("the end maps to the end both ways", toOriginalOffset(plain, original, plain) === original && toPlainOffset(original, original, plain) === plain);
check("beyond the end clamps", toOriginalOffset(plain + 500, original, plain) === original);
check("negative clamps to 0", toOriginalOffset(-5, original, plain) === 0);

let monotonic = true;
let last = -1;
for (let p = 0; p <= plain; p++) {
  const o = toOriginalOffset(p, original, plain);
  if (o < last || o < 0 || o > original) monotonic = false;
  last = o;
}
check("monotonic and in range across the paragraph", monotonic);

let worst = 0;
for (let o = 0; o <= original; o += 7) {
  const back = toOriginalOffset(toPlainOffset(o, original, plain), original, plain);
  worst = Math.max(worst, Math.abs(back - o));
}
check("round trip drifts by at most a character or two", worst <= 2, `worst ${worst}`);
check("within 2% of block length (AE3 budget)", worst <= Math.ceil(original * 0.02));

check("a block with no translation maps identity", mapOffset(333, 1000, 1000) === 333);
check("degenerate lengths map to 0", mapOffset(10, 0, 100) === 0 && mapOffset(10, 100, 0) === 0);
check("shownLength falls back to the original", shownLength(undefined, 3, 42) === 42);
check("shownLength reads the face text", shownLength(() => "abcde", 3, 42) === 5);
check("shownLength honours a null face text", shownLength(() => null, 3, 42) === 42);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
