import type { ReactNode } from "react";

type Block =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] };

/**
 * Split a post body into paragraphs and bullet lists. Each line is a block; runs
 * of lines that start with "* " (or "- ") become one unordered list, blank lines
 * are dropped (spacing comes from the layout, not blank lines). Mirrors the
 * authoring editor's serialization so what you write is what you read.
 */
function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  let list: { type: "ul"; items: string[] } | null = null;
  for (const line of content.split("\n")) {
    const bullet = /^[*-]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list) {
        list = { type: "ul", items: [] };
        blocks.push(list);
      }
      list.items.push(bullet[1]);
    } else {
      list = null;
      if (line.trim() === "") continue;
      blocks.push({ type: "p", text: line });
    }
  }
  return blocks;
}

/**
 * A post body rendered as spaced paragraphs and bullet lists. The writer's hard
 * line breaks become paragraph boundaries with breathing room between them,
 * instead of the tight single-spacing that `whitespace-pre-wrap` alone produced.
 * `trailing` — e.g. the regenerate/delete controls on a live question — rides at
 * the end of the final block so it stays inline with the text.
 *
 * Font/voice styling (serif, size, color) is inherited from the surrounding
 * block, with `className` available to set it on the wrapper when there isn't a
 * styled ancestor.
 */
export function PostBody({
  content,
  trailing,
  className,
}: {
  content: string;
  trailing?: ReactNode;
  className?: string;
}) {
  const blocks = parseBlocks(content);
  return (
    <div className={"space-y-4" + (className ? " " + className : "")}>
      {blocks.map((block, i) => {
        const isLast = i === blocks.length - 1;
        if (block.type === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-6">
              {block.items.map((item, j) => (
                <li key={j} className="whitespace-pre-wrap">
                  {item}
                  {isLast && j === block.items.length - 1 && trailing}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {block.text}
            {isLast && trailing}
          </p>
        );
      })}
    </div>
  );
}
