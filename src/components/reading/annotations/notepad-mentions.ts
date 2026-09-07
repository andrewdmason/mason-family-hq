import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import type { NotePlace } from "@/lib/reading/notes";
import { placeNodeJSON } from "./notepad-place";

/**
 * A mark as the @ menu offers it: the passage, and where it is.
 *
 * Built by the notepad from the marks the layer already holds, so the menu
 * costs no fetch and opens on the keystroke.
 */
export type MentionableMark = {
  id: string;
  /** The author's words, verbatim — what gets pulled into the note. */
  quote: string;
  /** The reader's latest note on it, for finding the right one. */
  note: string | null;
  place: NotePlace;
};

/**
 * What the React side needs to draw the menu. Handed over through callbacks
 * rather than rendered by the plugin, so the menu is an ordinary component
 * inside the panel — see MentionTypeahead for why that matters: the panel
 * closes on any pointerdown outside itself, so a portalled menu would be the
 * one thing in it that shut it.
 */
export type MentionMenuState = {
  items: MentionableMark[];
  activeIndex: number;
  /** Where the caret is, in viewport coordinates. */
  rect: DOMRect | null;
  command: (item: MentionableMark) => void;
};

export type MentionController = {
  onChange: (state: MentionMenuState | null) => void;
  /** The current active row, so the plugin's key handling and the menu agree. */
  activeIndex: () => number;
  setActiveIndex: (i: number) => void;
};

export const NOTEPAD_MENTION_KEY = new PluginKey("notepad-mention");

/** Match a mark by anything you'd remember it by. */
export function matchMarks(marks: MentionableMark[], query: string): MentionableMark[] {
  const q = query.trim().toLowerCase();
  const hits = q
    ? marks.filter(
        (m) =>
          m.quote.toLowerCase().includes(q) ||
          (m.note?.toLowerCase().includes(q) ?? false) ||
          m.place.label.toLowerCase().includes(q)
      )
    : marks;
  return hits.slice(0, 8);
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

export const NotepadMentions = Extension.create<{
  marks: () => MentionableMark[];
  controller: MentionController;
}>({
  name: "notepadMentions",

  addOptions() {
    return {
      marks: () => [],
      controller: { onChange: () => {}, activeIndex: () => 0, setActiveIndex: () => {} },
    };
  },

  addProseMirrorPlugins() {
    const { controller } = this.options;
    const marks = this.options.marks;

    const publish = (props: SuggestionProps<MentionableMark, MentionableMark>) => {
      controller.onChange({
        items: props.items,
        activeIndex: controller.activeIndex(),
        rect: props.clientRect?.() ?? null,
        command: props.command,
      });
    };

    return [
      Suggestion<MentionableMark, MentionableMark>({
        pluginKey: NOTEPAD_MENTION_KEY,
        editor: this.editor,
        char: "@",
        allowSpaces: true,
        items: ({ query }) => matchMarks(marks(), query),
        command: ({ editor, range, props }) => {
          insertClip(editor, range, props);
        },
        render: () => {
          let current: SuggestionProps<MentionableMark, MentionableMark> | null = null;
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

/** Set on transactions the notepad makes itself, so the auto-stamp stays out. */
export const NOTEPAD_INSERT_META = "notepad-insert";

function insertClip(editor: Editor, range: Range, mark: MentionableMark) {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setMeta(NOTEPAD_INSERT_META, true);
      return true;
    })
    .deleteRange(range)
    // A paragraph after the quote, so the cursor lands where the next words go
    // rather than inside the quotation.
    .insertContent([clipContent(mark.quote, mark.place), { type: "paragraph" }])
    .run();
}
