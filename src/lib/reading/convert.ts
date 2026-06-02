import "server-only";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import sanitizeHtml from "sanitize-html";

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
} {
  const htmlParts: string[] = [];
  const pages: ConvertedPage[] = [];
  const toc: TocEntry[] = [];
  let charCursor = 0;
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
        toc.push({ title: block.text, anchorId, level: block.level <= 1 ? 1 : 2, page: pageNumber });
      } else {
        htmlParts.push(`<p>${escapeHtml(block.text)}</p>`);
      }
      // +1 approximates the whitespace separating blocks in the text flow.
      charCursor += block.text.length + 1;
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

  return { html: htmlParts.join("\n"), pages, toc, charCount: charCursor };
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

async function convertPdf(buffer: ArrayBuffer): Promise<ConversionResult> {
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

  const { html, pages, toc, charCount } = buildPagedHtml(pageBlocks);
  return {
    html: sanitizeHtml(html, SANITIZE_OPTIONS),
    pages,
    toc,
    pageCount: doc.numPages,
    hasRealPages: true,
    charCount,
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

/** Walk a spine document collecting blocks (paragraphs + headings from h1-h6)
 *  and any page-break marks. */
function walkEpubDoc(
  body: XmlElement,
  blocks: Block[],
  marks: EpubMark[]
): void {
  const visit = (node: XmlNode) => {
    if (node.nodeType !== 1) return; // elements only
    const el = node as XmlElement;
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

/**
 * Read an EPUB's table of contents (the EPUB3 nav doc, or the EPUB2 NCX) into a
 * per-spine-file title map. This is the authoritative source of chapter titles —
 * far more reliable than guessing headings from publisher-specific markup.
 */
async function readEpubToc(
  zip: JSZip,
  parser: DOMParser,
  opf: XmlDocument,
  opfDir: string,
  readText: (path: string) => Promise<string | null>
): Promise<Map<string, string>> {
  const byFile = new Map<string, string>();
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
        const file = resolvePath(navDir, href.split("#")[0]);
        if (!byFile.has(file)) byFile.set(file, title);
      }
    }
  }

  // EPUB2 fallback: the NCX navMap (<navPoint><navLabel><text>…</text><content src=…/>).
  if (byFile.size === 0 && ncxHref) {
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
        const file = resolvePath(ncxDir, src.split("#")[0]);
        if (!byFile.has(file)) byFile.set(file, label);
      }
    }
  }

  return byFile;
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

  // Spine: ordered list of content documents.
  const spineRefs = opf.getElementsByTagName("itemref");
  const spinePaths: string[] = [];
  for (let i = 0; i < spineRefs.length; i++) {
    const idref = spineRefs[i].getAttribute("idref");
    const path = idref ? manifest.get(idref) : null;
    if (path) spinePaths.push(path);
  }
  if (spinePaths.length === 0) throw new ConversionError("This EPUB has no readable content.");

  // The authoritative chapter titles, keyed by spine file. Used to give each
  // file a styled heading and to suppress its repeated in-file title lines.
  const tocByFile = await readEpubToc(
    zip,
    parser,
    opf as unknown as XmlDocument,
    opfDir,
    readText
  );

  const blocks: Block[] = [];
  const marks: EpubMark[] = [];
  for (const path of spinePaths) {
    const xml = await readText(path);
    if (!xml) continue;
    const dom = parser.parseFromString(xml, "text/html");
    const body = dom.getElementsByTagName("body")[0];
    if (!body) continue;

    const fileBlocks: Block[] = [];
    const fileMarks: EpubMark[] = [];
    walkEpubDoc(body, fileBlocks, fileMarks);

    const navTitle = tocByFile.get(path);
    let kept = navTitle ? stripLeadingTitle(fileBlocks, navTitle) : fileBlocks;
    // If walkEpubDoc already produced its own leading heading (semantic h-tags),
    // don't add a duplicate from the nav.
    const alreadyHeaded = kept[0]?.kind === "heading";

    // Skip empty front matter (e.g. an image-only cover) so it doesn't litter
    // the TOC with contentless sections.
    if (!kept.some((b) => b.kind === "para")) continue;

    const dropped = fileBlocks.length - kept.length;
    if (navTitle && !alreadyHeaded) {
      kept = [{ kind: "heading", text: navTitle, level: tocLevel(navTitle) }, ...kept];
    }
    const headingAdded = navTitle && !alreadyHeaded ? 1 : 0;

    const base = blocks.length;
    for (const b of kept) blocks.push(b);
    for (const m of fileMarks) {
      const adj = Math.max(0, m.beforeBlock - dropped) + headingAdded;
      marks.push({ pageNumber: m.pageNumber, beforeBlock: base + adj });
    }
  }

  if (blocks.length === 0) {
    throw new ConversionError("We couldn't extract any text from this EPUB.");
  }

  // Build HTML, inserting page anchors at their block boundaries.
  const marksByBlock = new Map<number, number>();
  for (const m of marks) {
    if (!marksByBlock.has(m.beforeBlock)) marksByBlock.set(m.beforeBlock, m.pageNumber);
  }
  const hasRealPages = marksByBlock.size > 0;

  const htmlParts: string[] = [];
  const pages: ConvertedPage[] = [];
  const toc: TocEntry[] = [];
  let charCursor = 0;
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

  for (let i = 0; i < blocks.length; i++) {
    const pageNum = marksByBlock.get(i);
    if (pageNum != null) {
      closePage();
      htmlParts.push(pageAnchor(pageNum));
      currentPage = pageNum;
      openPage = { pageNumber: pageNum, charStart: charCursor };
    }
    const block = blocks[i];
    if (block.kind === "heading") {
      const anchorId = `sec-${++sectionSeq}`;
      const tag = block.level <= 1 ? "h1" : "h2";
      htmlParts.push(
        `<${tag} id="${anchorId}" class="reader-heading reader-h${block.level <= 1 ? 1 : 2}">${escapeHtml(block.text)}</${tag}>`
      );
      toc.push({
        title: block.text,
        anchorId,
        level: block.level <= 1 ? 1 : 2,
        page: hasRealPages ? currentPage : null,
      });
    } else {
      htmlParts.push(`<p>${escapeHtml(block.text)}</p>`);
    }
    charCursor += block.text.length + 1;
  }
  closePage();

  return {
    html: sanitizeHtml(htmlParts.join("\n"), SANITIZE_OPTIONS),
    pages: hasRealPages ? pages : [],
    toc,
    pageCount: hasRealPages ? pages.length : null,
    hasRealPages,
    charCount: charCursor,
  };
}

export async function convertBookFile(
  format: "pdf" | "epub",
  buffer: ArrayBuffer
): Promise<ConversionResult> {
  return format === "pdf" ? convertPdf(buffer) : convertEpub(buffer);
}
