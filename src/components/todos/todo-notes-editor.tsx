"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { wrappingInputRule } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef } from "react";

// "[] " starts a checklist, matching the lesson notes editor.
const TaskListWithShortcut = TaskList.extend({
  addInputRules() {
    return [
      wrappingInputRule({
        find: /^\s*\[\]\s$/,
        type: this.type,
      }),
    ];
  },
});

/**
 * Task notes: Tiptap with headings, lists, links, and checklists. StarterKit's
 * input rules give live markdown shortcuts (#, -, 1., **bold**); the Markdown
 * extension converts pasted markdown into rich text. Saves like the lesson
 * editor — debounced plus flush on blur/unmount — and the server sanitizes.
 */
export function TodoNotesEditor({
  initialHtml,
  onSave,
}: {
  initialHtml: string;
  onSave: (html: string) => void | Promise<void>;
}) {
  const latestHtmlRef = useRef<string>(initialHtml);
  const savedRef = useRef<string>(initialHtml);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushSave = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const html = latestHtmlRef.current;
    if (html === savedRef.current) return;
    savedRef.current = html;
    void onSave(html);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
      }),
      Placeholder.configure({ placeholder: "Notes" }),
      TaskListWithShortcut,
      TaskItem.configure({ nested: true }),
      // html:true is load-bearing: with the Markdown extension active, the
      // initial `content` string is parsed as markdown, and html:false would
      // escape the stored notes_html into visible tags.
      Markdown.configure({
        html: true,
        transformPastedText: true,
        linkify: true,
      }),
    ],
    content: initialHtml || "",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose-editor text-sm focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      latestHtmlRef.current = editor.getHTML();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flushSave, 1500);
    },
    onBlur: () => {
      flushSave();
    },
  });

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        flushSave();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <EditorContent editor={editor} />;
}
