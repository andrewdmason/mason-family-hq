import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import type { MentionTarget } from "@/lib/reading/mentions";
import type { NotePlace } from "@/lib/reading/notes";
import { COMPOSE_NODE, quoteAbove } from "./notepad-compose";
import { placeNodeJSON } from "./notepad-pill";

/**
 * The @ menu: who a paragraph is for.
 *
 * Two kinds of row and no more. "Ask" starts a conversation with the AI;
 * a person's name starts one with them. There was briefly a third kind —
 * every mark in the book, to pull its quote in — and it was the wrong
 * tool: a highlight now lands in the notes by itself, so the menu is back
 * to being about who reads what you wrote.
 */
export type MentionItem =
  | { kind: "ask" }
  | { kind: "member"; target: MentionTarget };

/**
 * What the React side needs to draw the menu. Handed over through callbacks
 * rather than rendered by the plugin, so the menu is an ordinary component
 * inside the panel — see MentionTypeahead for why that matters: the panel
 * closes on any pointerdown outside itself, so a portalled menu would be the
 * one thing in it that shut it.
 */
export type MentionMenuState = {
  items: MentionItem[];
  activeIndex: number;
  /** Where the caret is, in viewport coordinates. */
  rect: DOMRect | null;
  command: (item: MentionItem) => void;
};

export type MentionController = {
  onChange: (state: MentionMenuState | null) => void;
  /** The current active row, so the plugin's key handling and the menu agree. */
  activeIndex: () => number;
  setActiveIndex: (i: number) => void;
};

export const NOTEPAD_MENTION_KEY = new PluginKey("notepad-mention");

/** Ask first, then everyone, narrowed by what's typed. */
export function matchItems(members: MentionTarget[], query: string): MentionItem[] {
  const q = query.trim().toLowerCase();
  const items: MentionItem[] = [];
  if (!q || "ask".startsWith(q)) items.push({ kind: "ask" });
  for (const t of members) {
    if (t.kind !== "member") continue;
    if (!q || t.handle.startsWith(q) || t.name.toLowerCase().startsWith(q)) {
      items.push({ kind: "member", target: t });
    }
  }
  return items;
}

/**
 * The passage as it lands in the note: a quote, with a pill after it saying
 * where it came from. A COPY — trim it, cut it, keep the one sentence that
 * mattered. The pill stays linked to the mark and the place either way.
 */
export function clipContent(quote: string, place: NotePlace) {
  const lines = quote
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const paragraphs = lines.length > 0 ? lines : [quote.trim()];
  return {
    type: "blockquote",
    content: paragraphs.map((text, i) => ({
      type: "paragraph",
      content:
        i === paragraphs.length - 1
          ? [{ type: "text", text }, { type: "text", text: " " }, placeNodeJSON(place)]
          : [{ type: "text", text }],
    })),
  };
}

/** Set on transactions the notepad makes itself, so the auto-stamp stays out. */
export const NOTEPAD_INSERT_META = "notepad-insert";

export const NotepadMentions = Extension.create<{
  members: () => MentionTarget[];
  controller: MentionController;
}>({
  name: "notepadMentions",

  addOptions() {
    return {
      members: () => [],
      controller: { onChange: () => {}, activeIndex: () => 0, setActiveIndex: () => {} },
    };
  },

  addProseMirrorPlugins() {
    const { controller } = this.options;
    const members = this.options.members;

    const publish = (props: SuggestionProps<MentionItem, MentionItem>) => {
      controller.onChange({
        items: props.items,
        activeIndex: controller.activeIndex(),
        rect: props.clientRect?.() ?? null,
        command: props.command,
      });
    };

    return [
      Suggestion<MentionItem, MentionItem>({
        pluginKey: NOTEPAD_MENTION_KEY,
        editor: this.editor,
        char: "@",
        items: ({ query }) => matchItems(members(), query),
        command: ({ editor, range, props }) => {
          insertChip(editor, range, props);
        },
        render: () => {
          let current: SuggestionProps<MentionItem, MentionItem> | null = null;
          return {
            onStart: (props) => {
              current = props;
              controller.setActiveIndex(0);
              publish(props);
            },
            onUpdate: (props) => {
              current = props;
              if (controller.activeIndex() >= props.items.length) controller.setActiveIndex(0);
              publish(props);
            },
            onExit: () => {
              current = null;
              controller.onChange(null);
            },
            onKeyDown: ({ event }) => {
              if (!current || current.items.length === 0) {
                return event.key === "Escape";
              }
              const n = current.items.length;
              if (event.key === "ArrowDown") {
                controller.setActiveIndex((controller.activeIndex() + 1) % n);
                publish(current);
                return true;
              }
              if (event.key === "ArrowUp") {
                controller.setActiveIndex((controller.activeIndex() - 1 + n) % n);
                publish(current);
                return true;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                const item = current.items[controller.activeIndex()];
                if (item) current.command(item);
                return true;
              }
              return event.key === "Escape";
            },
          };
        },
      }),
    ];
  },
});

/**
 * The chip goes where the @ was. One per paragraph: picking again with a chip
 * already there replaces it rather than stacking two promises on one line.
 */
function insertChip(editor: Editor, range: Range, item: MentionItem) {
  const attrs =
    item.kind === "ask"
      ? { kind: "ask", handle: "ask", name: "Ask" }
      : { kind: "member", handle: item.target.handle, name: item.target.name.split(/\s+/)[0] };

  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setMeta(NOTEPAD_INSERT_META, true);
      return true;
    })
    .command(({ tr, state }) => {
      // Any chip already in this paragraph goes first.
      const $from = state.doc.resolve(range.from);
      const para = $from.parent;
      const start = $from.start();
      let existing: number | null = null;
      para.forEach((child, offset) => {
        if (child.type.name === COMPOSE_NODE) existing = start + offset;
      });
      if (existing != null) tr.delete(existing, existing + 1);
      return true;
    })
    .deleteRange(range)
    .command(({ tr, state }) => {
      const quoted = quoteAbove(state.doc, tr.mapping.map(range.from));
      const type = state.schema.nodes[COMPOSE_NODE];
      const at = tr.mapping.map(range.from);
      tr.insert(at, [type.create({ ...attrs, state: "idle", quoted }), state.schema.text(" ")]);
      return true;
    })
    .run();
}
