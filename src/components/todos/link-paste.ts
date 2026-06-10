"use client";

import { Extension, type Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

// A clipboard that is exactly one URL and nothing else.
const URL_ONLY = /^https?:\/\/\S+$/i;

// One lookup per URL per page load — pasting the same link into several
// tasks shouldn't refetch, and concurrent pastes share the in-flight promise.
const titleCache = new Map<string, Promise<string | null>>();

function fetchTitle(url: string): Promise<string | null> {
  let pending = titleCache.get(url);
  if (!pending) {
    pending = fetch(`/api/todo/link-title?url=${encodeURIComponent(url)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => (typeof body?.title === "string" && body.title ? body.title : null))
      .catch(() => null);
    titleCache.set(url, pending);
  }
  return pending;
}

/**
 * Once the page title resolves, swap it in as the link's text — but only
 * where the document still shows the raw URL with that same href. If the
 * user already renamed or deleted the link, there's nothing to find and the
 * swap is a no-op. Position math stays honest by collecting matches first
 * and replacing back-to-front in one transaction.
 */
async function swapInTitle(editor: Editor, url: string) {
  const title = await fetchTitle(url);
  if (!title || title === url || editor.isDestroyed) return;
  const { state } = editor.view;
  const linkType = state.schema.marks.link;
  const targets: { from: number; to: number; marks: Mark[] }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText || node.text !== url) return;
    if (node.marks.some((m) => m.type === linkType && m.attrs.href === url)) {
      targets.push({ from: pos, to: pos + node.nodeSize, marks: [...node.marks] });
    }
  });
  if (targets.length === 0) return;
  let tr = state.tr;
  for (const t of targets.reverse()) {
    tr = tr.replaceWith(t.from, t.to, state.schema.text(title, t.marks));
  }
  editor.view.dispatch(tr);
}

/**
 * Link ergonomics for the notes editor:
 *
 * - Paste a URL over selected text → the selection becomes a hyperlink
 *   (Slack behavior).
 * - Paste a URL at a bare cursor → inserted as a link immediately, and the
 *   page title replaces the raw URL once /api/todo/link-title resolves it
 *   (Notion behavior). If the lookup fails, the URL-as-link stays.
 * - Click opens the link in a new tab (Linear behavior) — to edit the link's
 *   text, click beside it and arrow in. Drag-selecting across a link still
 *   works; ProseMirror only reports clicks, not drags.
 *
 * High priority so this handlePaste runs before tiptap-markdown's clipboard
 * parsing and the Link extension's own linkOnPaste.
 */
export const LinkPaste = Extension.create({
  name: "linkPaste",
  priority: 1000,

  addProseMirrorPlugins() {
    const { editor } = this;
    return [
      new Plugin({
        key: new PluginKey("linkPaste"),
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
            if (!URL_ONLY.test(text)) return false;
            const { state } = view;
            const linkType = state.schema.marks.link;
            if (!linkType) return false;
            const { empty, from, to } = state.selection;

            if (!empty) {
              view.dispatch(state.tr.addMark(from, to, linkType.create({ href: text })));
              return true;
            }

            const tr = state.tr.insertText(text, from);
            tr.addMark(from, from + text.length, linkType.create({ href: text }));
            // Typing right after the paste should continue unlinked.
            tr.removeStoredMark(linkType);
            view.dispatch(tr);
            void swapInTitle(editor, text);
            return true;
          },
          handleClick(_view, _pos, event) {
            // Shift+click keeps its native meaning (extend the selection).
            if (event.button !== 0 || event.shiftKey) return false;
            const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
            const href = anchor?.getAttribute("href");
            if (!href) return false;
            window.open(href, "_blank", "noopener,noreferrer");
            return true;
          },
        },
      }),
    ];
  },
});
