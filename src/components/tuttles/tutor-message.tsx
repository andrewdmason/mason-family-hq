import katex from "katex";
import type { ReactNode } from "react";
import { parseBlocks, type Block, type Inline } from "@/lib/tuttles/markdown";
import { cn } from "@/lib/utils";
import { VisualBlock } from "./visual-block";

/**
 * One tutor reply as the iPhone app shows it: Markdown, KaTeX math, tables and
 * drawn visuals (the format the model is given in VISUALS, prompt.ts). Renders
 * on the server: math is typeset to HTML and visuals to SVG, so the page
 * arrives finished with no client JavaScript. KaTeX's stylesheet is loaded by
 * the Tuttles layout.
 */

function TeX({ tex, display }: { tex: string; display: boolean }) {
  // throwOnError: false renders bad TeX as red source text instead of throwing;
  // trust stays off, so \href and friends can't inject anything.
  const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore" });
  return display ? (
    <span className="tuttles-math-display" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function renderInline(nodes: Inline[], key = "i"): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}-${i}`;
    switch (n.t) {
      case "text":
        return n.v;
      case "strong":
        return (
          <strong key={k} className="font-semibold">
            {renderInline(n.c, k)}
          </strong>
        );
      case "em":
        return <em key={k}>{renderInline(n.c, k)}</em>;
      case "del":
        return <del key={k}>{renderInline(n.c, k)}</del>;
      case "code":
        return (
          <code key={k} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.88em]">
            {n.v}
          </code>
        );
      case "math":
        return <TeX key={k} tex={n.tex} display={n.display} />;
      case "link":
        return (
          <a
            key={k}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
          >
            {renderInline(n.c, k)}
          </a>
        );
      case "br":
        return <br key={k} />;
    }
  });
}

function renderBlocks(blocks: Block[], uid: string, tight = false): ReactNode[] {
  return blocks.map((b, i) => {
    const k = `${uid}-${i}`;
    switch (b.t) {
      case "heading":
        return b.level <= 2 ? (
          <h3 key={k} className="mt-4 text-[1.05rem] font-semibold first:mt-0">
            {renderInline(b.c, k)}
          </h3>
        ) : (
          <h4 key={k} className="mt-3 font-semibold first:mt-0">
            {renderInline(b.c, k)}
          </h4>
        );
      case "paragraph":
        // A tight list item is just its text, without paragraph spacing.
        return tight ? <span key={k}>{renderInline(b.c, k)}</span> : <p key={k}>{renderInline(b.c, k)}</p>;
      case "list": {
        const List = b.ordered ? "ol" : "ul";
        return (
          <List
            key={k}
            start={b.ordered && b.start !== 1 ? b.start : undefined}
            className={cn("space-y-1 pl-5", b.ordered ? "list-decimal" : "list-disc", "marker:text-muted-foreground")}
          >
            {b.items.map((item, j) => {
              const itemTight = item.length === 1 && item[0].t === "paragraph";
              return (
                <li key={j} className={cn(!itemTight && "space-y-1.5")}>
                  {renderBlocks(item, `${k}-${j}`, itemTight)}
                </li>
              );
            })}
          </List>
        );
      }
      case "table":
        return (
          <div key={k} className="-mx-1 overflow-x-auto px-1">
            <table className="my-1 border-collapse text-[0.95em]">
              <thead>
                <tr>
                  {b.head.map((h, j) => (
                    <th
                      key={j}
                      className="border border-foreground/15 bg-muted/50 px-2.5 py-1 font-semibold"
                      style={{ textAlign: b.align[j] ?? "left" }}
                    >
                      {renderInline(h, `${k}-h${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className="border border-foreground/15 px-2.5 py-1"
                        style={{ textAlign: b.align[j] ?? "left" }}
                      >
                        {renderInline(cell, `${k}-${r}-${j}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "quote":
        return (
          <blockquote key={k} className="space-y-2 border-l-2 border-foreground/15 pl-3 text-muted-foreground">
            {renderBlocks(b.c, k)}
          </blockquote>
        );
      case "code":
        return (
          <pre key={k} className="overflow-x-auto rounded-lg bg-muted/60 p-2.5 font-mono text-xs leading-snug">
            {b.v}
          </pre>
        );
      case "visual":
        return <VisualBlock key={k} source={b.source} uid={k} />;
      case "math":
        return (
          <div key={k} className="overflow-x-auto">
            <TeX tex={b.tex} display />
          </div>
        );
      case "hr":
        return <hr key={k} className="border-foreground/10" />;
    }
  });
}

export function TutorMessage({ content, id }: { content: string; id: string }) {
  return (
    <div className="tuttles-message space-y-2.5 text-[0.95rem] leading-relaxed">
      {renderBlocks(parseBlocks(content), `m${id.replace(/[^\w]/g, "")}`)}
    </div>
  );
}
