// Writes the sessions the Tuttles app's tests replay (see ./parity.ts).
//
//   npm run words:parity
import { writeFileSync } from "node:fs";
import { parity, PARITY_FILE } from "./parity";

writeFileSync(PARITY_FILE, parity());
console.log(`wrote ${PARITY_FILE}`);
