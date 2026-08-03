import "server-only";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import sanitizeHtml from "sanitize-html";
import { chapterSpans } from "@/lib/reading/chapter-target";
import { layoutSyntheticPages } from "@/lib/reading/synthetic-pages";

/**
 * Turning an uploaded PDF/EPUB into the reading experience: reflowable HTML with
 * a <span class="page-anchor" id="page-N"> at every source-page boundary, plus a
 * page map (page number → character range) so the reader can show "Page X of Y"
 * and future quizzes can scope to a page range.
 *
 * Page numbers are real for PDFs (every page is a discrete object) and for EPUBs
 * that ship a page-list. An EPUB without one reflows fine but has no source
 * pages — the reader falls back to a progress percentage.
 */

export type ConvertedPage = {
  pageNumber: number;
  anchorId: string;
  charStart: number;
  charEnd: number;
};

/** A chapter/section heading, for the reader's table-of-contents navigation. */
export type TocEntry = {
  title: string;
  /** The heading's id in the reflowed HTML, to scroll to. */
  anchorId: string;
  /** 1 = major section (Part/Book), 2 = chapter/section. */
  level: number;
  /** Source page the heading falls on, when known. */
  page: number | null;
  /**
   * Cumulative body words *before* this heading — i.e. the word offset where the
   * chapter starts. Chapter N's word span is [entry.startWord, nextEntry.startWord).
   * This is what lets a weekly goal snap to a chapter boundary when the EPUB's own
   * page numbers are synthetic (a "page" is defined as a fixed number of words).
   */
  startWord: number;
};

export type ConversionResult = {
  /** Reflowable, sanitized HTML with page + heading anchors embedded. */
  html: string;
  pages: ConvertedPage[];
  toc: TocEntry[];
  pageCount: number | null;
  hasRealPages: boolean;
  /** Total characters of body text — the substrate for future quiz scoping. */
  charCount: number;
  /**
   * Total body words. The source of truth for page estimates and chapter targets:
   * for an EPUB without a real page-list, a "page" is defined as 280 words, so the
   * whole goal system can run in a stable, device-independent unit.
   */
  wordCount: number;
  /**
   * The EPUB's embedded cover, as a `data:` URL ready to drop straight into an
   * <img src>, or null if the file ships no cover (PDFs always null). Inlined
   * rather than uploaded so it matches the existing cover_image_url contract (a
   * stable, directly-renderable URL) without a signed-URL expiry.
   */
  coverImageDataUrl: string | null;
};

export class ConversionError extends Error {}

/** A unit of converted content: a paragraph or a heading. */
type Block =
  | { kind: "para"; text: string }
  | { kind: "heading"; text: string; level: number };

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "em",
    "i",
    "strong",
    "b",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "span",
  ],
  // id/class on any allowed tag carry our page + heading anchors.
  allowedAttributes: { "*": ["id", "class"] },
  // Drop everything else (scripts, styles, images, links, etc.) entirely.
  disallowedTagsMode: "discard",
};

function pageAnchor(pageNumber: number): string {
  return `<span class="page-anchor" id="page-${pageNumber}"></span>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Words in a run of text: whitespace-delimited tokens. The substrate for page
 *  estimates and chapter targets (see ConversionResult.wordCount). */
function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * A display title for a chapter heading. Publisher nav labels are often a bare
 * number ("1", "12") — image-based chapter heads especially — which reads oddly
 * on its own, so those become "Chapter N". Named sections ("Prologue", "Part I:
 * The Spark") are left untouched.
 */
function chapterDisplayTitle(title: string): string {
  const t = title.trim();
  return /^\d{1,3}$/.test(t) ? `Chapter ${t}` : t;
}

/**
 * Decide whether a line is a chapter/section heading, and at what level. Uses
 * textual conventions (Part/Chapter/numbers/all-caps) plus an optional font-size
 * signal (a line much larger than the body text). Returns null for body text.
 */
function classifyHeading(
  text: string,
  fontRatio: number
): { level: number } | null {
  const t = text.trim();
  if (!t || t.length > 70) return null;
  const words = t.split(/\s+/);

  // "Part I", "Book Two" — the major divisions.
  if (/^(part|book)\b[\s.:–-]*(\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)?\b/i.test(t) && words.length <= 6) {
    return { level: 1 };
  }
  // "Chapter 3", "Prologue", "Epilogue", etc.
  if (/^(chapter|prologue|epilogue|introduction|foreword|afterword|preface|interlude)\b/i.test(t) && words.length <= 8) {
    return { level: 2 };
  }
  // A line that's just a number (a bare chapter number).
  if (/^\d{1,3}[.:)]?$/.test(t)) return { level: 2 };
  // A short ALL-CAPS line (chapter titles, subtitles like "THE TRIBUTES").
  const letters = t.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 2 && words.length <= 7 && t === t.toUpperCase() && /[A-Z]/.test(t)) {
    return { level: 2 };
  }
  // A short line set noticeably larger than the body font.
  if (fontRatio >= 1.3 && words.length <= 8) return { level: 2 };
  return null;
}

/**
 * Assemble reflowable HTML from per-page block lists. Emits page anchors and
 * heading anchors (sec-N), records the character range each page covers, and
 * collects the table of contents from the headings.
 */
function buildPagedHtml(
  pageBlocks: { pageNumber: number | null; blocks: Block[] }[]
): {
  html: string;
  pages: ConvertedPage[];
  toc: TocEntry[];
  charCount: number;
  wordCount: number;
} {
  const htmlParts: string[] = [];
  const pages: ConvertedPage[] = [];
  const toc: TocEntry[] = [];
  let charCursor = 0;
  let wordCursor = 0;
  let sectionSeq = 0;

  for (const { pageNumber, blocks } of pageBlocks) {
    const charStart = charCursor;
    if (pageNumber != null) htmlParts.push(pageAnchor(pageNumber));
    for (const block of blocks) {
      if (block.kind === "heading") {
        const anchorId = `sec-${++sectionSeq}`;
        const tag = block.level <= 1 ? "h1" : "h2";
        htmlParts.push(
          `<${tag} id="${anchorId}" class="reader-heading reader-h${block.level <= 1 ? 1 : 2}">${escapeHtml(block.text)}</${tag}>`
        );
        toc.push({ title: block.text, anchorId, level: block.level <= 1 ? 1 : 2, page: pageNumber, startWord: wordCursor });
      } else {
        htmlParts.push(`<p>${escapeHtml(block.text)}</p>`);
      }
      // +1 approximates the whitespace separating blocks in the text flow.
      charCursor += block.text.length + 1;
      wordCursor += countWords(block.text);
    }
    if (pageNumber != null) {
      pages.push({
        pageNumber,
        anchorId: `page-${pageNumber}`,
        charStart,
        charEnd: charCursor,
      });
    }
  }

  return { html: htmlParts.join("\n"), pages, toc, charCount: charCursor, wordCount: wordCursor };
}

// ============================================================
// PDF
// ============================================================

type PdfTextItem = {
  str: string;
  width: number;
  height: number;
  transform: number[];
};

type PdfLine = { y: number; text: string; size: number };

/** Group positioned PDF text items into lines, in top-to-bottom reading order. */
function linesFromItems(items: PdfTextItem[]): PdfLine[] {
  const glyphs = items.filter((it) => it.str && it.str.length > 0);
  if (glyphs.length === 0) return [];

  type Acc = { y: number; x: number; text: string; size: number };
  const acc: Acc[] = [];
  for (const it of glyphs) {
    const x = it.transform[4];
    const y = it.transform[5];
    const size = it.height || Math.abs(it.transform[3]) || 0;
    const last = acc[acc.length - 1];
    if (last && Math.abs(last.y - y) < 4) {
      // Same line: insert a space when there's a real horizontal gap.
      const needsSpace =
        !last.text.endsWith(" ") && !it.str.startsWith(" ") && x - last.x > 1;
      last.text += (needsSpace ? " " : "") + it.str;
      last.x = x + it.width;
      last.size = Math.max(last.size, size);
    } else {
      acc.push({ y, x: x + it.width, text: it.str, size });
    }
  }
  return acc.map((l) => ({ y: l.y, text: l.text, size: l.size }));
}

/**
 * Turn a page's lines into blocks: heading lines become their own heading
 * blocks; runs of body lines are joined into paragraphs, split on
 * larger-than-normal vertical gaps.
 */
function blocksFromLines(lines: PdfLine[], bodySize: number): Block[] {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    gaps.push(Math.abs(lines[i - 1].y - lines[i].y));
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const medianGap = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const paraThreshold = medianGap > 0 ? medianGap * 1.6 : Infinity;

  const blocks: Block[] = [];
  let current = "";
  const flush = () => {
    if (current) blocks.push({ kind: "para", text: current });
    current = "";
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].text.trim();
    if (!raw) continue;
    const ratio = bodySize > 0 ? lines[i].size / bodySize : 1;
    const heading = classifyHeading(raw, ratio);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", text: raw, level: heading.level });
      continue;
    }
    const gapBefore = i > 0 ? Math.abs(lines[i - 1].y - lines[i].y) : 0;
    if (current && gapBefore > paraThreshold) flush();
    if (!current) {
      current = raw;
    } else if (current.endsWith("-")) {
      // De-hyphenate a word split across a line break.
      current = current.slice(0, -1) + raw;
    } else {
      current += " " + raw;
    }
  }
  flush();
  return blocks;
}

/** A line's identity for spotting running headers/footers: letters only, so a
 *  changing page number ("12 | Page …") still matches across pages. Lines that
 *  are essentially just a number (page numbers) collapse to a shared token. */
function marginSignature(text: string): string {
  const letters = text.toLowerCase().replace(/[^a-z]/g, "");
  if (letters.length >= 4) return letters;
  const compact = text.replace(/\s/g, "");
  const digits = (compact.match(/[0-9ivxlcdm]/gi) ?? []).length;
  if (compact.length > 0 && digits / compact.length > 0.6) return " num";
  return "";
}

/**
 * Identify running headers/footers — the title/page-number lines printed in the
 * top or bottom margin of (nearly) every page — so they can be dropped instead
 * of interrupting the prose at each page boundary.
 */
function runningMarginSignatures(pages: PdfLine[][]): Set<string> {
  const counts = new Map<string, number>();
  for (const lines of pages) {
    if (lines.length === 0) continue;
    let top = lines[0];
    let bottom = lines[0];
    for (const l of lines) {
      if (l.y > top.y) top = l;
      if (l.y < bottom.y) bottom = l;
    }
    const seen = new Set<string>();
    for (const line of top === bottom ? [top] : [top, bottom]) {
      const sig = marginSignature(line.text);
      if (!sig || seen.has(sig)) continue;
      seen.add(sig);
      counts.set(sig, (counts.get(sig) ?? 0) + 1);
    }
  }
  // Require the line to recur across a meaningful share of pages.
  const threshold = Math.max(3, Math.ceil(pages.length * 0.3));
  return new Set(
    [...counts].filter(([, c]) => c >= threshold).map(([sig]) => sig)
  );
}

/** Drop a page's top/bottom line when it matches a known running header/footer. */
function stripMargins(lines: PdfLine[], running: Set<string>): PdfLine[] {
  if (lines.length === 0 || running.size === 0) return lines;
  let top = lines[0];
  let bottom = lines[0];
  for (const l of lines) {
    if (l.y > top.y) top = l;
    if (l.y < bottom.y) bottom = l;
  }
  const drop = new Set<PdfLine>();
  if (running.has(marginSignature(top.text))) drop.add(top);
  if (running.has(marginSignature(bottom.text))) drop.add(bottom);
  return drop.size ? lines.filter((l) => !drop.has(l)) : lines;
}

/**
 * pdfjs in serverless Node needs two things our deployment otherwise breaks, and
 * both fail the same way: pdfjs tries to resolve them itself with module
 * specifiers the bundler can't follow, so it must be handed them up front.
 *
 *  1. The browser globals DOMMatrix / ImageData / Path2D. pdfjs loads these from
 *     @napi-rs/canvas via `createRequire(import.meta.url)`, but under the bundler
 *     `import.meta.url` points at a generated external chunk that can't resolve
 *     the package — so the polyfill fails and loading pdf.mjs throws
 *     "DOMMatrix is not defined".
 *  2. The worker. With no real Worker in Node, pdfjs runs a "fake worker" by
 *     dynamically importing `./pdf.worker.mjs` (a computed specifier the bundler
 *     can't trace, so the file is pruned from the function → "Setting up fake
 *     worker failed: Cannot find module …/pdf.worker.mjs"). Setting
 *     `globalThis.pdfjsWorker` makes pdfjs use it directly and skip that import.
 *
 * Both imports here use static specifiers resolved from this module's own
 * context, so the bundler traces and ships the files.
 */
async function ensurePdfEnv(): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  if (!g.DOMMatrix || !g.ImageData || !g.Path2D) {
    const canvas = await import("@napi-rs/canvas");
    g.DOMMatrix ??= canvas.DOMMatrix;
    g.ImageData ??= canvas.ImageData;
    g.Path2D ??= canvas.Path2D;
  }
  if (!g.pdfjsWorker) {
    g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  }
}

async function convertPdf(buffer: ArrayBuffer): Promise<ConversionResult> {
  await ensurePdfEnv();
  // The legacy build runs in Node without a browser DOM or a web worker.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  }).promise;

  // First pass: extract each page's lines so we can spot running headers/footers.
  const pageLines: PdfLine[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = content.items as unknown as PdfTextItem[];
    pageLines.push(linesFromItems(items));
  }
  await doc.cleanup();

  const running = runningMarginSignatures(pageLines);

  // The body font size: the most common line size across the document. Headings
  // are judged relative to it (a much larger line is likely a heading).
  const sizeCounts = new Map<number, number>();
  for (const lines of pageLines) {
    for (const l of lines) {
      const k = Math.round(l.size);
      if (k > 0) sizeCounts.set(k, (sizeCounts.get(k) ?? 0) + 1);
    }
  }
  let bodySize = 0;
  let bodySeen = -1;
  for (const [size, count] of sizeCounts) {
    if (count > bodySeen) {
      bodySeen = count;
      bodySize = size;
    }
  }

  const pageBlocks: { pageNumber: number | null; blocks: Block[] }[] = [];
  let totalChars = 0;
  for (let n = 0; n < pageLines.length; n++) {
    const kept = stripMargins(pageLines[n], running);
    const blocks = blocksFromLines(kept, bodySize);
    totalChars += blocks.reduce((sum, b) => sum + b.text.length, 0);
    pageBlocks.push({ pageNumber: n + 1, blocks });
  }

  // A born-digital PDF yields plenty of text; a scanned one yields ~none. Only
  // flag a multi-page doc that's near-empty throughout (a real book of scans) so
  // a legitimately sparse short PDF isn't rejected.
  if (totalChars === 0 || (doc.numPages >= 2 && totalChars / doc.numPages < 10)) {
    throw new ConversionError(
      "This looks like a scanned PDF with no selectable text. Try a file with real text, or a different edition."
    );
  }

  const { html, pages, toc, charCount, wordCount } = buildPagedHtml(pageBlocks);
  return {
    html: sanitizeHtml(html, SANITIZE_OPTIONS),
    pages,
    toc,
    pageCount: doc.numPages,
    hasRealPages: true,
    charCount,
    wordCount,
    coverImageDataUrl: null,
  };
}

// ============================================================
// EPUB
// ============================================================

const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "li",
]);

// xmldom's Node/Element types differ structurally from lib.dom's, so the EPUB
// walk uses loose typing — these elements expose the handful of accessors we use.
type XmlNode = {
  nodeType: number;
  childNodes: { length: number; [index: number]: XmlNode };
};
type XmlElement = XmlNode & {
  tagName: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  getElementsByTagName(tag: string): { length: number; [index: number]: XmlElement };
};
type XmlDocument = {
  getElementsByTagName(tag: string): { length: number; [index: number]: XmlElement };
};

function attr(el: XmlElement, name: string): string | null {
  return el.getAttribute(name);
}

function isPageBreak(el: XmlElement): boolean {
  const epubType = attr(el, "epub:type") ?? "";
  const role = attr(el, "role") ?? "";
  return /\bpagebreak\b/.test(epubType) || role === "doc-pagebreak";
}

function pageLabel(el: XmlElement): string {
  return (
    attr(el, "aria-label") ||
    attr(el, "title") ||
    el.textContent?.trim() ||
    attr(el, "id") ||
    ""
  );
}

/** Resolve a path relative to a base directory (POSIX-style, as in EPUB zips). */
function resolvePath(base: string, rel: string): string {
  const stack = base ? base.split("/") : [];
  for (const part of rel.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

type EpubMark = { pageNumber: number; beforeBlock: number };

/**
 * Walk a spine document collecting blocks (paragraphs + headings from h1-h6) and
 * any page-break marks. Also records, for each id in `wantedIds` (the fragment
 * targets a nav/NCX entry points at), the block index where it falls — including
 * ids on non-block elements like the `<img id="…">` many publishers use as
 * image-based chapter headers. That index is the chapter's start in the text.
 */
function walkEpubDoc(
  body: XmlElement,
  blocks: Block[],
  marks: EpubMark[],
  wantedIds: Set<string>,
  anchors: Map<string, number>
): void {
  const visit = (node: XmlNode) => {
    if (node.nodeType !== 1) return; // elements only
    const el = node as XmlElement;
    // Record a wanted fragment at the block it precedes (blocks.length is the
    // index the *next* pushed block will take — i.e. the chapter's first block).
    if (wantedIds.size > 0) {
      const id = attr(el, "id");
      if (id && wantedIds.has(id) && !anchors.has(id)) anchors.set(id, blocks.length);
    }
    if (isPageBreak(el)) {
      const num = parseInt(pageLabel(el), 10);
      if (!Number.isNaN(num)) marks.push({ pageNumber: num, beforeBlock: blocks.length });
      return;
    }
    const tag = el.tagName.toLowerCase();
    if (BLOCK_TAGS.has(tag)) {
      const text = el.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (text) {
        const headingMatch = /^h([1-6])$/.exec(tag);
        if (headingMatch) {
          // h1 → major section, h2+ → chapter-level in the TOC.
          const level = Number(headingMatch[1]) <= 1 ? 1 : 2;
          blocks.push({ kind: "heading", text, level });
        } else {
          blocks.push({ kind: "para", text });
        }
      }
      // A page-break can be nested inside a block; capture those too.
      for (let i = 0; i < el.childNodes.length; i++) {
        const child = el.childNodes[i];
        if (child.nodeType === 1 && isPageBreak(child as XmlElement)) {
          const num = parseInt(pageLabel(child as XmlElement), 10);
          if (!Number.isNaN(num)) {
            marks.push({ pageNumber: num, beforeBlock: blocks.length - 1 });
          }
        }
      }
      return;
    }
    for (let i = 0; i < el.childNodes.length; i++) visit(el.childNodes[i]);
  };
  visit(body);
}

/** Whether a TOC title names a major division (Part/Book) vs a chapter. */
function tocLevel(title: string): number {
  return /^(part|book)\b/i.test(title.trim()) ? 1 : 2;
}

/** Normalize text for the duplicate-title check: alphanumerics only, lowercased. */
function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Drop a chapter file's leading title lines that just repeat the TOC title (e.g.
 * a "<p>Introduction</p><p>The Dark Wood</p>" pair under a nav title of
 * "Introduction: The Dark Wood"), so the heading isn't shown twice.
 */
function stripLeadingTitle(blocks: Block[], title: string): Block[] {
  const target = normalizeTitle(title);
  if (!target) return blocks;
  let i = 0;
  while (i < blocks.length) {
    const n = normalizeTitle(blocks[i].text);
    if (n && n.length <= target.length && target.includes(n)) i++;
    else break;
  }
  return blocks.slice(i);
}

/** A single table-of-contents entry: which spine file it lands in, the fragment
 *  id within that file (null = the file's start), and its title. */
type NavEntry = { file: string; fragment: string | null; title: string };

/** Split an href/src ("file.html#frag") into its file path and fragment id. */
function splitHref(base: string, href: string): { file: string; fragment: string | null } {
  const hashIndex = href.indexOf("#");
  const rawFile = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
  const fragment = hashIndex >= 0 ? decodeURIComponent(href.slice(hashIndex + 1)) : null;
  return { file: resolvePath(base, rawFile), fragment: fragment || null };
}

/**
 * Read an EPUB's table of contents (the EPUB3 nav doc, or the EPUB2 NCX) as an
 * *ordered, fragment-level* list of entries. Unlike a per-file map, this keeps
 * every chapter even when a whole Part shares one spine file (a very common
 * layout — e.g. all of "Part I" in a single HTML file, its chapters marked only
 * by `#toc_marker` fragments on image headers). The fragment is what lets each
 * chapter be located in the reflowed text. This is the authoritative chapter
 * list — far more reliable than guessing headings from publisher-specific markup.
 */
async function readEpubNav(
  parser: DOMParser,
  opf: XmlDocument,
  opfDir: string,
  readText: (path: string) => Promise<string | null>
): Promise<NavEntry[]> {
  const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

  const items = opf.getElementsByTagName("item");
  let navHref: string | null = null;
  let ncxHref: string | null = null;
  for (let i = 0; i < items.length; i++) {
    const props = items[i].getAttribute("properties") ?? "";
    const mediaType = items[i].getAttribute("media-type") ?? "";
    const href = items[i].getAttribute("href");
    if (!href) continue;
    if (/\bnav\b/.test(props)) navHref = href;
    if (mediaType === "application/x-dtbncx+xml") ncxHref = href;
  }

  const entries: NavEntry[] = [];

  // EPUB3 nav document: <nav epub:type="toc"> with <a href="file#frag">Title</a>.
  if (navHref) {
    const navPath = resolvePath(opfDir, navHref);
    const navXml = await readText(navPath);
    if (navXml) {
      const navDoc = parser.parseFromString(navXml, "text/html") as unknown as XmlDocument;
      const navDir = dirOf(navPath);
      const navs = navDoc.getElementsByTagName("nav");
      let tocNav: XmlElement | null = null;
      for (let i = 0; i < navs.length; i++) {
        if ((navs[i].getAttribute("epub:type") ?? "").includes("toc")) tocNav = navs[i];
      }
      const scope: XmlDocument | XmlElement = tocNav ?? navDoc;
      const anchors = scope.getElementsByTagName("a");
      for (let i = 0; i < anchors.length; i++) {
        const href = anchors[i].getAttribute("href");
        const title = anchors[i].textContent?.replace(/\s+/g, " ").trim();
        if (!href || !title) continue;
        const { file, fragment } = splitHref(navDir, href);
        entries.push({ file, fragment, title });
      }
    }
  }

  // EPUB2 fallback: the NCX navMap. getElementsByTagName flattens nested
  // navPoints in document order, so a Part and its child chapters arrive in
  // reading order.
  if (entries.length === 0 && ncxHref) {
    const ncxPath = resolvePath(opfDir, ncxHref);
    const ncxXml = await readText(ncxPath);
    if (ncxXml) {
      const ncx = parser.parseFromString(ncxXml, "text/xml") as unknown as XmlDocument;
      const ncxDir = dirOf(ncxPath);
      const points = ncx.getElementsByTagName("navPoint");
      for (let i = 0; i < points.length; i++) {
        const label = points[i].getElementsByTagName("text")[0]?.textContent
          ?.replace(/\s+/g, " ")
          .trim();
        const src = points[i].getElementsByTagName("content")[0]?.getAttribute("src");
        if (!label || !src) continue;
        const { file, fragment } = splitHref(ncxDir, src);
        entries.push({ file, fragment, title: label });
      }
    }
  }

  return entries;
}

/**
 * Cap on the inlined cover, measured on the base64 string (~1.37× the raw image
 * bytes). Covers are stored as a data URL on reading_books.cover_image_url and
 * ship in every book-list query, so a pathologically large cover would bloat
 * those payloads — past this we skip the embedded cover and leave the placeholder.
 * 2.7M base64 ≈ a ~2MB image, comfortably above normal cover sizes.
 */
const EPUB_COVER_MAX_BASE64 = 2_700_000;

/** Best-effort image MIME for a cover, preferring the OPF's declared type. */
function coverImageMime(path: string, declaredType: string | null): string | null {
  if (declaredType && declaredType.startsWith("image/")) return declaredType;
  const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return null;
  }
}

/**
 * Pull the EPUB's embedded cover out of the archive as an inlined `data:` URL.
 * Covers are declared three different ways across EPUB versions, so we try each:
 * the EPUB3 manifest item with properties="cover-image", the EPUB2
 * <meta name="cover" content="{itemId}"/> pointer, and finally a manifest image
 * whose id/href just looks like a cover. Returns null when there's no usable
 * cover (none declared, missing file, non-image, or over the size cap).
 */
async function extractEpubCover(
  zip: JSZip,
  opf: XmlDocument,
  opfDir: string
): Promise<string | null> {
  const items = opf.getElementsByTagName("item");

  let coverHref: string | null = null;
  let declaredType: string | null = null;

  // 1. EPUB3: the manifest item flagged properties="cover-image".
  for (let i = 0; i < items.length; i++) {
    const props = items[i].getAttribute("properties") ?? "";
    if (/\bcover-image\b/.test(props)) {
      coverHref = items[i].getAttribute("href");
      declaredType = items[i].getAttribute("media-type");
      break;
    }
  }

  // 2. EPUB2: <meta name="cover" content="{itemId}"/> -> that manifest item.
  if (!coverHref) {
    const metas = opf.getElementsByTagName("meta");
    let coverId: string | null = null;
    for (let i = 0; i < metas.length; i++) {
      if ((metas[i].getAttribute("name") ?? "").toLowerCase() === "cover") {
        coverId = metas[i].getAttribute("content");
        break;
      }
    }
    if (coverId) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].getAttribute("id") === coverId) {
          coverHref = items[i].getAttribute("href");
          declaredType = items[i].getAttribute("media-type");
          break;
        }
      }
    }
  }

  // 3. Fallback: any image item whose id or href reads like a cover.
  if (!coverHref) {
    for (let i = 0; i < items.length; i++) {
      const type = items[i].getAttribute("media-type") ?? "";
      if (!type.startsWith("image/")) continue;
      const id = items[i].getAttribute("id") ?? "";
      const href = items[i].getAttribute("href") ?? "";
      if (/cover/i.test(id) || /cover/i.test(href)) {
        coverHref = href;
        declaredType = type;
        break;
      }
    }
  }

  if (!coverHref) return null;

  const coverPath = resolvePath(opfDir, coverHref);
  const mime = coverImageMime(coverPath, declaredType);
  if (!mime || mime === "image/svg+xml") return null; // raster covers only

  const file = zip.file(coverPath);
  if (!file) return null;
  const base64 = await file.async("base64");
  if (!base64 || base64.length > EPUB_COVER_MAX_BASE64) return null;

  return `data:${mime};base64,${base64}`;
}

async function convertEpub(buffer: ArrayBuffer): Promise<ConversionResult> {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new DOMParser();

  const readText = async (path: string): Promise<string | null> => {
    const file = zip.file(path);
    return file ? file.async("string") : null;
  };

  const containerXml = await readText("META-INF/container.xml");
  if (!containerXml) throw new ConversionError("This EPUB is missing its container.");
  const container = parser.parseFromString(containerXml, "text/xml");
  const rootfile = container.getElementsByTagName("rootfile")[0];
  const opfPath = rootfile?.getAttribute("full-path");
  if (!opfPath) throw new ConversionError("Couldn't find this EPUB's content file.");
  const opfDir = opfPath.includes("/")
    ? opfPath.slice(0, opfPath.lastIndexOf("/"))
    : "";

  const opfXml = await readText(opfPath);
  if (!opfXml) throw new ConversionError("Couldn't read this EPUB's content file.");
  const opf = parser.parseFromString(opfXml, "text/xml");

  // Manifest: id -> resolved href.
  const manifest = new Map<string, string>();
  const items = opf.getElementsByTagName("item");
  for (let i = 0; i < items.length; i++) {
    const id = items[i].getAttribute("id");
    const href = items[i].getAttribute("href");
    if (id && href) manifest.set(id, resolvePath(opfDir, href));
  }

  // The publisher's cover art, inlined as a data URL — best-effort, never fatal.
  let coverImageDataUrl: string | null = null;
  try {
    coverImageDataUrl = await extractEpubCover(zip, opf as unknown as XmlDocument, opfDir);
  } catch {
    coverImageDataUrl = null;
  }

  // Spine: ordered list of content documents.
  const spineRefs = opf.getElementsByTagName("itemref");
  const spinePaths: string[] = [];
  for (let i = 0; i < spineRefs.length; i++) {
    const idref = spineRefs[i].getAttribute("idref");
    const path = idref ? manifest.get(idref) : null;
    if (path) spinePaths.push(path);
  }
  if (spinePaths.length === 0) throw new ConversionError("This EPUB has no readable content.");

  // The authoritative, fragment-level chapter list, in reading order. Chapters
  // are located in the reflowed text by their fragment ids (below), so a Part
  // that shares one spine file still yields every chapter.
  const navEntries = await readEpubNav(
    parser,
    opf as unknown as XmlDocument,
    opfDir,
    readText
  );
  // A file's first nav title, used to strip its repeated in-file title lines.
  const firstTitleByFile = new Map<string, string>();
  // Fragment ids we need to locate, per file — so the walk only tracks those.
  const wantedByFile = new Map<string, Set<string>>();
  for (const e of navEntries) {
    if (!firstTitleByFile.has(e.file)) firstTitleByFile.set(e.file, e.title);
    if (e.fragment) {
      const set = wantedByFile.get(e.file) ?? new Set<string>();
      set.add(e.fragment);
      wantedByFile.set(e.file, set);
    }
  }

  const blocks: Block[] = [];
  const marks: EpubMark[] = [];
  // Resolved location of each wanted fragment: "file#frag" -> global block index.
  const anchorAt = new Map<string, number>();
  // Where each spine file's content begins in the global block stream (for
  // file-level nav entries, and as a fallback when a fragment can't be found).
  const fileFirstIndex = new Map<string, number>();

  for (const path of spinePaths) {
    const xml = await readText(path);
    if (!xml) continue;
    const dom = parser.parseFromString(xml, "text/html");
    const body = dom.getElementsByTagName("body")[0];
    if (!body) continue;

    const fileBlocks: Block[] = [];
    const fileMarks: EpubMark[] = [];
    const fileAnchors = new Map<string, number>();
    walkEpubDoc(body, fileBlocks, fileMarks, wantedByFile.get(path) ?? new Set(), fileAnchors);

    const navTitle = firstTitleByFile.get(path);
    const kept = navTitle ? stripLeadingTitle(fileBlocks, navTitle) : fileBlocks;

    // Skip empty front matter (e.g. an image-only cover) so it doesn't litter
    // the TOC with contentless sections.
    if (!kept.some((b) => b.kind === "para")) continue;

    const dropped = fileBlocks.length - kept.length;
    const base = blocks.length;
    fileFirstIndex.set(path, base);
    for (const b of kept) blocks.push(b);
    for (const [frag, localIdx] of fileAnchors) {
      const adj = localIdx - dropped;
      if (adj >= 0) anchorAt.set(`${path}#${frag}`, base + adj);
    }
    for (const m of fileMarks) {
      marks.push({
        pageNumber: m.pageNumber,
        beforeBlock: base + Math.max(0, m.beforeBlock - dropped),
      });
    }
  }

  if (blocks.length === 0) {
    throw new ConversionError("We couldn't extract any text from this EPUB.");
  }

  // Resolve each nav entry to a block index, in order; group them so a heading
  // can be injected at that spot during HTML assembly. A fragment that can't be
  // found falls back to the file's start.
  const navByBlock = new Map<number, { title: string; level: number }[]>();
  const seenNav = new Set<string>();
  for (const e of navEntries) {
    let index = e.fragment != null ? anchorAt.get(`${e.file}#${e.fragment}`) : undefined;
    if (index == null) index = fileFirstIndex.get(e.file);
    if (index == null) continue; // file skipped (front matter) or unresolved
    const title = chapterDisplayTitle(e.title);
    const key = `${index}::${normalizeTitle(title)}`;
    if (seenNav.has(key)) continue;
    seenNav.add(key);
    const list = navByBlock.get(index) ?? [];
    list.push({ title, level: tocLevel(e.title) });
    navByBlock.set(index, list);
  }

  // Build HTML, inserting page anchors at their block boundaries and chapter
  // headings at their nav positions.
  const marksByBlock = new Map<number, number>();
  for (const m of marks) {
    if (!marksByBlock.has(m.beforeBlock)) marksByBlock.set(m.beforeBlock, m.pageNumber);
  }
  const hasRealPages = marksByBlock.size > 0;

  const htmlParts: string[] = [];
  const pages: ConvertedPage[] = [];
  const toc: TocEntry[] = [];
  // (char, word) at each block boundary, for laying out synthetic pages below.
  const blockMarks: { char: number; word: number }[] = [];
  let charCursor = 0;
  let wordCursor = 0;
  let sectionSeq = 0;
  let currentPage: number | null = null;
  let openPage: { pageNumber: number; charStart: number } | null = null;

  const closePage = () => {
    if (openPage) {
      pages.push({
        pageNumber: openPage.pageNumber,
        anchorId: `page-${openPage.pageNumber}`,
        charStart: openPage.charStart,
        charEnd: charCursor,
      });
      openPage = null;
    }
  };

  // Advance the cursors for one emitted element's text. Every visible block —
  // paragraph OR heading (including the chapter headings we inject) — must
  // advance them, or the char offsets drift from getTextForRange's rebuild of
  // this same stream (which counts every <p>/<h*>), breaking quiz scoping.
  const advance = (text: string) => {
    charCursor += text.length + 1;
    wordCursor += countWords(text);
  };

  const pushHeading = (text: string, level: number) => {
    const anchorId = `sec-${++sectionSeq}`;
    const lvl = level <= 1 ? 1 : 2;
    const tag = lvl === 1 ? "h1" : "h2";
    htmlParts.push(
      `<${tag} id="${anchorId}" class="reader-heading reader-h${lvl}">${escapeHtml(text)}</${tag}>`
    );
    // startWord is the words *before* this heading — the chapter's start offset.
    toc.push({
      title: text,
      anchorId,
      level: lvl,
      page: hasRealPages ? currentPage : null,
      startWord: wordCursor,
    });
    advance(text);
  };

  for (let i = 0; i < blocks.length; i++) {
    const pageNum = marksByBlock.get(i);
    if (pageNum != null) {
      closePage();
      htmlParts.push(pageAnchor(pageNum));
      currentPage = pageNum;
      openPage = { pageNumber: pageNum, charStart: charCursor };
    }
    const block = blocks[i];
    // Inject chapter headings from the nav here — but not when this block is
    // itself a real heading (a semantic <h*>), which becomes the entry instead,
    // to avoid a doubled title.
    const injected = navByBlock.get(i);
    if (injected && block.kind !== "heading") {
      for (const nv of injected) pushHeading(nv.title, nv.level);
    }
    if (block.kind === "heading") {
      pushHeading(block.text, block.level);
    } else {
      htmlParts.push(`<p>${escapeHtml(block.text)}</p>`);
      advance(block.text);
    }
    blockMarks.push({ char: charCursor, word: wordCursor });
  }
  closePage();

  // A synthetic-page EPUB with real chapters gets a 280-word page map, so quiz
  // scoping (getTextForRange, keyed on reading_book_pages) covers the reader's
  // actual stretch instead of falling back to the whole book. The page space is
  // block-aligned and matches wordsToPage(), so target/current pages line up.
  const chaptered = chapterSpans(toc, wordCursor).length > 0;
  const syntheticPages: ConvertedPage[] =
    !hasRealPages && chaptered
      ? layoutSyntheticPages(blockMarks, charCursor, wordCursor)
      : [];

  return {
    html: sanitizeHtml(htmlParts.join("\n"), SANITIZE_OPTIONS),
    pages: hasRealPages ? pages : syntheticPages,
    toc,
    // Keep pageCount null for synthetic books so the reader still shows a
    // percentage; the page rows exist purely to scope quizzes to a range.
    pageCount: hasRealPages ? pages.length : null,
    hasRealPages,
    charCount: charCursor,
    wordCount: wordCursor,
    coverImageDataUrl,
  };
}

export async function convertBookFile(
  format: "pdf" | "epub",
  buffer: ArrayBuffer
): Promise<ConversionResult> {
  return format === "pdf" ? convertPdf(buffer) : convertEpub(buffer);
}
