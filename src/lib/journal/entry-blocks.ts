import type { JournalEntryType, JournalMessageRole } from "@/lib/types";

/**
 * A single addressable unit of a post's body. Comments anchor to a block by its
 * `index`, so the indexing must be stable for a given finished entry — which it
 * is, since comments only exist on closed posts whose content is frozen.
 *
 * `kind` drives how the block renders:
 *   - "user"      — a person's words in an AI-interview transcript
 *   - "assistant" — the interviewer's question (italic, indented)
 *   - "freeform"  — a paragraph of a freeform blog post
 *   - "quote"     — the whole pulled quote (rendered by QuoteEntryView itself)
 *   - "recap"     — the whole recap body (rendered by RecapEntryView itself)
 */
export type EntryBlockKind =
  | "user"
  | "assistant"
  | "freeform"
  | "quote"
  | "recap";

export type EntryBlock = {
  index: number;
  kind: EntryBlockKind;
  content: string;
};

/** Split prose into paragraphs on blank lines, trimming empties. */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Reduce an entry to an ordered list of blocks. The read page and the
 * comment-aware renderer both call this so anchoring and rendering agree on
 * what "block N" is.
 *
 * Per type:
 *   - Standard, no AI replies (all messages are the writer's own — a post
 *     written with question mode off, or a legacy freeform body): one block per
 *     paragraph, so the writing reads as flowing prose.
 *   - Standard with AI replies: one block per message, in order (interleaved
 *     writer/interviewer turns).
 *   - Quote: a single block (the pull quote).
 *   - Recap: a single block (the whole markdown body). Recaps are imported
 *     documents; we keep them as one unit rather than splitting markdown, so
 *     comments stack beneath the recap.
 */
export function getEntryBlocks(args: {
  entryType: JournalEntryType;
  messages: { role: JournalMessageRole; content: string }[];
  pullQuote: string | null;
  recapBody: string | null;
}): EntryBlock[] {
  const { entryType, messages, pullQuote, recapBody } = args;

  if (entryType === "quote") {
    return [{ index: 0, kind: "quote", content: pullQuote ?? "" }];
  }

  if (entryType === "recap") {
    return [{ index: 0, kind: "recap", content: recapBody ?? "" }];
  }

  // standard
  // A post with no interviewer turns (question mode stayed off, or a legacy
  // freeform body saved as one or more user messages) reads as flowing prose:
  // split every message into paragraph blocks. A single empty entry yields none.
  const allUser = messages.length > 0 && messages.every((m) => m.role === "user");
  if (allUser) {
    let index = 0;
    const blocks: EntryBlock[] = [];
    for (const m of messages) {
      for (const content of splitParagraphs(m.content)) {
        blocks.push({ index: index++, kind: "user", content });
      }
    }
    return blocks;
  }

  return messages.map((m, index) => ({
    index,
    kind: m.role,
    content: m.content,
  }));
}
