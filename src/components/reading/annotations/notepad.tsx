"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { Extension, type Range } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import {
  CalendarDays,
  ChevronLeft,
  ChevronsDownUp,
  Clock3,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  MapPin,
  Sparkles,
  X,
} from "lucide-react";
import { saveBookNote, type BookNote } from "@/app/(reading)/reader/note-actions";
import { MemberAvatar } from "@/components/journal/member-avatar";
import { memberPhotoUrl } from "@/lib/media/member-photo-url";
import type { MentionTarget } from "@/lib/reading/mentions";
import {
  dateLabel,
  noteWordCount,
  stampLabel,
  todayIso,
  type NotePlace,
} from "@/lib/reading/notes";
import {
  absorbPlacePills,
  blockHeadText,
  emptyDoc,
  emptyParagraph,
  newBlock,
  NOTEPAD_NO_STAMP_META,
  normalizeDoc,
  quoteBlock,
  THREAD_BLOCK,
  threadHead,
  treeToMarkdown,
  type NoteBlockJSON,
  type NoteDoc,
  type ThreadBlockAttrs,
} from "@/lib/reading/note-tree";
import { cn } from "@/lib/utils";
import { NoteBlock, NotepadDoc, toggleFoldInPlace, type BlockMeta } from "./notepad-block";
import {
  blockAt,
  focusEndVisible,
  headEnd,
  indentBlock,
  inHead,
  isBlock,
  isThreadLine,
  outdentBlock,
  threadLineAt,
} from "./notepad-block-commands";
import { blockScope, COMPOSE_NODE, composeScope, NotepadCompose, type ComposeScope } from "./notepad-compose";
import {
  NOTEPAD_INSERT_META,
  NotepadMentions,
  type MentionController,
  type MentionMenuState,
  type MenuState,
  type SuggestionController,
} from "./notepad-mentions";
import { NotepadPill, PILL_NODE, pillJSON, placeNodeJSON } from "./notepad-pill";
import { NotepadProvenance } from "./notepad-provenance";
import { NotepadQuote } from "./notepad-quote";
import { NotepadSlash, type SlashCommand, type SlashItem } from "./notepad-slash";
import { NotepadThreadBlock, THREAD_FACTS_SPEC, type ThreadFacts } from "./notepad-thread-block";

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

/**
 * A clip's mark, now real. The passage landed the instant it was highlighted,
 * pointing at a stand-in id; this swaps in the row's id once it exists.
 */
export type NoteMarkFix = {
  nonce: number;
  pending: string;
  id: string;
};

/** What Enter on a chip hands the layer. Resolves to the new thread's annotation id. */
export type ComposeRequest = Pick<ComposeScope, "kind" | "handle" | "name" | "text" | "quote">;

/**
 * The reader's notepad for this book, in the panel beside it.
 *
 * An outline, not a log — every line is a block that can hold lines under
 * it, be folded, and be moved with its children (notepad-block.ts) — with
 * the log's one good property kept, and kept out of sight. Every line quietly
 * records where you were in the book when you wrote it and when that was
 * (notepad-provenance.ts); press the line's handle and it tells you, and
 * offers to take you back. Nothing is written into the text.
 *
 * Things you put in on purpose still show. The pin in the header, or ⌥L,
 * makes a place PILL (notepad-pill.ts) where the cursor is — and leaves the
 * line's own record alone, because the two answer different questions. A date
 * (the calendar button, or ⌥D) is plain text, so it can be edited or put in a
 * heading.
 *
 * Saved as a tree (note-tree.ts), with the markdown everything else reads
 * derived from it on every save. A note from before the outline arrives as
 * markdown, is lifted into blocks on the way in, and is saved back as both.
 *
 * It is also where conversations start. End a line with /ask and the line
 * goes off to the AI as the first message of a thread; type @ and pick a
 * person, press Enter, and it goes to them. Either way the line becomes a
 * THREAD BLOCK — a locked line wearing the conversation's name, which opens
 * it — see notepad-thread-block.ts and notepad-slash.ts.
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
  markFix,
  onMarkFixHandled,
  onOpenPlace,
  onOpenThread,
  onCompose,
  threadFacts,
  onChange,
  onSaved,
  onBack,
  onClose,
  dockToggle,
  autoFocus,
  focusNonce,
  touch,
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
  markFix: NoteMarkFix | null;
  onMarkFixHandled: () => void;
  /** A place pill was tapped: go there, and open the mark if it names one. */
  onOpenPlace: (char: number, mark: string | null) => void;
  /** A thread block was pressed, or a thread was just made from a line. */
  onOpenThread: (annotationId: string) => void;
  /** Make the thread a line asked for. Rejects if it couldn't. */
  onCompose: (request: ComposeRequest) => Promise<string>;
  /** What's known about each conversation, by annotation id, for the thread blocks. */
  threadFacts: ReadonlyMap<string, ThreadFacts>;
  /** Every change, so whoever reopens the panel gets the latest text. */
  onChange: (markdown: string, doc: NoteDoc) => void;
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
  /** On a phone: no hover, no Tab, so a bar above the keyboard does what they do. */
  touch: boolean;
}) {
  const [status, setStatus] = useState<
    "idle" | "dirty" | "saving" | "saved" | "error" | "sending" | "sendFailed" | "nothingToAsk"
  >("idle");
  const [words, setWords] = useState(() => noteWordCount(initial.markdown));
  const [menu, setMenu] = useState<MentionMenuState | null>(null);
  const [slash, setSlash] = useState<MenuState<SlashItem> | null>(null);
  /** The line whose handle was pressed, and what it knows. */
  const [meta, setMeta] = useState<BlockMeta | null>(null);
  const [focused, setFocused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Everything the extensions read is behind a ref: they are built once, with
  // the editor, and the reader's position changes on every page.
  const spotRef = useRef(spot);
  spotRef.current = spot;
  const membersRef = useRef(members);
  membersRef.current = members;
  const factsRef = useRef(threadFacts);
  factsRef.current = threadFacts;
  const activeIndexRef = useRef(0);
  const slashIndexRef = useRef(0);
  const openPlaceRef = useRef(onOpenPlace);
  openPlaceRef.current = onOpenPlace;
  const openThreadRef = useRef(onOpenThread);
  openThreadRef.current = onOpenThread;
  const composeRef = useRef(onCompose);
  composeRef.current = onCompose;
  /** The header's buttons, the send and the ask, reachable from the editor's plugins (built once). */
  const actionsRef = useRef<{
    stampHere: () => void;
    stampDate: () => void;
    send: () => void;
    ask: (range: Range) => void;
  }>({
    stampHere: () => {},
    stampDate: () => {},
    send: () => {},
    ask: () => {},
  });

  /**
   * The note as it stands, and the note as last saved — told apart by the
   * editor's own document object, which changes on every edit and every fold
   * and on nothing else. Null for "saved" means never: a note that arrived as
   * markdown is dirty from the start, so its first open writes the tree.
   */
  const latestRef = useRef<{ markdown: string; doc: NoteDoc; pm: PMNode | null }>({
    markdown: initial.markdown,
    doc: initial.doc ?? emptyDoc(),
    pm: null,
  });
  const savedRef = useRef<PMNode | null>(null);
  /** Whether the reader has put the caret somewhere themselves since the panel opened. */
  const cursorSeenRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  const flush = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const { markdown, doc, pm } = latestRef.current;
    if (!pm || pm === savedRef.current || savingRef.current) return;
    savingRef.current = true;
    setStatus((s) => (s === "sending" ? s : "saving"));
    try {
      const { updatedAt } = await saveBookNote({ bookId, markdown, doc, memberEmail });
      savedRef.current = pm;
      onSaved(updatedAt);
      // Something may have been typed while the save was in flight.
      setStatus((s) => (s === "sending" ? s : latestRef.current.pm === pm ? "saved" : "dirty"));
    } catch (err) {
      console.error("[reader] couldn't save your notes", err);
      setStatus("error");
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => void flush(), 5000);
    } finally {
      savingRef.current = false;
      if (latestRef.current.pm !== savedRef.current && !debounceRef.current) {
        debounceRef.current = setTimeout(() => void flush(), 800);
      }
    }
  }, [bookId, memberEmail, onSaved]);

  /** What the editor holds, for the refs and the header. */
  const hold = useCallback(
    (editor: Editor) => {
      const doc = editor.getJSON() as unknown as NoteDoc;
      const markdown = treeToMarkdown(doc);
      latestRef.current = { markdown, doc, pm: editor.state.doc };
      onChange(markdown, doc);
      setWords(noteWordCount(markdown));
    },
    [onChange]
  );

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
  const slashController = useMemo<SuggestionController<SlashItem>>(
    () => ({
      onChange: setSlash,
      activeIndex: () => slashIndexRef.current,
      setActiveIndex: (i) => {
        slashIndexRef.current = i;
      },
    }),
    []
  );

  /**
   * What's known about each conversation, drawn over its block as a
   * decoration: the name, the count, who's in it are facts about the thread,
   * not about the note, and they change while the note stands still. The
   * facts ride in the decoration's spec, which is the one thing a node view
   * gets handed (notepad-thread-block.ts reads it in `update`); the same
   * plugin still paints a reply count onto any thread pill left in a
   * sentence. A fresh spec object per redraw is what tells ProseMirror the
   * decoration changed.
   */
  const factDecorations = useMemo(
    () =>
      Extension.create({
        name: "notepadThreadFacts",
        addProseMirrorPlugins() {
          return [
            new Plugin({
              key: new PluginKey("notepad-thread-facts"),
              props: {
                decorations(state) {
                  const decos: Decoration[] = [];
                  const facts = factsRef.current;
                  const loaded = facts.size > 0;
                  state.doc.descendants((node, pos) => {
                    if (node.type.name === THREAD_BLOCK) {
                      decos.push(
                        Decoration.node(pos, pos + node.nodeSize, {}, {
                          [THREAD_FACTS_SPEC]: facts.get(node.attrs.thread as string) ?? null,
                          loaded,
                        })
                      );
                      return false;
                    }
                    if (node.type.name !== PILL_NODE || node.attrs.kind !== "thread") return;
                    const n = facts.get(node.attrs.thread as string)?.replies ?? 0;
                    if (n <= 0) return;
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
        // The quote is ours: the same node, folded short — see NotepadQuote.
        blockquote: false,
        // The outline is the document: its own top node, its own blocks in
        // place of lists, its own drop line, and no trailing paragraph
        // appended where only a block can go.
        document: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        horizontalRule: false,
        trailingNode: false,
        dropcursor: false,
      }),
      NotepadDoc,
      NoteBlock.configure({ onShowMeta: setMeta }),
      NotepadQuote,
      NotepadThreadBlock.configure({ others: () => membersRef.current }),
      Placeholder.configure({
        placeholder: "Write as you read. /ask sends a line to the AI, @ to a person.",
        // The empty line is inside a block; look through to it.
        includeChildren: true,
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
      NotepadProvenance.configure({ spot: () => spotRef.current }),
      NotepadMentions.configure({
        members: () => membersRef.current,
        controller,
      }),
      NotepadSlash.configure({
        canStamp: () => spotRef.current != null,
        run: (command: SlashCommand, range: Range) => {
          if (command === "ask") actionsRef.current.ask(range);
          else if (command === "here") actionsRef.current.stampHere();
          else actionsRef.current.stampDate();
        },
        controller: slashController,
      }),
      factDecorations,
    ],
    // A tree goes straight in. Markdown — a note from before the outline —
    // goes through the markdown parser, and every paragraph, heading, quote
    // and list item it yields is lifted into a block by the schema.
    content: initial.doc ?? (initial.markdown ? initial.markdown : emptyDoc()),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose-editor notepad-editor font-sans text-[0.875rem] leading-6 text-foreground focus:outline-none",
        "aria-label": "Your notes",
      },
      // A pill is a link — into the book, or into a conversation. Handled here
      // rather than on the DOM, because ProseMirror owns the click first and
      // would otherwise just select the atom.
      handleClickOn: (_view, _pos, node) => {
        // A conversation: press it and it opens.
        if (node.type.name === THREAD_BLOCK) {
          const id = node.attrs.thread as string;
          if (id) openThreadRef.current(id);
          return true;
        }
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
        // Enter on a conversation opens it — the line has nothing to split.
        if (event.key === "Enter" && isThreadLine(view.state.selection)) {
          event.preventDefault();
          const line = threadLineAt(view.state);
          const id = line?.node.firstChild?.attrs.thread as string | undefined;
          if (id) openThreadRef.current(id);
          return true;
        }
        // Enter on a line holding a chip sends it. Shift-Enter is still a
        // line break, so a multi-line message is possible before sending.
        if (event.key === "Enter" && !event.shiftKey && chipInHead(view.state)) {
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
    onCreate: ({ editor }) => {
      // Markdown on the way in: the schema lifted it into blocks, but blocks
      // made that way have no ids yet. Settle it first.
      const settled = initial.doc ?? normalizeDoc(editor.getJSON());
      // Then the one-time change of shape: a note written when the stamp was
      // a pill has its stamps lifted off the text and onto the lines that
      // hold them, so old notes read like new ones. Nothing else touches it.
      const absorbed = absorbPlacePills(settled);
      if (initial.doc && !absorbed) {
        hold(editor);
        savedRef.current = editor.state.doc;
        return;
      }
      const next = absorbed ?? settled;
      const tr = editor.state.tr;
      tr.replaceWith(0, editor.state.doc.content.size, editor.schema.nodeFromJSON(next).content);
      // Old words becoming lines: nothing here happened just now.
      tr.setMeta(NOTEPAD_NO_STAMP_META, true).setMeta("addToHistory", false);
      editor.view.dispatch(tr);
      hold(editor);
      setStatus("dirty");
      void flush();
    },
    onUpdate: ({ editor }) => {
      hold(editor);
      setStatus((s) => (s === "sending" ? s : "dirty"));
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void flush(), 800);
    },
    onSelectionUpdate: ({ transaction }) => {
      if (!transaction.getMeta(NOTEPAD_INSERT_META)) cursorSeenRef.current = true;
    },
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      void flush();
    },
  });

  /**
   * The caret to the end of the last line the reader can see — our move, not
   * theirs. When that line is a conversation there is nowhere in it to put a
   * caret, and opening the notepad is opening it to WRITE: a fresh line goes
   * in after it, and the caret there.
   */
  const focusEnd = useCallback(() => {
    if (!editor) return;
    editor.view.focus();
    focusEndVisible(editor.state, (tr) => editor.view.dispatch(tr.setMeta(NOTEPAD_INSERT_META, true)));
    const line = threadLineAt(editor.state);
    if (!line) return;
    const at = line.pos + line.node.nodeSize;
    const fresh = editor.schema.nodeFromJSON(newBlock(emptyParagraph()));
    const tr = editor.state.tr.insert(at, fresh).setMeta(NOTEPAD_INSERT_META, true);
    tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView();
    editor.view.dispatch(tr);
  }, [editor]);

  /**
   * The facts changed: redraw the decorations over an unchanged document —
   * and write any NAME that changed onto its block, so the note carries the
   * name the next time it opens, before the facts have loaded. Not a history
   * step; the reader didn't do it.
   */
  useEffect(() => {
    if (!editor) return;
    const { state } = editor;
    const tr = state.tr;
    state.doc.descendants((n, pos) => {
      if (n.type.name !== THREAD_BLOCK) return true;
      const a = n.attrs as ThreadBlockAttrs;
      const title = threadFacts.get(a.thread)?.title?.trim() || null;
      if (title && title !== a.title) tr.setNodeMarkup(pos, undefined, { ...a, title });
      return false;
    });
    tr.setMeta("notepad-thread-facts", true).setMeta(NOTEPAD_INSERT_META, true);
    if (tr.docChanged) tr.setMeta(NOTEPAD_NO_STAMP_META, true).setMeta("addToHistory", false);
    editor.view.dispatch(tr);
  }, [editor, threadFacts]);

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
    focusEnd();
    scrollToEnd();
  }, [autoFocus, editor, focusEnd, focusNonce, scrollToEnd]);

  /**
   * A passage from the page lands next to where the reader was writing — the
   * line after the one the caret was on, at the same level — with a fresh
   * line under it and the cursor there: the highlight was the gesture, and
   * this is where the thought about it goes. If they hadn't put the caret
   * anywhere yet, it lands at the end, at the top level.
   *
   * The book's words and nothing else. Where the passage came from, and the
   * mark behind it, are the quote LINE's — under its handle, like every other
   * line's — rather than a pill trailing the text.
   *
   * And it LANDS: the scrap drops in still wearing the highlighter, and the
   * colour drains out of it over the next second, leaving the paper it will
   * keep. Half of what that is for is orientation — a passage that simply
   * exists somewhere in a column of notes is a passage you have to go and find
   * — and half is that it is the same yellow you just dragged across the page,
   * so the gesture and its result read as one thing. It waits a beat first, so
   * that when the highlight opened the panel too you see the panel arrive and
   * then the passage land, rather than both at once.
   */
  useEffect(() => {
    if (!editor || !clip) return;
    const { state, schema } = editor;
    const here = cursorSeenRef.current ? blockAt(state.selection.$from) : null;
    const at = here ? here.end : state.doc.content.size;
    const json = quoteBlock(clip.quote, clip.place, new Date().toISOString());
    const quote = schema.nodeFromJSON(json);
    const fresh = schema.nodeFromJSON(newBlock(emptyParagraph()));
    const tr = state.tr.insert(at, [quote, fresh]).setMeta(NOTEPAD_INSERT_META, true);
    tr.setSelection(TextSelection.create(tr.doc, at + quote.nodeSize + 2)).scrollIntoView();
    editor.view.dispatch(tr);
    editor.view.focus();
    land(editor, json.attrs.id);
    onClipHandled();
  }, [clip, editor, onClipHandled]);

  /** The clip's mark has a real id now: everything pointing at the stand-in points at it. */
  useEffect(() => {
    if (!editor || !markFix) return;
    const { state } = editor;
    const tr = state.tr;
    state.doc.descendants((n, pos) => {
      if (n.type.name === PILL_NODE && n.attrs.mark === markFix.pending) {
        tr.setNodeMarkup(pos, undefined, { ...n.attrs, mark: markFix.id });
      }
      const place = (n.attrs.place ?? null) as NotePlace | null;
      if (place?.mark === markFix.pending) {
        tr.setNodeMarkup(pos, undefined, { ...n.attrs, place: { ...place, mark: markFix.id } });
      }
      return true;
    });
    if (tr.docChanged) {
      editor.view.dispatch(tr.setMeta(NOTEPAD_INSERT_META, true).setMeta("addToHistory", false));
    }
    onMarkFixHandled();
  }, [editor, markFix, onMarkFixHandled]);

  /** The phone's bar above the keyboard: what Tab and ⌘↑ do on a desk. */
  const runCommand = useCallback(
    (cmd: (state: Editor["state"], dispatch: Editor["view"]["dispatch"]) => boolean) => {
      if (!editor) return;
      cmd(editor.state, editor.view.dispatch);
    },
    [editor]
  );
  /** Fold or unfold the line the caret is on — read at the press, not the render. */
  const toggleFold = useCallback(() => {
    if (!editor) return;
    const b = blockAt(editor.state.selection.$from);
    if (!b) return;
    toggleFoldInPlace(editor.view, b.pos);
  }, [editor]);

  /**
   * Done with what the line had to say.
   *
   * Pressing a handle is how ProseMirror starts a drag, so it also picks the
   * whole line up as the selection. Left that way, the next thing typed would
   * replace the line — so closing puts the caret back in its words.
   */
  const closeMeta = useCallback(() => {
    setMeta(null);
    if (!editor) return;
    const sel = editor.state.selection;
    const node = sel instanceof NodeSelection ? sel.node : null;
    if (!node || !isBlock(node)) return;
    editor.view.dispatch(
      editor.state.tr
        .setSelection(headEnd(editor.state.doc, node, sel.from))
        .setMeta(NOTEPAD_INSERT_META, true)
    );
  }, [editor]);

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

  /**
   * The header's pin: a pill for where the reader is, at the cursor.
   *
   * Deliberate, and visible, and it leaves the line's own record alone. That
   * record is where the line STARTED; this is a place the reader is naming on
   * purpose, from wherever they have got to. If they've moved twenty pages in
   * between, the two say different things, and both are true.
   */
  const stampHere = useCallback(() => {
    const place = spotRef.current;
    if (!place) return;
    insertPill(placeNodeJSON(place));
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
   * The line that just became a conversation, as a thread block.
   *
   * Found by its id — positions may have moved while the thread was being
   * made — and swapped head-for-head, so its place in the outline, whatever
   * is nested under it, and its own record of where and when all stay. The
   * words become the block's `question`, which is what it shows until the
   * conversation has a name.
   */
  const becomeThread = useCallback(
    (blockId: string, thread: string, kind: ThreadBlockAttrs["kind"]) => {
      if (!editor) return;
      const { state } = editor;
      let found: { node: PMNode; pos: number } | null = null;
      state.doc.descendants((n, pos) => {
        if (found) return false;
        if (isBlock(n) && n.attrs.id === blockId) found = { node: n, pos };
        return !found;
      });
      if (!found) return;
      const { node, pos } = found as { node: PMNode; pos: number };
      const head = node.firstChild!;
      const question = blockHeadText(node.toJSON() as NoteBlockJSON).replace(/\s+/g, " ").slice(0, 300);
      const json = threadHead({ thread, kind, question, title: factsRef.current.get(thread)?.title ?? null });
      const tr = state.tr
        .replaceWith(pos + 1, pos + 1 + head.nodeSize, state.schema.nodeFromJSON(json))
        .setMeta(NOTEPAD_INSERT_META, true)
        .setMeta(NOTEPAD_NO_STAMP_META, true);
      editor.view.dispatch(tr);
    },
    [editor]
  );

  /**
   * Enter on a chip.
   *
   * The chip marks itself as sending, the layer makes the thread, and the
   * line becomes the thread's block — then the note is saved and the thread
   * opened. In that order: the panel switches to the thread, which unmounts
   * this editor, so everything the note needs to remember has to be on disk
   * first. A failure puts the chip back the way it was and says so in the
   * header.
   */
  const send = useCallback(async () => {
    if (!editor) return;
    const chipPos = chipPosition(editor);
    if (chipPos == null) return;
    const scope = composeScope(editor.state.doc, chipPos);
    if (!scope || !scope.text.trim()) return;
    const blockId = blockAt(editor.state.doc.resolve(chipPos))?.node.attrs.id as string | undefined;
    if (!blockId) return;

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

    // The chip goes first, so the block's question is the words alone.
    const at = chipPosition(editor);
    if (at != null) {
      editor.view.dispatch(
        editor.state.tr.delete(at, at + 1).setMeta(NOTEPAD_INSERT_META, true).setMeta("addToHistory", false)
      );
    }
    becomeThread(blockId, id, scope.kind === "ask" ? "ask" : "member");
    setStatus("dirty");
    await flush();
    openThreadRef.current(id);
  }, [becomeThread, editor, flush]);

  /**
   * `/ask` at the end of a line.
   *
   * The `/ask` comes out, the line is read for what it sends — where it sits
   * in the outline, its words, what's nested under it, the quote above it
   * (blockScope) — and while the thread is being made the line is drawn as
   * pending: muted, with a pulse where the sparkle will be. That is on the
   * DOM alone, the way a landing is; the words are untouched, so if the
   * thread can't be made the line is simply a line again, with everything
   * still on it. Made, the line becomes the thread's block, the note is
   * saved, and the thread opens — in that order, for the reason send() gives.
   *
   * A line with nothing on it has nothing to ask. Lines nested under it
   * don't count: they are the detail of a question, not the question.
   */
  const ask = useCallback(
    async (range: Range) => {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setMeta(NOTEPAD_INSERT_META, true);
          return true;
        })
        .deleteRange(range)
        .run();

      const $from = editor.state.selection.$from;
      const b = blockAt($from);
      if (!b || !inHead($from)) return;
      const headType = b.node.firstChild?.type.name;
      if (headType !== "paragraph" && headType !== "heading") return;
      const blockId = b.node.attrs.id as string;
      const words = blockHeadText(b.node.toJSON() as NoteBlockJSON).trim();
      if (!words) {
        setStatus("nothingToAsk");
        return;
      }
      const scope = blockScope(editor.state.doc, $from);
      if (!scope) return;

      setPending(editor, blockId, true);
      setStatus("sending");
      let id: string;
      try {
        id = await composeRef.current({
          kind: "ask",
          handle: "ask",
          name: "Ask",
          text: scope.text,
          quote: scope.quote,
        });
      } catch (err) {
        console.error("[reader] couldn't start that conversation", err);
        setPending(editor, blockId, false);
        setStatus("sendFailed");
        return;
      }
      setPending(editor, blockId, false);
      becomeThread(blockId, id, "ask");
      setStatus("dirty");
      await flush();
      openThreadRef.current(id);
    },
    [becomeThread, editor, flush]
  );

  actionsRef.current = {
    stampHere,
    stampDate,
    send: () => void send(),
    ask: (range) => void ask(range),
  };

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
      focusEnd();
      if (e.code === "KeyL") stampHere();
      else stampDate();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor, focusEnd, stampDate, stampHere]);

  const subtitle =
    status === "sending"
      ? "Starting the conversation…"
      : status === "sendFailed"
        ? "Couldn't start that — try again"
        : status === "nothingToAsk"
          ? "Write the question on the line first"
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

      {/* Room below the last line: so folding the end of the note has
          somewhere to scroll to instead of sliding the column down, and so
          the line being written can sit at eye level rather than the bottom
          edge.

          That room is still the notepad, so a press in it lands the cursor at
          the end of the note — the one thing anyone means by clicking under
          what they have written. Mouse-down rather than click, so the caret
          arrives with the press and nothing flickers on the way. */}
      <div
        ref={scrollRef}
        data-notepad-scroll=""
        onMouseDown={(e) => {
          if (!editor || editor.view.dom.contains(e.target as globalThis.Node)) return;
          if ((e.target as HTMLElement).closest("[role='dialog'],[role='listbox']")) return;
          e.preventDefault();
          focusEnd();
        }}
        className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-[40vh]"
      >
        <EditorContent editor={editor} className="min-h-full" />
        {menu && <MentionMenu menu={menu} container={scrollRef.current} />}
        {slash && <SlashMenu menu={slash} container={scrollRef.current} />}
        {meta && (
          <BlockMetaCard
            meta={meta}
            container={scrollRef.current}
            onClose={closeMeta}
            onGo={(place, withMark) => {
              closeMeta();
              openPlaceRef.current(place.char, withMark ? place.mark : null);
            }}
          />
        )}
      </div>

      {touch && focused && editor && (
        <div className="flex shrink-0 items-center gap-1 border-t border-border bg-card px-2 py-1">
          <OutlineButton
            label="Outdent"
            onPress={() => runCommand(outdentBlock)}
          >
            <IndentDecrease className="h-4 w-4" />
          </OutlineButton>
          <OutlineButton label="Indent" onPress={() => runCommand(indentBlock)}>
            <IndentIncrease className="h-4 w-4" />
          </OutlineButton>
          <OutlineButton label="Fold or unfold" onPress={toggleFold}>
            <ChevronsDownUp className="h-4 w-4" />
          </OutlineButton>
        </div>
      )}
    </div>
  );
}

/** A bar button that never takes the keyboard away from the text. */
function OutlineButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onPress}
      className="rounded p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

/**
 * The class that plays a landing, on the line that just landed.
 *
 * Put on the DOM rather than kept in the document: it is about this arrival,
 * not about the note, and nothing should save it or undo it. The next frame,
 * because the line has only just been drawn; and taken off at the end, so a
 * passage clipped twice from the same place lands twice.
 */
function land(editor: Editor, id: string) {
  requestAnimationFrame(() => {
    const el = editor.view.dom.querySelector<HTMLElement>(
      `[data-note-block][data-id="${CSS.escape(id)}"]`
    );
    if (!el) return;
    el.classList.add("nb-landing");
    el.addEventListener("animationend", () => el.classList.remove("nb-landing"), { once: true });
  });
}

/**
 * A line drawn as waiting for its conversation to be made.
 *
 * On the DOM rather than in the document, like a landing: it is about this
 * moment, not about the note, and nothing should save it, undo it, or find
 * it still there after a failure. The block's own view ignores attribute
 * changes on its element (notepad-block.ts), so this never reaches
 * ProseMirror at all.
 */
function setPending(editor: Editor, id: string, pending: boolean) {
  const el = editor.view.dom.querySelector<HTMLElement>(
    `[data-note-block][data-id="${CSS.escape(id)}"]`
  );
  if (!el) return;
  if (pending) el.setAttribute("data-pending", "true");
  else el.removeAttribute("data-pending");
}

/** Whether the line the cursor is on holds a chip. */
function chipInHead(state: Editor["state"]): boolean {
  const $from = state.selection.$from;
  const b = blockAt($from);
  if (!b || !inHead($from)) return false;
  let found = false;
  b.node.firstChild!.descendants((n) => {
    if (n.type.name === COMPOSE_NODE) found = true;
    return !found;
  });
  return found;
}

/** Where the chip on the cursor's line is, or null. */
function chipPosition(editor: Editor): number | null {
  const $from = editor.state.selection.$from;
  const b = blockAt($from);
  if (!b || !inHead($from)) return null;
  const start = b.pos + 2;
  let at: number | null = null;
  b.node.firstChild!.descendants((n, pos) => {
    if (at != null) return false;
    if (n.type.name === COMPOSE_NODE) at = start + pos;
    return at == null;
  });
  return at;
}

/**
 * What a line knows about itself.
 *
 * Opened by pressing the line's handle — the only place any of this is shown.
 * Where the reader was in the book when the line got its first words, when
 * that was, and a way back to the passage. A clipped passage offers two ways
 * back: the place, which just moves the book behind these notes, and the
 * highlight itself, which opens the mark and everything said under it.
 *
 * A line from a note written before any of this was recorded says so rather
 * than opening empty: nothing is broken, there was simply nobody keeping
 * track yet.
 *
 * Not a portal, for the reason the @ menu gives — it belongs to the panel and
 * scrolls with it. Anchored under whatever was pressed, and kept inside the
 * column.
 */
function BlockMetaCard({
  meta,
  container,
  onClose,
  onGo,
}: {
  meta: BlockMeta;
  container: HTMLDivElement | null;
  onClose: () => void;
  onGo: (place: NotePlace, withMark: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as globalThis.Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  // The line stays put while this is open, so one measurement is enough.
  let top = 0;
  let left = 0;
  if (container) {
    const box = container.getBoundingClientRect();
    top = meta.rect.bottom - box.top + container.scrollTop + 6;
    left = Math.max(4, Math.min(meta.rect.left - box.left, box.width - 240));
  }

  const when = meta.at ? stampLabel(meta.at) : null;
  const place = meta.place;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Where this line came from"
      className="absolute z-10 w-60 rounded-lg border border-border bg-popover p-1 text-sm shadow-lg"
      style={{ top, left }}
    >
      {!place && !when ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          Written before the notepad kept track of where you were.
        </p>
      ) : (
        <>
          {when && (
            <p className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5 shrink-0" />
              {when}
            </p>
          )}
          {place && (
            <button
              type="button"
              onClick={() => onGo(place, false)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{place.label || "Go to this place"}</span>
            </button>
          )}
          {place?.mark && (
            <button
              type="button"
              onClick={() => onGo(place, true)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
            >
              <Highlighter className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">Show the highlight</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Where a menu under the caret goes: below it, within the scrolling column,
 * flipped above it when the caret is near the bottom.
 */
function menuPlacement(rect: DOMRect | null, container: HTMLDivElement | null): { top: number; flip: boolean } {
  if (!rect || !container) return { top: 0, flip: false };
  const box = container.getBoundingClientRect();
  const caretTop = rect.top - box.top + container.scrollTop;
  const caretBottom = rect.bottom - box.top + container.scrollTop;
  const flip = rect.bottom + 200 > box.bottom && rect.top - box.top > 200;
  return { top: flip ? caretTop : caretBottom + 4, flip };
}

const MENU_CLASS = "absolute left-3 z-10 w-64 rounded-lg border border-border bg-popover p-1 shadow-lg";
const menuRowClass = (active: boolean) =>
  cn(
    "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
    active ? "bg-accent text-accent-foreground" : ""
  );

/**
 * The @ menu: everyone.
 *
 * Not a portal and not a menu, for the reasons MentionTypeahead gives — it
 * never takes focus, and it lives inside the panel.
 */
function MentionMenu({
  menu,
  container,
}: {
  menu: MentionMenuState;
  container: HTMLDivElement | null;
}) {
  if (menu.items.length === 0) return null;
  const { top, flip } = menuPlacement(menu.rect, container);

  return (
    <div
      role="listbox"
      aria-label="Send this to someone"
      className={cn(MENU_CLASS, flip && "-translate-y-full")}
      style={{ top }}
    >
      {menu.items.map((item, i) => {
        const active = i === menu.activeIndex;
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
            className={menuRowClass(active)}
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

/**
 * The / menu: what a line can do. Ask, then the two stamps the header
 * offers. Same body as the @ menu, for the same reasons.
 */
function SlashMenu({
  menu,
  container,
}: {
  menu: MenuState<SlashItem>;
  container: HTMLDivElement | null;
}) {
  if (menu.items.length === 0) return null;
  const { top, flip } = menuPlacement(menu.rect, container);

  return (
    <div
      role="listbox"
      aria-label="Commands"
      className={cn(MENU_CLASS, flip && "-translate-y-full")}
      style={{ top }}
    >
      {menu.items.map((item, i) => {
        const active = i === menu.activeIndex;
        const Icon = item.id === "ask" ? Sparkles : item.id === "here" ? MapPin : CalendarDays;
        return (
          <div
            key={item.id}
            role="option"
            aria-selected={active}
            aria-disabled={item.disabled || undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!item.disabled) menu.command(item);
            }}
            className={cn(menuRowClass(active), item.disabled && "cursor-default opacity-40")}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted">
              <Icon className="h-3 w-3 text-muted-foreground" />
            </span>
            <span className="font-medium">{item.label}</span>
            <span className="truncate text-xs text-muted-foreground">
              {item.id === "here" && item.disabled ? "nowhere to point yet" : item.hint}
            </span>
          </div>
        );
      })}
    </div>
  );
}
