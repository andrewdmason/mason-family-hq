import type { ReactNode } from "react";

/**
 * A post body rendered as spaced paragraphs. The writer's hard line breaks
 * become paragraph boundaries with breathing room between them, instead of the
 * tight single-spacing that `whitespace-pre-wrap` alone produced (consecutive
 * blank lines collapse to one boundary). `trailing` — e.g. the
 * regenerate/delete controls on a live question — rides at the end of the final
 * paragraph so it stays inline with the text.
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
  const paragraphs = content.split(/\n+/);
  return (
    <div className={"space-y-4" + (className ? " " + className : "")}>
      {paragraphs.map((para, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {para}
          {i === paragraphs.length - 1 && trailing}
        </p>
      ))}
    </div>
  );
}
