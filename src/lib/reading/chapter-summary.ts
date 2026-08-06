import { chapterName } from "@/lib/reading/chapter-target";

/**
 * The two strings a chapter summary is made of, in one place because the client
 * and the server both write them and they have to agree.
 *
 * The reader taps a chapter title, and the thread opens showing the question
 * already asked before the server has been reached — so the client renders its
 * own copy of that question while the route persists the real one. If the two
 * ever differed, the question would silently change the next time the thread was
 * opened, which reads as the app rewriting what you said.
 *
 * Pure and client-safe: imported by the reader, the panel, and the route.
 */

/**
 * What the mark in the page says. Fixed rather than a slice of the summary: it
 * sits under a chapter heading in a book, where the honest thing for it to be is
 * a label saying the summary exists, not a teaser that reads like prose the
 * author wrote.
 */
export const CHAPTER_SUMMARY_MARK_TEXT = "Chapter summary";

/**
 * The opening turn of a summary thread, written as the reader's own question so
 * the transcript reads the way every other one does — and so follow-ups reach
 * the ordinary chat route with a first turn that names which chapter this was
 * ever about.
 *
 * Quoted rather than interpolated bare: a chapter is as likely to be called "8"
 * as "The Gallery", and `Summarize 8.` names nothing.
 */
export function chapterSummaryQuestion(title: string): string {
  return `Summarize "${chapterName(title)}".`;
}
