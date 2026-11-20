import "server-only";

import lower from "@/lib/words/content/lower.json";
import middle from "@/lib/words/content/middle.json";
import partsJson from "@/lib/words/content/parts.json";
import type { Item, Level, PartItem, WordItem } from "@/lib/words/types";

// The words and word parts, as written by scripts/words/build.mts. Read once
// per server and kept; they only change with a deploy.

const WORDS: Record<Level, WordItem[]> = {
  lower: (lower as unknown as WordItem[]).slice().sort((a, b) => a.rank - b.rank),
  middle: (middle as unknown as WordItem[]).slice().sort((a, b) => a.rank - b.rank),
};
const PARTS = (partsJson as unknown as PartItem[]).slice().sort((a, b) => a.rank - b.rank);

const INDEX: Record<Level, Map<string, Item>> = {
  lower: new Map<string, Item>([...WORDS.lower, ...PARTS].map((it) => [it.id, it])),
  middle: new Map<string, Item>([...WORDS.middle, ...PARTS].map((it) => [it.id, it])),
};

export function wordsFor(level: Level): WordItem[] {
  return WORDS[level];
}

export function allParts(): PartItem[] {
  return PARTS;
}

export function findItem(level: Level, id: string): Item | undefined {
  return INDEX[level].get(id);
}

export function titleOf(item: Item): string {
  return item.type === "word" ? item.word : item.part;
}
