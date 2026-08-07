"use client";

import { Fragment } from "react";
import { parseMarkdownBlocks, type MarkdownBlock } from "@/lib/journal/markdown-blocks";
import { cn } from "@/lib/utils";

/**
 * An assistant reply: markdown rendered, with "[p.212]" citations turned into
 * jump chips.
 *
 * The model writes markdown whether or not it was asked to — headings and
 * bullets the moment a question wants structure, and "chapter by chapter" wants
 * a lot of it. This used to be dropped into a div as one text node, so every
 * newline collapsed and the syntax showed through: a chapter summary arrived as
 * a single wall of prose with "## Chapter 2" sitting in the middle of it.
 *
 * Blocks come from the same parser the journal uses, so the two agree about what
 * a heading and a bullet are. What's added here is the inline pass — emphasis,
 * code, and the citations — because a chip is a button, and no markdown parser
 * is going to produce one of those.
 *
 * Typography is deliberately restrained. This is a panel beside a book, not a
 * document: headings are a weight and a size step, not a title page.
 */

/**
 * Citations, links, emphasis and code, in one pass so they can't nest wrongly.
 *
 * The page citation comes first and the link second, and they can't be
 * confused: a citation is "[p.212]" with nothing after the bracket, and a link
 * always has "(http…)" after it. Links only ever appear in the Sources line the
 * chat route appends to a searched answer — the model is told not to write URLs
 * — but they're rendered generally rather than as a special case, because a
 * markdown link in a reply should be a link wherever it turns up.
 */
export const INLINE_RE =
  /\[p\.(\d+)\]|\*\*([^*]+)\*\*|(?<![*\w])\*([^*\n]+)\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** The parser tops out at ###; anything deeper is still a small heading. */
const DEEP_HEADING = /^(\s*)#{4,6}(\s+)/gm;

/** "1." or "1)" — the model numbers steps and ranked lists constantly. */
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

type ChatBlock = MarkdownBlock | { type: "ordered"; items: string[] };

/**
 * The journal's blocks, plus numbered lists.
 *
 * Ordered lists are handled here rather than in the shared parser because that
 * parser also seeds the journal's authoring editor, and a block type it doesn't
 * know how to turn back into a DOM node would break writing a post to fix
 * reading one. Runs of numbered lines are lifted out first; everything between
 * them goes through the shared parser unchanged, so headings and bullets mean
 * exactly what they mean in a journal entry.
 */
function chatBlocks(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  let plain: string[] = [];
  let ordered: string[] | null = null;

  const flushPlain = () => {
    if (plain.length > 0) blocks.push(...parseMarkdownBlocks(plain.join("\n")));
    plain = [];
  };

  for (const line of text.split("\n")) {
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      if (!ordered) {
        flushPlain();
        ordered = [];
        blocks.push({ type: "ordered", items: ordered });
      }
      ordered.push(numbered[1]);
      continue;
    }
    // A blank line inside a numbered list is spacing, not the end of it.
    if (ordered && line.trim() === "") continue;
    ordered = null;
    plain.push(line);
  }
  flushPlain();
  return blocks;
}

export function ChatMessageText({
  text,
  hasRealPages,
  labelForPage,
  onJumpToPage,
  spacing = "reply",
}: {
  text: string;
  hasRealPages: boolean;
  /** Percent-through-the-book for a page, when real page numbers aren't shown. */
  labelForPage: (page: number) => string | null;
  onJumpToPage: (page: number) => void;
  /**
   * How far apart the paragraphs sit. A reply is a few lines and wants to read
   * as one utterance; the reader's own preface or afterword is eight hundred
   * words down a narrow column, where the same tight spacing reads as one
   * unbroken block and the eye has nowhere to rest.
   */
  spacing?: "reply" | "document";
}) {
  const inline = (source: string, keyPrefix: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null;
    // Built per call: a shared /g regex carries `lastIndex` between renders, so a
    // module-level one would start matching from wherever the previous message
    // stopped and silently drop citations.
    const re = new RegExp(INLINE_RE.source, "g");

    while ((match = re.exec(source)) !== null) {
      const [whole, page, bold, italic, code, linkText, linkHref] = match;
      const key = `${keyPrefix}-${match.index}`;
      let node: React.ReactNode = null;

      if (page != null) {
        const number = Number(page);
        const label = hasRealPages ? `p.${number}` : labelForPage(number);
        // A citation we can't label meaningfully is dropped rather than shown as
        // a number that corresponds to nothing the reader can see.
        if (label) {
          node = (
            <button
              key={key}
              type="button"
              onClick={() => onJumpToPage(number)}
              className="mx-0.5 inline-flex items-baseline rounded bg-muted px-1.5 py-0.5 align-baseline text-[0.8em] font-medium tabular-nums text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              title="Jump to this passage"
            >
              {label}
            </button>
          );
        }
      } else if (bold != null) {
        node = <strong key={key} className="font-semibold">{bold}</strong>;
      } else if (italic != null) {
        node = <em key={key}>{italic}</em>;
      } else if (code != null) {
        node = (
          <code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
            {code}
          </code>
        );
      } else if (linkHref != null) {
        // A new tab, always. This opens from a panel beside a half-read book,
        // and navigating the reader away from their place to show them a
        // footnote would be the worst possible trade.
        node = (
          <a
            key={key}
            href={linkHref}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:decoration-foreground"
          >
            {linkText}
          </a>
        );
      }

      if (cursor < match.index) parts.push(source.slice(cursor, match.index));
      // An unlabelled citation leaves nothing behind; anything else that didn't
      // become a node keeps its literal text rather than vanishing.
      if (node) parts.push(node);
      else if (page == null) parts.push(whole);
      cursor = match.index + whole.length;
    }
    if (cursor < source.length) parts.push(source.slice(cursor));

    return parts.map((p, i) => <Fragment key={i}>{p}</Fragment>);
  };

  const blocks = chatBlocks(text.replace(DEEP_HEADING, "$1###$2"));

  return (
    <div className={spacing === "document" ? "space-y-4" : "space-y-2.5"}>
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          const body = inline(block.text, `h${i}`);
          // Only the first level gets its own size; below that a heading is a
          // label on the next few sentences, and a panel this narrow can't
          // afford a hierarchy of type sizes.
          return block.level === 1 ? (
            <h3
              key={i}
              className="mt-4 text-[0.95rem] font-semibold first:mt-0"
            >
              {body}
            </h3>
          ) : (
            <h4 key={i} className="mt-3 font-semibold first:mt-0">
              {body}
            </h4>
          );
        }
        if (block.type === "list" || block.type === "ordered") {
          const List = block.type === "ordered" ? "ol" : "ul";
          return (
            <List
              key={i}
              className={cn(
                "space-y-1 pl-5",
                block.type === "ordered" ? "list-decimal" : "list-disc"
              )}
            >
              {block.items.map((item, j) => (
                <li key={j}>{inline(item, `l${i}-${j}`)}</li>
              ))}
            </List>
          );
        }
        return <p key={i}>{inline(block.text, `p${i}`)}</p>;
      })}
    </div>
  );
}
