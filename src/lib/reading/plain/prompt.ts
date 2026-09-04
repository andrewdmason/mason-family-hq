/**
 * What the translator is told.
 *
 * The whole design is the difference between a translator and an editor. An
 * editor cuts; a translator carries everything across. Every rule below is
 * there to keep the model on the translator's side of that line — the length
 * floor in validate.ts is the mechanical backstop for the same idea.
 *
 * Pure. The chunk arrives as numbered paragraphs and the answer is JSON with the
 * same numbers, which is what lets the validator match them without guessing.
 */

import type { PlainChunk } from "./chunk";

export type PlainPromptBook = {
  title: string;
  author: string | null;
  chapterTitle: string;
};

export function buildPlainSystem(book: PlainPromptBook): string {
  const rules = [
    "You are translating a book from ornate English into plain English, one " +
      "paragraph at a time, for a reader who wants the author's ideas at the " +
      "author's own granularity without the ornament. You are a translator, " +
      "not an editor: carry everything across, cut nothing.",

    "For each paragraph, return one entry with the same number. Keep the " +
      "author's person and tense (their \"we\" stays \"we\"; never write \"the " +
      "author argues\"). Keep every idea, claim, example, qualification, name, " +
      "date, citation, and footnote marker. Keep roughly the same length: a " +
      "plain paragraph runs a little shorter than an ornate one, but if yours " +
      "is much shorter you have summarized, which is the one thing this is not.",

    "Render a figure of speech as its plain meaning when it obscures; keep it " +
      "when it is vivid and clear. Unstack synonyms into one word. Break " +
      "semicolon chains into sentences. Where the original is ambiguous, pick " +
      "the most likely reading and state it plainly rather than hedging — the " +
      "original is one tap away for the reader.",

    "Use action \"keep\" with an empty text for a paragraph that is a quotation " +
      "of another writer, verse, an epigraph, or a passage the reader should " +
      "meet in the author's exact words. Everything else is \"translate\".",

    "Leave a term untranslated when it is the author's technical vocabulary " +
      "or a word with no plain equivalent (a Sanskrit term, a coined phrase, a " +
      "proper name used as a concept). List each such term once in `terms` " +
      "with a one- or two-sentence definition grounded in how THIS book uses " +
      "it, written for a reader at this point in the book — no spoilers from " +
      "later chapters, no dictionary etymology. Do not list ordinary proper " +
      "names of people or places.",

    "The paragraph in <context> is the one just before this stretch, for " +
      "continuity only. Do not translate it and do not return an entry for it.",

    "Return only the JSON object.",
  ];
  const where = book.author ? `${book.title} by ${book.author}` : book.title;
  return rules.join("\n\n") + `\n\nThe book is ${where}. This stretch is from the chapter "${book.chapterTitle}".`;
}

/** The chunk as the model sees it: numbered paragraphs, optional context. */
export function buildPlainUser(chunk: PlainChunk): string {
  const parts: string[] = [];
  if (chunk.contextBefore) {
    parts.push(`<context>\n${escapeXml(chunk.contextBefore)}\n</context>`);
  }
  parts.push("<paragraphs>");
  for (const block of chunk.blocks) {
    parts.push(`<paragraph n="${block.index}">\n${escapeXml(block.text)}\n</paragraph>`);
  }
  parts.push("</paragraphs>");
  return parts.join("\n");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
