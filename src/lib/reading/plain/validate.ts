/**
 * Checking a translator's answer before anything is stored.
 *
 * Pure. The whole contract between the model and the reader is here: one entry
 * per paragraph, in order, either translated at roughly the original length or
 * kept with no text at all. Anything else reruns the chunk — a translation
 * that quietly dropped a paragraph is worse than no translation, because the
 * reader would never know it was gone.
 */

import type { BookBlock } from "@/lib/reading/block-stream";
import { PLAIN_LENGTH_FLOOR } from "./constants";

/** What the model is asked to return for one chunk. */
export type PlainOutput = {
  paragraphs: { n: number; action: "translate" | "keep"; text: string }[];
  terms: { term: string; definition: string }[];
};

export type ValidatedEntry = {
  blockIndex: number;
  kept: boolean;
  /** Null when kept. */
  text: string | null;
};

export type ValidatedTerm = { term: string; definition: string };

export type ValidationResult =
  | { ok: true; entries: ValidatedEntry[]; terms: ValidatedTerm[] }
  | { ok: false; reason: string; blockIndex: number | null };

/**
 * The JSON schema the model's output is constrained to.
 *
 * `text` is required even for kept entries (structured outputs want every
 * property present); a kept entry carries the empty string, and the validator
 * insists on that so a "kept" paragraph can never smuggle a rewrite through.
 */
export const PLAIN_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          action: { type: "string", enum: ["translate", "keep"] },
          text: { type: "string" },
        },
        required: ["n", "action", "text"],
        additionalProperties: false,
      },
    },
    terms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          term: { type: "string" },
          definition: { type: "string" },
        },
        required: ["term", "definition"],
        additionalProperties: false,
      },
    },
  },
  required: ["paragraphs", "terms"],
  additionalProperties: false,
} as const;

/** Parse the model's text as PlainOutput, or null if it isn't one. */
export function parsePlainOutput(text: string): PlainOutput | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.paragraphs)) return null;
  const paragraphs: PlainOutput["paragraphs"] = [];
  for (const item of obj.paragraphs) {
    if (!item || typeof item !== "object") return null;
    const p = item as Record<string, unknown>;
    if (typeof p.n !== "number" || !Number.isInteger(p.n)) return null;
    if (p.action !== "translate" && p.action !== "keep") return null;
    if (typeof p.text !== "string") return null;
    paragraphs.push({ n: p.n, action: p.action, text: p.text });
  }
  const terms: PlainOutput["terms"] = [];
  if (Array.isArray(obj.terms)) {
    for (const item of obj.terms) {
      if (!item || typeof item !== "object") continue;
      const t = item as Record<string, unknown>;
      if (typeof t.term !== "string" || typeof t.definition !== "string") continue;
      terms.push({ term: t.term, definition: t.definition });
    }
  }
  return { paragraphs, terms };
}

/**
 * Check one chunk's output against the paragraphs that were sent.
 *
 * `input` is the chunk's blocks in order; entries must match them one-to-one by
 * block index. Terms are cleaned rather than failed: a malformed term costs a
 * gloss, a malformed paragraph costs the reader a paragraph.
 */
export function validateChunk(input: BookBlock[], output: PlainOutput): ValidationResult {
  if (output.paragraphs.length !== input.length) {
    const seen = new Set(output.paragraphs.map((p) => p.n));
    const missing = input.find((b) => !seen.has(b.index));
    return {
      ok: false,
      reason: `expected ${input.length} paragraphs, got ${output.paragraphs.length}`,
      blockIndex: missing?.index ?? null,
    };
  }

  const byIndex = new Map<number, PlainOutput["paragraphs"][number]>();
  for (const p of output.paragraphs) {
    if (byIndex.has(p.n)) {
      return { ok: false, reason: `paragraph ${p.n} appears twice`, blockIndex: p.n };
    }
    byIndex.set(p.n, p);
  }

  const entries: ValidatedEntry[] = [];
  for (const block of input) {
    const p = byIndex.get(block.index);
    if (!p) {
      return { ok: false, reason: `paragraph ${block.index} missing`, blockIndex: block.index };
    }
    if (p.action === "keep") {
      if (p.text.trim().length > 0) {
        return {
          ok: false,
          reason: `kept paragraph ${block.index} carries text`,
          blockIndex: block.index,
        };
      }
      entries.push({ blockIndex: block.index, kept: true, text: null });
      continue;
    }
    const text = p.text.trim();
    if (text.length === 0) {
      return { ok: false, reason: `paragraph ${block.index} is empty`, blockIndex: block.index };
    }
    const floor = Math.floor(block.text.trim().length * PLAIN_LENGTH_FLOOR);
    if (text.length < floor) {
      return {
        ok: false,
        reason: `paragraph ${block.index} is ${text.length} chars, floor is ${floor}`,
        blockIndex: block.index,
      };
    }
    entries.push({ blockIndex: block.index, kept: false, text });
  }

  const terms: ValidatedTerm[] = [];
  const seenTerms = new Set<string>();
  for (const t of output.terms) {
    const term = t.term.trim();
    const definition = t.definition.trim();
    if (!term || !definition) continue;
    if (term.length > 80 || definition.length > 600) continue;
    const key = termKey(term);
    if (seenTerms.has(key)) continue;
    seenTerms.add(key);
    terms.push({ term, definition });
  }

  return { ok: true, entries, terms };
}

/** The lookup key for a term: lowercase, accents folded, inner whitespace collapsed. */
export function termKey(term: string): string {
  return term
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
