"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A task's notes, rendered but not editable — with the checklist still live.
 *
 * Focus mode needs the notes visible (a lot of tasks are a thin title over a
 * checklist) without an editor, for two reasons: a focused Tiptap surface
 * swallows the mode's single-letter keys, and `@tiptap/extension-task-item`'s
 * read-only checkbox hook only touches the DOM — it never updates the document,
 * so getHTML() would keep reporting the old state.
 *
 * So this renders the stored HTML directly and treats the DOM as the document.
 * That works because the checklist markup Tiptap stores is plain attributes
 * (`<li data-checked>` + `<input type="checkbox">`), the `.prose-editor` styles
 * are attribute selectors rather than ProseMirror classes, and the server's
 * notes sanitizer already whitelists exactly those attributes — so a tick
 * round-trips byte-for-byte through save and reload.
 */
export function TodoNotesReadonly({
  html,
  onChange,
  /** True while a mutation is in flight — server props are stale then. */
  idle,
  className,
}: {
  html: string;
  onChange: (html: string) => void;
  idle: () => boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [local, setLocal] = useState(html);

  // Adopt server HTML only between mutations: a refresh-on-focus landing
  // mid-save would otherwise visibly un-tick the box you just ticked. Done
  // during render (cf. task-list.tsx's view reset) so the notes never paint a
  // frame of the old document.
  const [adopted, setAdopted] = useState(html);
  if (html !== adopted && idle()) {
    setAdopted(html);
    setLocal(html);
  }

  // Kept in a ref so the listener below is bound once per document rather than
  // re-bound whenever the parent re-renders with a fresh closure. Declared
  // first: effects run in order, so it's current by the time the tick fires.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Notes links open in a new tab — following one in place would drop you
    // out of focus mode, with no back button on screen to return with.
    el.querySelectorAll("a").forEach((a) => {
      a.target = "_blank";
      a.rel = "noreferrer";
    });

    // A native listener rather than React's onChange: these nodes come from
    // innerHTML, so React has no fiber for them and its synthetic change
    // event never reaches a handler on the wrapper.
    const onCheck = (e: Event) => {
      const input = e.target;
      if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") {
        return;
      }
      const item = input.closest("li[data-checked]");
      if (!item) return;

      item.setAttribute("data-checked", String(input.checked));
      // The *attribute*, not the property: only the attribute serializes into
      // innerHTML, and Tiptap re-parses the item's state from data-checked.
      input.toggleAttribute("checked", input.checked);
      // A checkbox that keeps focus would eat the mode's `e` and Enter.
      input.blur();

      const next = el.innerHTML;
      setLocal(next);
      onChangeRef.current(next);
    };

    el.addEventListener("change", onCheck);
    return () => el.removeEventListener("change", onCheck);
  }, [local]);

  return (
    <div
      ref={ref}
      className={cn("prose-editor prose-editor-compact", className)}
      // Every write path to notes_html sanitizes first (the todos server
      // actions via sanitizeNotesHtml, the ingest and agent APIs via
      // plainTextToNotesHtml, which escapes) — this renders stored, cleaned
      // markup, never anything user-supplied at read time.
      dangerouslySetInnerHTML={{ __html: local }}
    />
  );
}
