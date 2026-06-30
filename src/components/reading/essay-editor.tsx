"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The longform essay writing surface. A contentEditable (not a <textarea>) for the
 * same reason the journal composer is: a textarea can't put space between
 * paragraphs, so the writer's hard breaks read as one tight block — and, worse for
 * an essay, they serialize as a lone "\n" buried in indentation that the grader
 * reads as a single undivided block. Here each paragraph after the first is a
 * <div> (the structure the browser makes on Enter), so pressing Enter shows a real
 * gap AND the saved text carries blank-line paragraph breaks the grader can see.
 *
 * Paragraph-only: no headings, lists, or markdown (this is an essay, and kids
 * can't paste). Uncontrolled — seeded once on mount and then left alone so React
 * never rewrites the DOM out from under the caret. It reports text changes up via
 * onChange; the parent owns the word count and submit.
 */
export function EssayEditor({
  initialText,
  onChange,
  allowPaste,
  disabled = false,
  placeholder = "Start writing…",
  className,
}: {
  initialText: string;
  onChange: (text: string) => void;
  /** Kids type their own essay; only the owner/parent may paste a sample. */
  allowPaste: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Seed the block structure once; thereafter it's uncontrolled.
  useEffect(() => {
    seedEssay(ref.current, initialText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleInput() {
    const el = ref.current;
    if (!el) return;
    // Deleting everything can leave a stray <div><br></div> (textContent ""), which
    // hides the :empty placeholder — hard-clear so it matches again.
    if (el.textContent === "" && el.innerHTML !== "") el.innerHTML = "";
    onChange(readEssay(el));
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!allowPaste) return;
    // Insert as plain text (never the clipboard's own markup); the browser turns
    // newlines into the <div> blocks readEssay reads back as paragraphs.
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
    handleInput();
  }

  return (
    <div
      ref={ref}
      contentEditable={!disabled}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Your essay"
      data-placeholder={placeholder}
      onInput={handleInput}
      onPaste={handlePaste}
      onDrop={(e) => e.preventDefault()}
      className={cn(
        "min-h-[40vh] w-full whitespace-pre-wrap break-words border-0 bg-transparent font-serif text-lg leading-relaxed text-foreground focus:outline-none [&>div]:mt-4 empty:before:pointer-events-none empty:before:text-muted-foreground/50 empty:before:content-[attr(data-placeholder)]",
        disabled && "opacity-60",
        className
      )}
    />
  );
}

/**
 * Build the editor's blocks from stored text: the first paragraph as a bare text
 * node (matching what the browser makes as you type, so the styled <div> siblings
 * all get the gap), the rest as <div>s.
 */
function seedEssay(el: HTMLDivElement | null, text: string) {
  if (!el) return;
  el.textContent = "";
  splitParagraphs(text).forEach((p, i) => {
    if (i === 0) {
      el.appendChild(document.createTextNode(p));
    } else {
      const div = document.createElement("div");
      div.textContent = p;
      el.appendChild(div);
    }
  });
}

/**
 * Read the editor back to text, joining paragraphs with a blank line so the grader
 * sees real breaks. Top-level text and <br>s form the first paragraph; each block
 * child (the <div>s the browser makes on Enter) is its own paragraph.
 */
function readEssay(el: HTMLDivElement | null): string {
  if (!el) return "";
  const paras: string[] = [];
  let current = "";
  const flush = () => {
    const t = current.replace(/ /g, " ").trim();
    if (t) paras.push(t);
    current = "";
  };
  el.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      current += child.textContent ?? "";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = (child as Element).tagName;
      if (tag === "BR") {
        current += "\n";
      } else {
        // A block element (DIV/P) is a paragraph of its own.
        flush();
        const inner = (child.textContent ?? "").replace(/ /g, " ").trim();
        if (inner) paras.push(inner);
      }
    }
  });
  flush();
  return paras.join("\n\n");
}

/**
 * Paragraphs from stored text. New drafts already separate them with a blank line;
 * older textarea drafts used a single "\n" buried in indentation — split on any
 * newline run and trim so both seed as distinct, gap-separated paragraphs.
 */
function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}
