// The words as the Tuttles app keeps them on the phone (src/lib/words/offline.ts
// sends them; VocabItem in ios/Tuttles/Shared/VocabEngine.swift reads them).

import type { Form, Item, Level } from "@/lib/words/types";

/** One way of asking, as the phone keeps it. A list, not a record: the order is the order they're asked in. */
export type PackForm = { key: string; kind: Form["kind"]; stem: string; answer: string; traps: { text: string; why: string | null }[]; tip: string };

/** A word or word part with everything a question and its lesson need. */
export type PackItem = {
  id: string;
  title: string;
  /** The part of speech, or the kind of word part. */
  pos: string;
  meaning: string;
  example: string | null;
  hook: string;
  /** Ids of the word parts it's built from. */
  parts: string[];
  rank: number;
  forms: PackForm[];
};

export type PackContent = { version: string; level: Level; words: PackItem[]; parts: PackItem[] };

export function packItem(item: Item): PackItem {
  return {
    id: item.id,
    title: item.type === "word" ? item.word : item.part,
    pos: item.type === "word" ? item.pos : item.kind,
    meaning: item.meaning,
    example: item.type === "word" ? item.example : `As in ${item.examples.join(" and ")}.`,
    hook: item.hook,
    parts: item.type === "word" ? item.parts : [],
    rank: item.rank,
    forms: Object.entries(item.forms).map(([key, f]) => ({
      key,
      kind: f.kind,
      stem: f.stem,
      answer: f.answer,
      traps: f.traps.map((t) => ({ text: t.text, why: t.why ?? null })),
      tip: f.tip,
    })),
  };
}
