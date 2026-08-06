import type { CSSProperties } from "react";
import {
  FONT_STEPS,
  LEADING_STEPS,
  type ReaderSettings,
} from "@/lib/reading/reader-settings";

/**
 * How book and article text is styled in the reader. Shared by the paged and
 * scrolling views so the two never drift apart typographically — the only thing
 * that should differ between them is where the text stops.
 */

/**
 * A conversation you started about this place in the book, set into the page.
 *
 * Written to read as marginalia rather than as a control sitting on top of the
 * text: a hairline above and below, the question in a smaller sans face, one
 * line and no more. No tint and no rounded box on purpose — the Palma renders
 * this in black and white, so the whole distinction has to survive in
 * typography and rules.
 *
 * `select-none` is not decoration. Selecting text that starts inside the mark
 * would hand the anchoring code a range beginning in an element that is
 * deliberately not a block, which produces no anchor at all — so the mark simply
 * isn't selectable, and a drag across it selects the prose either side.
 *
 * `text-left` and `text-indent` reset it out of the book's own justification,
 * which would otherwise stretch a short question across the measure.
 */
const CHAT_MARK_PROSE = [
  "[&_.reader-chat-mark]:my-5 [&_.reader-chat-mark]:block [&_.reader-chat-mark]:py-1.5",
  "[&_.reader-chat-mark]:cursor-pointer [&_.reader-chat-mark]:select-none",
  "[&_.reader-chat-mark]:border-y [&_.reader-chat-mark]:border-foreground/20",
  "[&_.reader-chat-mark]:truncate [&_.reader-chat-mark]:text-left [&_.reader-chat-mark]:[text-indent:0] [&_.reader-chat-mark]:[hyphens:none]",
  "[&_.reader-chat-mark]:font-sans [&_.reader-chat-mark]:text-[0.72em] [&_.reader-chat-mark]:leading-normal [&_.reader-chat-mark]:text-muted-foreground",
  // A mark split down the middle by a column edge reads as two broken rules.
  "[&_.reader-chat-mark]:[break-inside:avoid]",
  "[&_.reader-chat-mark:hover]:border-foreground/40 [&_.reader-chat-mark:hover]:text-foreground",
];

/**
 * A chapter's summary, offered in the page under the chapter's own heading.
 *
 * The same mark as above — same element, same hairlines, same splice — but it
 * says the same two words under every chapter it exists for, so it is set as a
 * label rather than as a sentence: centred beneath the centred heading, small
 * caps, a size down. Typography is the whole distinction, because the Palma
 * renders both of these in black and white and a tint would say nothing.
 *
 * The break rule is the load-bearing line. A chapter heading starts a fresh
 * column in paged mode; without this, the label it belongs to could fragment
 * away from it and land alone at the top of the next page, reading as a caption
 * for whatever paragraph happened to follow.
 */
const SUMMARY_MARK_PROSE = [
  "[&_.reader-summary-mark]:text-center [&_.reader-summary-mark]:uppercase",
  "[&_.reader-summary-mark]:text-[0.62em] [&_.reader-summary-mark]:tracking-[0.14em]",
  "[&_.reader-summary-mark]:[break-before:avoid] [&_.reader-summary-mark]:[-webkit-column-break-before:avoid]",
];

/**
 * A chapter heading that opens a menu when you tap it.
 *
 * Only some headings do — see the stamping effect in reader-annotation-layer.tsx
 * — so the class is the switch, and the name is shared from here so the rule and
 * the code that applies it can't drift.
 *
 * The whole treatment is a cursor and an underline on hover — nothing at rest.
 * A marking every chapter title wore permanently would turn a page of the book
 * into a page of controls, and hover is enough: by the time it can appear the
 * pointer has already said this is clickable, and on a touch screen neither
 * state exists to be missed.
 */
export const CHAPTER_TAP_CLASS = "reader-chapter-tap";

const CHAPTER_TAP_PROSE = [
  "[&_.reader-chapter-tap]:cursor-pointer",
  "[&_.reader-chapter-tap:hover]:underline [&_.reader-chapter-tap:hover]:decoration-1 [&_.reader-chapter-tap:hover]:underline-offset-4",
];

/**
 * Converted books are plain text: <p>, <h1>, <h2>, <blockquote>, and zero-height
 * page-anchor marks. Nothing else survives conversion, so this is the whole
 * stylesheet for a book.
 */
export const BOOK_PROSE = [
  "[&_p]:mb-5",
  "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic",
  "[&_.page-anchor]:block [&_.page-anchor]:h-0",
  "[&_.reader-heading]:scroll-mt-28 [&_.reader-heading]:text-center [&_.reader-heading]:font-serif [&_.reader-heading]:text-balance",
  "[&_.reader-h1]:mb-3 [&_.reader-h1]:text-3xl [&_.reader-h1]:font-semibold [&_.reader-h1]:tracking-tight",
  "[&_.reader-h2]:mb-7 [&_.reader-h2]:text-xl [&_.reader-h2]:font-medium [&_.reader-h2]:text-muted-foreground",
  ...CHAT_MARK_PROSE,
  ...SUMMARY_MARK_PROSE,
  ...CHAPTER_TAP_PROSE,
].join(" ");

/**
 * Scrolling only: headings need air above them when nothing else separates one
 * section from the last. The top margins live here rather than in BOOK_PROSE so
 * the paged rules never have to fight them for specificity.
 */
export const BOOK_PROSE_SCROLL = [
  "[&_.reader-h1]:mt-16 first:[&_.reader-h1]:mt-2",
  "[&_.reader-h2]:mt-8",
].join(" ");

/**
 * Paged only: a section starts a fresh column, the way a chapter starts a fresh
 * page in print.
 *
 * Targets `.reader-heading` — both levels — rather than h1 alone. Which tag a
 * book's chapters use is not something we get to assume: the converter emits h1
 * for parts and h2 for chapters, and plenty of books have no parts at all, so
 * their chapters are h2 throughout. Breaking only on h1 leaves those books
 * running chapter into chapter mid-column with nothing to mark the seam.
 *
 * The -webkit- alias is not redundant — Safari still needs it. No top margin,
 * because the break already put the heading at the top of a column.
 */
export const BOOK_PROSE_PAGED = [
  "[&_.reader-heading]:mt-0",
  "[&_.reader-heading]:[break-before:column] [&_.reader-heading]:[-webkit-column-break-before:always]",
  // Headings and quotes look broken when split across a column boundary;
  // paragraphs are meant to flow.
  "[&_.reader-heading]:[break-inside:avoid] [&_blockquote]:[break-inside:avoid]",
].join(" ");

/** Saved web articles keep their images, lists, tables and code. */
export const ARTICLE_PROSE = [
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_img]:my-4 [&_img]:mx-auto [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md",
  "[&_figure]:my-5 [&_figcaption]:mt-1.5 [&_figcaption]:text-center [&_figcaption]:text-sm [&_figcaption]:text-muted-foreground",
  "[&_ul]:my-5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-2",
  "[&_h1]:mt-8 [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight",
  "[&_h2]:mt-7 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold",
  "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-medium",
  "[&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:font-medium",
  "[&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:text-sm",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.9em]",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit",
  "[&_hr]:my-8 [&_hr]:border-border",
  "[&_table]:my-5 [&_table]:w-full [&_table]:text-sm [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:p-2",
].join(" ");

/**
 * The reader's own typography, from this device's settings.
 *
 * Inline rather than classes because the sizes are a continuous scale the reader
 * picks from, and because both views have to agree on them exactly — a paged
 * layout measured at one font size and painted at another lands on the wrong
 * page.
 */
export function typographyStyle(settings: ReaderSettings): CSSProperties {
  const justified = settings.align === "justify";
  return {
    fontSize: `${FONT_STEPS[settings.fontStep]}rem`,
    lineHeight: LEADING_STEPS[settings.leading],
    textAlign: justified ? "justify" : "left",
    // Justified text without hyphenation opens rivers of white space, which is
    // exactly what makes it look bad in a narrow column.
    hyphens: justified ? "auto" : "manual",
  };
}
