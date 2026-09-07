"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { ChevronLeft, MapPin, X } from "lucide-react";
import { saveBookNote, type BookNote } from "@/app/(reading)/reader/note-actions";
import { noteWordCount, placesIn, type NotePlace } from "@/lib/reading/notes";
import { cn } from "@/lib/utils";
import { NotepadAutostamp } from "./notepad-autostamp";
import {
  clipContent,
  NOTEPAD_INSERT_META,
  NotepadMentions,
  type MentionableMark,
  type MentionController,
  type MentionMenuState,
} from "./notepad-mentions";
import { NotepadPlace, PLACE_NODE, placeNodeJSON } from "./notepad-place";

/**
 * A passage sent here from the book — the selection toolbar's "Clip".
 *
 * A request rather than a state: the nonce is what lets the same passage be
 * clipped twice, and what the effect below keys on.
 */
export type NoteClip = {
  nonce: number;
  quote: string;
  place: NotePlace;
};

/**
 * The reader's notepad for this book, in the panel beside it.
 *
 * A document, not a log — you can go back into anything and rework it — with
 * the log's one good property kept: where you were when you wrote something.
 * That is a PILL in the text (see notepad-place.ts), put there three ways:
 *
 *   - stamped at the front of a new paragraph when you've moved since the last
 *     one (notepad-autostamp.ts);
 *   - dropped at the cursor by the button in the header;
 *   - after a passage pulled in by @-mentioning one of your marks, or clipped
 *     from the page.
 *
 * Tapping a pill moves the BOOK, behind a panel that stays open — the same
 * reason the preface and afterword came back to the panel from a page of their
 * own. Nothing here talks to the assistant; it reads the note as background in
 * every conversation about the book, and that is deliberately all it does.
 *
 * Saves as you type, a moment after you stop. There is no save button because
 * there is no version of this where you would want to not save.
 */
export function Notepad({
  bookId,
  memberEmail,
  initial,
  marks,
  spot,
  clip,
  onClipHandled,
  onOpenPlace,
  onChange,
  onSaved,
  onBack,
  onClose,
  dockToggle,
  autoFocus,
}: {
  bookId: string;
  memberEmail: string | null;
  /** What was in the note when the panel opened. Read once, on mount. */
  initial: BookNote;
  /** The reader's marks in this book, for the @ menu. */
  marks: MentionableMark[];
  /** Where the reader is right now, or null when there's nowhere to point. */
  spot: NotePlace | null;
  clip: NoteClip | null;
  onClipHandled: () => void;
  /** A pill was tapped: go there, and open the mark if it names one. */
  onOpenPlace: (char: number, mark: string | null) => void;
  /** Every change, so whoever reopens the panel gets the latest text. */
  onChange: (markdown: string) => void;
  /** A save landed. */
  onSaved: (updatedAt: string) => void;
  onBack: () => void;
  onClose: () => void;
  dockToggle: React.ReactNode;
  /**
   * Open with the cursor at the end, ready to type. Off on a sheet: opening
   * the notepad on a phone to read it back shouldn't summon the keyboard.
   */
  autoFocus: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">(
    "idle"
  );
  const [words, setWords] = useState(() => noteWordCount(initial.markdown));
  const [menu, setMenu] = useState<MentionMenuState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Everything the extensions read is behind a ref: they are built once, with
  // the editor, and the reader's position changes on every page.
  const spotRef = useRef(spot);
  spotRef.current = spot;
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const lastStampRef = useRef<number | null>(placesIn(initial.markdown).at(-1)?.char ?? null);
  const activeIndexRef = useRef(0);
  const openPlaceRef = useRef(onOpenPlace);
  openPlaceRef.current = onOpenPlace;

  const latestRef = useRef(initial.markdown);
  const savedRef = useRef(initial.markdown);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  const flush = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const markdown = latestRef.current;
    if (markdown === savedRef.current || savingRef.current) return;
    savingRef.current = true;
    setStatus("saving");
    try {
      const { updatedAt } = await saveBookNote({ bookId, markdown, memberEmail });
      savedRef.current = markdown;
      onSaved(updatedAt);
      // Something may have been typed while the save was in flight.
      setStatus(latestRef.current === markdown ? "saved" : "dirty");
    } catch (err) {
      console.error("[reader] couldn't save your notes", err);
      setStatus("error");
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => void flush(), 5000);
    } finally {
      savingRef.current = false;
      if (latestRef.current !== savedRef.current && !debounceRef.current) {
        debounceRef.current = setTimeout(() => void flush(), 800);
      }
    }
  }, [bookId, memberEmail, onSaved]);

  const controller = useMemo<MentionController>(
    () => ({
      onChange: setMenu,
      activeIndex: () => activeIndexRef.current,
      setActiveIndex: (i) => {
        activeIndexRef.current = i;
      },
    }),
    []
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
        // A notepad, not a code editor. Backticks still give inline code.
        codeBlock: false,
      }),
      Placeholder.configure({
        placeholder: "Write as you read. @ pulls in something you marked.",
      }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: "-",
        linkify: true,
        breaks: false,
        transformPastedText: true,
      }),
      NotepadPlace,
      NotepadAutostamp.configure({
        spot: () => spotRef.current,
        lastStamp: () => lastStampRef.current,
        onStamp: (place) => {
          lastStampRef.current = place.char;
        },
      }),
      NotepadMentions.configure({
        marks: () => marksRef.current,
        controller,
      }),
    ],
    content: initial.markdown,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose-editor notepad-editor font-serif text-[0.95rem] leading-7 text-foreground focus:outline-none",
        "aria-label": "Your notes",
      },
      // A pill is a link into the book. Handled here rather than on the DOM,
      // because ProseMirror owns the click first and would otherwise just
      // select the atom.
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name !== PLACE_NODE) return false;
        openPlaceRef.current(node.attrs.char as number, (node.attrs.mark as string | null) ?? null);
        return true;
      },
      // Escape hands the keyboard back to the book — page turns, `b`, `c` —
      // and leaves the notes open beside it. The @ menu, when it's up, takes
      // the first Escape for itself (its plugin runs ahead of this one).
      handleKeyDown: (view, event) => {
        if (event.key !== "Escape") return false;
        view.dom.blur();
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const markdown = getMarkdown(editor);
      latestRef.current = markdown;
      onChange(markdown);
      setWords(noteWordCount(markdown));
      setStatus("dirty");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void flush(), 800);
    },
    onBlur: () => {
      void flush();
    },
  });

  // Flush on the way out, and whenever the tab goes to the background — on a
  // phone that is the last thing that runs before the page is frozen.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (retryRef.current) clearTimeout(retryRef.current);
      void flush();
    };
  }, [flush]);

  /**
   * Opening the notepad is opening it to write: the cursor lands at the end,
   * where the next thought goes, and the column is scrolled to show it.
   */
  useEffect(() => {
    if (!editor || !autoFocus) return;
    editor.commands.focus("end");
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [autoFocus, editor]);

  /**
   * A passage sent from the page lands at the end, and the cursor goes with it.
   *
   * At the end rather than the cursor because there is no cursor: the panel
   * was closed, or showing the marks, when the reader selected the passage.
   * Appending is what they'd expect, and it is one drag from wherever they
   * want it.
   */
  useEffect(() => {
    if (!editor || !clip) return;
    const end = editor.state.doc.content.size;
    editor
      .chain()
      .command(({ tr }) => {
        tr.setMeta(NOTEPAD_INSERT_META, true);
        return true;
      })
      .insertContentAt(end, [clipContent(clip.quote, clip.place), { type: "paragraph" }])
      .focus("end")
      .run();
    lastStampRef.current = clip.place.char;
    onClipHandled();
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [clip, editor, onClipHandled]);

  /** The header's pin: a pill for where the reader is, at the cursor. */
  const stampHere = useCallback(() => {
    const place = spotRef.current;
    if (!editor || !place) return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setMeta(NOTEPAD_INSERT_META, true);
        return true;
      })
      .insertContent([placeNodeJSON(place), { type: "text", text: " " }])
      .run();
    lastStampRef.current = place.char;
  }, [editor]);

  const subtitle =
    status === "saving"
      ? "Saving…"
      : status === "error"
        ? "Couldn't save — will retry"
        : status === "dirty"
          ? "Unsaved"
          : words === 0
            ? "Nothing written yet"
            : `${words} ${words === 1 ? "word" : "words"}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="All marks"
          title="All marks"
          className="-ml-1.5 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">Your notes</p>
          <p
            className={cn(
              "truncate text-[11px] text-muted-foreground",
              status === "error" && "text-destructive"
            )}
          >
            {subtitle}
          </p>
        </div>
        {/* About the book rather than the panel, so it sits ahead of the dock
            and close controls — the same order every other header keeps. */}
        <button
          type="button"
          onClick={stampHere}
          disabled={!spot}
          aria-label="Mark where you are"
          title={spot ? `Mark where you are (${spot.label})` : "Mark where you are"}
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <MapPin className="h-4 w-4" />
        </button>
        {dockToggle}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <EditorContent editor={editor} className="min-h-full" />
        {menu && <MentionMenu menu={menu} container={scrollRef.current} />}
      </div>
    </div>
  );
}

function getMarkdown(editor: Editor): string {
  const md = (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown;
  return md?.getMarkdown?.() ?? "";
}

/**
 * The @ menu: your marks, by their words.
 *
 * Not a portal and not a menu, for the reasons MentionTypeahead gives — it
 * never takes focus, and it lives inside the panel. Positioned under the caret
 * within the scrolling column, and flipped above it when the caret is near the
 * bottom.
 */
function MentionMenu({
  menu,
  container,
}: {
  menu: MentionMenuState;
  container: HTMLDivElement | null;
}) {
  if (menu.items.length === 0) return null;

  let top = 0;
  let flip = false;
  if (menu.rect && container) {
    const box = container.getBoundingClientRect();
    const caretTop = menu.rect.top - box.top + container.scrollTop;
    const caretBottom = menu.rect.bottom - box.top + container.scrollTop;
    flip = menu.rect.bottom + 240 > box.bottom && menu.rect.top - box.top > 240;
    top = flip ? caretTop : caretBottom + 4;
  }

  return (
    <div
      role="listbox"
      aria-label="Pull in a mark"
      className={cn(
        "absolute left-3 right-3 z-10 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg",
        flip && "-translate-y-full"
      )}
      style={{ top }}
    >
      {menu.items.map((m, i) => (
        <div
          key={m.id}
          role="option"
          aria-selected={i === menu.activeIndex}
          onMouseDown={(e) => {
            e.preventDefault();
            menu.command(m);
          }}
          className={cn(
            "cursor-pointer rounded-md px-2 py-1.5 text-xs",
            i === menu.activeIndex ? "bg-accent text-accent-foreground" : ""
          )}
        >
          <p className="line-clamp-2 font-serif text-[13px] leading-snug text-foreground">
            {m.quote}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {m.place.label}
            {m.note ? ` · ${m.note}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}
