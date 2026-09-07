"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { CalendarDays, ChevronLeft, MapPin, Sparkles, X } from "lucide-react";
import { saveBookNote, type BookNote } from "@/app/(reading)/reader/note-actions";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { memberPhotoUrl } from "@/lib/media/member-photo-url";
import type { MentionTarget } from "@/lib/reading/mentions";
import {
  dateLabel,
  noteWordCount,
  placesIn,
  todayIso,
  type NotePlace,
} from "@/lib/reading/notes";
import { cn } from "@/lib/utils";
import { NotepadAutostamp } from "./notepad-autostamp";
import { COMPOSE_NODE, composeScope, NotepadCompose, type ComposeScope } from "./notepad-compose";
import {
  clipContent,
  NOTEPAD_INSERT_META,
  NotepadMentions,
  type MentionController,
  type MentionMenuState,
} from "./notepad-mentions";
import { NotepadPill, PILL_NODE, pillJSON, placeNodeJSON } from "./notepad-pill";

/**
 * A passage sent here from the book — a highlight landing in the notes.
 *
 * A request rather than a state: the nonce is what lets the same passage be
 * clipped twice, and what the effect below keys on.
 */
export type NoteClip = {
  nonce: number;
  quote: string;
  place: NotePlace;
};

/** What Enter on a chip hands the layer. Resolves to the new thread's annotation id. */
export type ComposeRequest = Pick<ComposeScope, "kind" | "handle" | "name" | "text" | "quote">;

/**
 * The reader's notepad for this book, in the panel beside it.
 *
 * A document, not a log — you can go back into anything and rework it — with
 * the log's one good property kept: where you were when you wrote something.
 * That is a PILL in the text (see notepad-pill.ts), put there by the auto-stamp
 * (notepad-autostamp.ts), by the pin in the header, and after every passage
 * that lands here from a highlight. A date (the calendar button, or ⌥D) is
 * plain text: something you put in on purpose and can edit, or put in a
 * heading.
 *
 * It is also where conversations start. Type @ under a passage, pick Ask or a
 * person, press Enter: the paragraph goes off as the first message of a
 * thread, and a pill stays behind that opens it — see notepad-compose.ts.
 *
 * Tapping a pill moves the BOOK, behind a panel that stays open — the same
 * reason the preface and afterword came back to the panel from a page of their
 * own. Saves as you type, a moment after you stop.
 */
export function Notepad({
  bookId,
  memberEmail,
  initial,
  members,
  spot,
  clip,
  onClipHandled,
  onOpenPlace,
  onOpenThread,
  onCompose,
  replyCounts,
  onChange,
  onSaved,
  onBack,
  onClose,
  dockToggle,
  autoFocus,
  focusNonce,
}: {
  bookId: string;
  memberEmail: string | null;
  /** What was in the note when the panel opened. Read once, on mount. */
  initial: BookNote;
  /** Everyone the @ menu can name. */
  members: MentionTarget[];
  /** Where the reader is right now, or null when there's nowhere to point. */
  spot: NotePlace | null;
  clip: NoteClip | null;
  onClipHandled: () => void;
  /** A place pill was tapped: go there, and open the mark if it names one. */
  onOpenPlace: (char: number, mark: string | null) => void;
  /** A thread pill was tapped, or a thread was just made from a chip. */
  onOpenThread: (annotationId: string) => void;
  /** Make the thread a chip promised. Rejects if it couldn't. */
  onCompose: (request: ComposeRequest) => Promise<string>;
  /** Replies per thread, for the pills' counts. */
  replyCounts: ReadonlyMap<string, number>;
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
  /** Bumped to put the cursor back at the end while already open — ⌥N. */
  focusNonce: number;
}) {
  const [status, setStatus] = useState<
    "idle" | "dirty" | "saving" | "saved" | "error" | "sending" | "sendFailed"
  >("idle");
  const [words, setWords] = useState(() => noteWordCount(initial.markdown));
  const [menu, setMenu] = useState<MentionMenuState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Everything the extensions read is behind a ref: they are built once, with
  // the editor, and the reader's position changes on every page.
  const spotRef = useRef(spot);
  spotRef.current = spot;
  const membersRef = useRef(members);
  membersRef.current = members;
  const countsRef = useRef(replyCounts);
  countsRef.current = replyCounts;
  const lastStampRef = useRef<number | null>(placesIn(initial.markdown).at(-1)?.char ?? null);
  const activeIndexRef = useRef(0);
  const openPlaceRef = useRef(onOpenPlace);
  openPlaceRef.current = onOpenPlace;
  const openThreadRef = useRef(onOpenThread);
  openThreadRef.current = onOpenThread;
  const composeRef = useRef(onCompose);
  composeRef.current = onCompose;
  /** The header's buttons and the send, reachable from the editor's key handler (built once). */
  const actionsRef = useRef<{ stampHere: () => void; stampDate: () => void; send: () => void }>({
    stampHere: () => {},
    stampDate: () => {},
    send: () => {},
  });

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
    setStatus((s) => (s === "sending" ? s : "saving"));
    try {
      const { updatedAt } = await saveBookNote({ bookId, markdown, memberEmail });
      savedRef.current = markdown;
      onSaved(updatedAt);
      // Something may have been typed while the save was in flight.
      setStatus((s) => (s === "sending" ? s : latestRef.current === markdown ? "saved" : "dirty"));
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

  /**
   * Reply counts on thread pills, as a decoration: the count is a fact about
   * the thread, not about the note, so it is drawn over the pill rather than
   * stored in it — and it stays right as replies arrive.
   */
  const replyDecorations = useMemo(
    () =>
      Extension.create({
        name: "notepadReplyCounts",
        addProseMirrorPlugins() {
          return [
            new Plugin({
              key: new PluginKey("notepad-reply-counts"),
              props: {
                decorations(state) {
                  const decos: Decoration[] = [];
                  state.doc.descendants((node, pos) => {
                    if (node.type.name !== PILL_NODE || node.attrs.kind !== "thread") return;
                    const n = countsRef.current.get(node.attrs.thread as string);
                    if (n == null || n <= 0) return;
                    decos.push(
                      Decoration.node(pos, pos + node.nodeSize, {
                        "data-replies": String(n),
                      })
                    );
                  });
                  return DecorationSet.create(state.doc, decos);
                },
              },
            }),
          ];
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
        placeholder: "Write as you read. @ starts a conversation.",
      }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: "-",
        linkify: true,
        breaks: false,
        transformPastedText: true,
      }),
      NotepadPill,
      NotepadCompose,
      NotepadAutostamp.configure({
        spot: () => spotRef.current,
        lastStamp: () => lastStampRef.current,
        onStamp: (place) => {
          lastStampRef.current = place.char;
        },
      }),
      NotepadMentions.configure({
        members: () => membersRef.current,
        controller,
      }),
      replyDecorations,
    ],
    content: initial.markdown,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose-editor notepad-editor font-serif text-[0.95rem] leading-7 text-foreground focus:outline-none",
        "aria-label": "Your notes",
      },
      // A pill is a link — into the book, or into a conversation. Handled here
      // rather than on the DOM, because ProseMirror owns the click first and
      // would otherwise just select the atom.
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name !== PILL_NODE) return false;
        if (node.attrs.kind === "place") {
          openPlaceRef.current(node.attrs.char as number, (node.attrs.mark as string | null) ?? null);
          return true;
        }
        if (node.attrs.kind === "thread") {
          openThreadRef.current(node.attrs.thread as string);
          return true;
        }
        return false;
      },
      handleKeyDown: (view, event) => {
        if (event.altKey && !event.metaKey && !event.ctrlKey) {
          // ⌥L — a pill for where you are; ⌥D — one for today. Physical keys:
          // on a Mac ⌥L types "¬" and ⌥D "∂", and neither may reach the text.
          if (event.code === "KeyL") {
            event.preventDefault();
            actionsRef.current.stampHere();
            return true;
          }
          if (event.code === "KeyD") {
            event.preventDefault();
            actionsRef.current.stampDate();
            return true;
          }
          return false;
        }
        // Enter on a paragraph holding a chip sends it. Shift-Enter is still a
        // line break, so a multi-line message is possible before sending.
        if (event.key === "Enter" && !event.shiftKey && chipInParagraph(view.state)) {
          event.preventDefault();
          actionsRef.current.send();
          return true;
        }
        // Escape hands the keyboard back to the book — page turns, `b`, `c` —
        // and leaves the notes open beside it. Stopped here so the panel's own
        // Escape (which closes a floating panel) waits for the NEXT press: one
        // step out at a time. The @ menu, when it's up, takes the first Escape
        // for itself (its plugin runs ahead of this one).
        if (event.key !== "Escape") return false;
        event.stopPropagation();
        view.dom.blur();
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const markdown = getMarkdown(editor);
      latestRef.current = markdown;
      onChange(markdown);
      setWords(noteWordCount(markdown));
      setStatus((s) => (s === "sending" ? s : "dirty"));
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void flush(), 800);
    },
    onBlur: () => {
      void flush();
    },
  });

  // Reply counts changed: redraw the decorations over an unchanged document.
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta("notepad-reply-counts", true));
  }, [editor, replyCounts]);

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

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  /**
   * Opening the notepad is opening it to write: the cursor lands at the end,
   * where the next thought goes, and the column is scrolled to show it.
   */
  useEffect(() => {
    if (!editor || (!autoFocus && focusNonce === 0)) return;
    editor.commands.focus("end");
    scrollToEnd();
  }, [autoFocus, editor, focusNonce, scrollToEnd]);

  /**
   * A passage from the page lands at the end, with a fresh line under it and
   * the cursor there — the highlight was the gesture, and this is where the
   * thought about it goes.
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
    scrollToEnd();
  }, [clip, editor, onClipHandled, scrollToEnd]);

  const insertPill = useCallback(
    (json: ReturnType<typeof pillJSON>) => {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setMeta(NOTEPAD_INSERT_META, true);
          return true;
        })
        .insertContent([json, { type: "text", text: " " }])
        .run();
    },
    [editor]
  );

  /** The header's pin: a pill for where the reader is, at the cursor. */
  const stampHere = useCallback(() => {
    const place = spotRef.current;
    if (!place) return;
    insertPill(placeNodeJSON(place));
    lastStampRef.current = place.char;
  }, [insertPill]);

  /**
   * The header's calendar: today's date, at the cursor, as ordinary text.
   *
   * Not a pill, deliberately. A date pill was tried and there was nothing to
   * it that words don't do: the AI reads either the same, and words can be
   * edited — "Sep 7, evening" — and can sit inside a heading, which "## ⌥D"
   * is the whole point of.
   */
  const stampDate = useCallback(() => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setMeta(NOTEPAD_INSERT_META, true);
        return true;
      })
      .insertContent(`${dateLabel(todayIso())} `)
      .run();
  }, [editor]);

  /**
   * Enter on a chip.
   *
   * The chip marks itself as sending, the layer makes the thread, and the chip
   * becomes the thread's pill — then the note is saved and the thread opened.
   * In that order: the panel switches to the thread, which unmounts this
   * editor, so everything the note needs to remember has to be on disk first.
   * A failure puts the chip back the way it was and says so in the header.
   */
  const send = useCallback(async () => {
    if (!editor) return;
    const chipPos = chipPosition(editor);
    if (chipPos == null) return;
    const scope = composeScope(editor.state.doc, chipPos);
    if (!scope || !scope.text.trim()) return;

    const chip = editor.state.doc.nodeAt(chipPos);
    if (!chip || chip.attrs.state === "sending") return;
    editor.view.dispatch(
      editor.state.tr
        .setNodeMarkup(chipPos, undefined, { ...chip.attrs, state: "sending" })
        .setMeta(NOTEPAD_INSERT_META, true)
        .setMeta("addToHistory", false)
    );
    setStatus("sending");

    let id: string;
    try {
      id = await composeRef.current({
        kind: scope.kind,
        handle: scope.handle,
        name: scope.name,
        text: scope.text,
        quote: scope.quote,
      });
    } catch (err) {
      console.error("[reader] couldn't start that conversation", err);
      const at = chipPosition(editor);
      if (at != null) {
        const c = editor.state.doc.nodeAt(at);
        if (c) {
          editor.view.dispatch(
            editor.state.tr
              .setNodeMarkup(at, undefined, { ...c.attrs, state: "idle" })
              .setMeta(NOTEPAD_INSERT_META, true)
              .setMeta("addToHistory", false)
          );
        }
      }
      setStatus("sendFailed");
      return;
    }

    const at = chipPosition(editor);
    if (at != null) {
      const label = scope.kind === "ask" ? "Ask" : scope.name;
      const pill = editor.state.schema.nodes[PILL_NODE].create(
        pillJSON({ kind: "thread", thread: id, label }).attrs
      );
      editor.view.dispatch(
        editor.state.tr.replaceWith(at, at + 1, pill).setMeta(NOTEPAD_INSERT_META, true)
      );
    }
    setStatus("dirty");
    await flush();
    openThreadRef.current(id);
  }, [editor, flush]);

  actionsRef.current = { stampHere, stampDate, send: () => void send() };

  /**
   * ⌥L and ⌥D from outside the text — the notes open but the cursor back in
   * the book — land at the end and stamp there. Inside the text the editor's
   * own key handler has already taken them, and `isFocused` is what keeps the
   * two from both firing.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.repeat) return;
      if ((e.code !== "KeyL" && e.code !== "KeyD") || !editor || editor.isFocused) return;
      e.preventDefault();
      editor.commands.focus("end");
      if (e.code === "KeyL") stampHere();
      else stampDate();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor, stampDate, stampHere]);

  const subtitle =
    status === "sending"
      ? "Starting the conversation…"
      : status === "sendFailed"
        ? "Couldn't start that — try again"
        : status === "saving"
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
              (status === "error" || status === "sendFailed") && "text-destructive"
            )}
          >
            {subtitle}
          </p>
        </div>
        {/* About the book rather than the panel, so they sit ahead of the dock
            and close controls — the same order every other header keeps. */}
        <button
          type="button"
          onClick={stampHere}
          disabled={!spot}
          aria-label="Mark where you are"
          title={spot ? `Mark where you are · ${spot.label} (⌥L)` : "Mark where you are (⌥L)"}
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <MapPin className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={stampDate}
          aria-label="Mark today's date"
          title="Mark today's date (⌥D)"
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <CalendarDays className="h-4 w-4" />
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

/** Whether the paragraph the cursor is in holds a chip. */
function chipInParagraph(state: Editor["state"]): boolean {
  const $from = state.selection.$from;
  if ($from.depth < 1) return false;
  let found = false;
  $from.node(1).descendants((n) => {
    if (n.type.name === COMPOSE_NODE) found = true;
    return !found;
  });
  return found;
}

/** Where the chip in the cursor's top-level block is, or null. */
function chipPosition(editor: Editor): number | null {
  const { doc, selection } = editor.state;
  const $from = selection.$from;
  if ($from.depth < 1) return null;
  const start = $from.start(1);
  let at: number | null = null;
  $from.node(1).descendants((n, pos) => {
    if (at != null) return false;
    if (n.type.name === COMPOSE_NODE) at = start + pos;
    return at == null;
  });
  void doc;
  return at;
}

/**
 * The @ menu: Ask, then everyone.
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
    flip = menu.rect.bottom + 200 > box.bottom && menu.rect.top - box.top > 200;
    top = flip ? caretTop : caretBottom + 4;
  }

  return (
    <div
      role="listbox"
      aria-label="Start a conversation"
      className={cn(
        "absolute left-3 z-10 w-64 rounded-lg border border-border bg-popover p-1 shadow-lg",
        flip && "-translate-y-full"
      )}
      style={{ top }}
    >
      {menu.items.map((item, i) => {
        const active = i === menu.activeIndex;
        const rowClass = cn(
          "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
          active ? "bg-accent text-accent-foreground" : ""
        );
        if (item.kind === "ask") {
          return (
            <div
              key="ask"
              role="option"
              aria-selected={active}
              onMouseDown={(e) => {
                e.preventDefault();
                menu.command(item);
              }}
              className={rowClass}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted">
                <Sparkles className="h-3 w-3 text-muted-foreground" />
              </span>
              <span className="font-medium">Ask</span>
              <span className="text-xs text-muted-foreground">a conversation about this</span>
            </div>
          );
        }
        const t = item.target;
        return (
          <div
            key={t.handle}
            role="option"
            aria-selected={active}
            onMouseDown={(e) => {
              e.preventDefault();
              menu.command(item);
            }}
            className={rowClass}
          >
            <MemberAvatar
              name={t.name}
              url={t.hasPhoto && t.email ? memberPhotoUrl(t.email) : null}
              size="xs"
            />
            <span className="font-medium">{t.name}</span>
            <span className="text-xs text-muted-foreground">@{t.handle}</span>
          </div>
        );
      })}
    </div>
  );
}
