"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

/**
 * Read-only render of a challenge's markdown description, reusing the same Tiptap
 * + tiptap-markdown setup and `.prose-editor` styling as the journal recap view
 * and agent-file editor.
 */
export function ChallengeDescription({ markdown }: { markdown: string }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: "-",
        linkify: true,
        breaks: false,
      }),
    ],
    content: markdown,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose-editor font-serif text-base focus:outline-none",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(markdown, { emitUpdate: false });
  }, [editor, markdown]);

  if (!markdown.trim()) return null;
  return <div>{editor && <EditorContent editor={editor} />}</div>;
}
