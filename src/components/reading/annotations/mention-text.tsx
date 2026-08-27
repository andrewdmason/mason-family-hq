"use client";

import type { StoredMention } from "@/lib/reading/mentions";

/**
 * A person's message, with the names in it picked out.
 *
 * Deliberately NOT the assistant's renderer. That one reads markdown, because
 * the model writes markdown; a person typing `*maybe*` into a message box means
 * asterisks, and turning them into italics is the app editing somebody's words.
 * So this does one thing — mentions — and leaves every other character alone.
 *
 * Rendered from the offsets the SERVER recorded rather than by parsing the text
 * again here. Two parsers agree until the day the handle rules change, and the
 * failure that day is a chip over the wrong name, next to a grant that went to
 * the right one.
 */
export function MentionText({
  content,
  mentions,
}: {
  content: string;
  mentions: StoredMention[];
}) {
  if (mentions.length === 0) {
    return <span className="whitespace-pre-wrap">{content}</span>;
  }

  const ordered = [...mentions].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let at = 0;

  for (const m of ordered) {
    // An offset that no longer lines up with the text is a message edited by
    // something that shouldn't have — render it plainly rather than slicing at
    // the wrong place.
    if (m.start < at || m.start + m.len > content.length) continue;
    if (m.start > at) parts.push(content.slice(at, m.start));
    parts.push(
      <span
        key={`${m.handle}-${m.start}`}
        className={
          m.kind === "ai"
            ? "rounded bg-primary/10 px-1 font-medium text-primary"
            : "rounded bg-muted px-1 font-medium"
        }
      >
        {content.slice(m.start, m.start + m.len)}
      </span>
    );
    at = m.start + m.len;
  }
  if (at < content.length) parts.push(content.slice(at));

  return <span className="whitespace-pre-wrap">{parts}</span>;
}
