import type { ReactNode } from "react";
import { parseMarkdownBlocks } from "@/lib/journal/markdown-blocks";

/**
 * A post body rendered as spaced paragraphs, headings, and bullet lists. The
 * writer's hard line breaks become paragraph boundaries with breathing room
 * between them, instead of the tight single-spacing that `whitespace-pre-wrap`
 * alone produced; markdown-ish lines (`# `, `## `, `### `, `* `/`- `) render as
 * headings and lists, matching the authoring editor. `trailing` — e.g. the
 * regenerate/delete controls on a live question — rides at the end of the final
 * block so it stays inline with the text.
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
  const blocks = parseMarkdownBlocks(content);
  return (
    <div className={"space-y-4" + (className ? " " + className : "")}>
      {blocks.map((block, i) => {
        const isLast = i === blocks.length - 1;
        const tail = isLast ? trailing : null;
        if (block.type === "heading") {
          const body = (
            <>
              {block.text}
              {tail}
            </>
          );
          if (block.level === 1) {
            return (
              <h1 key={i} className="whitespace-pre-wrap text-2xl font-semibold">
                {body}
              </h1>
            );
          }
          if (block.level === 2) {
            return (
              <h2 key={i} className="whitespace-pre-wrap text-xl font-semibold">
                {body}
              </h2>
            );
          }
          return (
            <h3 key={i} className="whitespace-pre-wrap text-lg font-semibold">
              {body}
            </h3>
          );
        }
        if (block.type === "list") {
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
            {tail}
          </p>
        );
      })}
    </div>
  );
}
