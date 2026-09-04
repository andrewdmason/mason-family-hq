/**
 * One real chunk through the translator, against the API.
 *
 * Not a test — a smoke check that costs a few cents: the model is reachable
 * (Fable's org requirements are met, or the fallback takes it), structured
 * output comes back in the shape the validator wants, and the prose reads as a
 * translation rather than a summary. Prints the paragraphs side by side and the
 * measured usage, which is what calibrates PLAIN_DOLLARS_PER_1K_CHARS.
 *
 *   npx tsx --tsconfig scripts/tsconfig.json --env-file-if-exists=.env.local scripts/smoke-plain-translate.mts
 */

import { blockMap } from "../src/lib/reading/block-stream";
import { anthropic } from "../src/lib/journal/anthropic";
import { chunkChapter } from "../src/lib/reading/plain/chunk";
import { PLAIN_MODEL, translateChunk } from "../src/lib/reading/plain/translate";

const SAMPLE = [
  "If we leave aside the Scriptures – for the human mind is so skillful that it can easily dream up sheep grazing on the Empire State building – and if we look at the practical disciplines of India, the contradiction becomes even more striking. Indian psychology is based on the very intelligent observation that all things in the universe, from mineral to man, are made up of three elements or qualities (gunas), which may be called by different names depending on the order of reality one considers: tamas, inertia, obscurity, unconsciousness; rajas, movement, struggle, effort, passion, action; sattva, light, harmony, joy. Nowhere does any of these three elements exist in a pure state; we are always a mixture of inertia, passion, and light; we may be sattvo-tamasic, good but a bit dull, well-meaning but a little unconscious; or sattvo-rajasic, impassioned upwardly; or tamaso-rajasic, impassioned downwardly; most often we are an excellent mixture of the three.",
  "In the darkest tamas the light also shines, but unfortunately the opposite is equally true. In other words, we are always in a state of unstable equilibrium; the warrior, the ascetic, and the brute happily share our dwelling-place in varying proportions. The various Indian disciplines seeks therefore to restore the equilibrium, to help us emerge from the play of the three gunas, which rock us endlessly from light to dark, enthusiasm to exhaustion, gray apathy to fugitive pleasures and recurring sufferings, and to find a poise above – in other words, to recover the divine consciousness (yoga), the state of perfect equilibrium.",
  "“The Spirit is not of this world.” — an old saying, repeated by others who were not Indians.",
  "The truth is, this \"poise above\" seems to have no relation with real life whatsoever; first, because all these disciplines are extremely demanding, requiring hours and hours of work every day, if not complete solitude; secondly, because their ultimate result is a state of trance or yogic ecstasy, samadhi, perfect equilibrium, ineffable bliss, in which one's awareness of the world is dissolved, annihilated. Brahman, the Spirit, appears therefore to have absolutely nothing to do with our regular waking consciousness; He is outside all that we know; He is not of this world.",
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html =
  `<h2 id="sec-1" class="reader-heading reader-h2">2. The Eternal Law</h2>` +
  SAMPLE.map((p) => `<p>${esc(p)}</p>`).join("");
const blocks = blockMap(html);
const [chunk] = chunkChapter(blocks, 0, 0, blocks.length);

console.log(`model ${PLAIN_MODEL}; ${chunk.blocks.length} paragraphs, ${chunk.blocks.reduce((n, b) => n + b.text.length, 0)} chars`);
const started = Date.now();
const result = await translateChunk(anthropic(), chunk, {
  title: "Sri Aurobindo, or The Adventure of Consciousness",
  author: "Satprem",
  chapterTitle: "2. The Eternal Law",
}, { allowSplit: false, startWithFallback: false });
const seconds = ((Date.now() - started) / 1000).toFixed(1);

for (const entry of result.entries) {
  const original = blocks[entry.blockIndex].text;
  console.log(`\n--- paragraph ${entry.blockIndex} (${entry.kept ? "KEPT" : `${entry.text!.length}/${original.length} chars`}) ---`);
  console.log(entry.kept ? original : entry.text);
}
console.log(`\n--- terms (${result.terms.length}) ---`);
for (const t of result.terms) console.log(`${t.term}: ${t.definition}`);

const chars = chunk.blocks.reduce((n, b) => n + b.text.length, 0);
console.log(
  `\nmodel used: ${result.model}; ${seconds}s; input ${result.usage.inputTokens} / output ${result.usage.outputTokens} tokens; ` +
    `≈ ${((result.usage.inputTokens / 1e6) * 10 + (result.usage.outputTokens / 1e6) * 50).toFixed(3)} $ live ` +
    `→ ${(((result.usage.inputTokens / 1e6) * 10 + (result.usage.outputTokens / 1e6) * 50) / (chars / 1000)).toFixed(4)} $/1k chars live, half that batched`
);
