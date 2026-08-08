import { Fragment } from "react";

/**
 * Emphasis, rendered — nothing else.
 *
 * The recommender writes markdown whether or not it was asked to: book titles
 * come back as *The Memory Police*, and a comparison to *Never Let Me Go* is
 * half the argument. Dropped into a text node those asterisks show through as
 * punctuation, and a rationale full of them reads like a machine's output rather
 * than a librarian's note.
 *
 * Inline only, by design. This renders inside a button that turns the line into
 * an editable field, so a block element or a nested link would be illegal HTML
 * — and a reason line is a paragraph of prose anyway, not a document. Anything
 * that isn't emphasis keeps its literal text: better a stray asterisk than a
 * silently swallowed sentence.
 *
 * The chat panel has its own, larger pass over the same syntax; it also handles
 * headings, lists and page citations, none of which belong on a queue row.
 */

/** Bold, italic, code — in one pass, so they can't nest wrongly. */
const EMPHASIS_RE = /\*\*([^*]+)\*\*|(?<![*\w])\*([^*\n]+)\*|`([^`\n]+)`/g;

export function InlineMarkdown({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  // Built per call: a /g regex carries `lastIndex` between uses, so a shared one
  // would start matching wherever the previous row left off.
  const re = new RegExp(EMPHASIS_RE.source, "g");

  while ((match = re.exec(text)) !== null) {
    const [whole, bold, italic, code] = match;
    if (cursor < match.index) parts.push(text.slice(cursor, match.index));
    if (bold != null) {
      parts.push(<strong className="font-semibold">{bold}</strong>);
    } else if (italic != null) {
      parts.push(<em>{italic}</em>);
    } else {
      parts.push(
        <code className="rounded bg-muted px-1 py-0.5 text-[0.9em]">{code}</code>
      );
    }
    cursor = match.index + whole.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </>
  );
}
