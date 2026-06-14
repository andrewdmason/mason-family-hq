import sanitizeHtml from "sanitize-html";

/**
 * Sanitizer for web articles saved via the Chrome extension. Unlike the book
 * pipeline — which reflows to plain text and strips images/links — articles keep
 * their structure: images, links, lists, code, tables, blockquotes. The captured
 * HTML is untrusted (it comes from arbitrary pages, only loosely cleaned client-
 * side), so the server always re-sanitizes here before anything is stored.
 *
 * Scripts/styles and any tag not on the allowlist are dropped; links are forced
 * to open safely in a new tab. The result renders through the same reader as
 * books (see book-reader.tsx).
 */
export const ARTICLE_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "blockquote", "q", "cite",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "em", "i", "strong", "b", "u", "s", "del", "ins",
    "mark", "small", "sub", "sup", "abbr",
    "ul", "ol", "li", "dl", "dt", "dd",
    "a", "img", "figure", "figcaption", "picture", "source",
    "pre", "code", "kbd", "samp", "var",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "caption", "colgroup", "col",
    "span", "div",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel", "target"],
    img: ["src", "alt", "title", "width", "height", "srcset", "sizes", "loading"],
    source: ["src", "srcset", "sizes", "type", "media"],
    th: ["colspan", "rowspan", "scope"],
    td: ["colspan", "rowspan"],
    col: ["span"],
    colgroup: ["span"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  // Remove disallowed tags; script/style/etc. lose their text content too
  // (sanitize-html's nonTextTags default).
  disallowedTagsMode: "discard",
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer nofollow",
      target: "_blank",
    }),
  },
};

/** Clean untrusted article HTML for safe storage + rendering. */
export function sanitizeArticleHtml(dirty: string): string {
  return sanitizeHtml(dirty, ARTICLE_SANITIZE_OPTIONS);
}

/** Plain-text word count, used for the "N min read" estimate. */
export function countWords(html: string): number {
  // Insert whitespace at block boundaries so adjacent blocks don't merge into
  // one "word" once tags are stripped (e.g. two <li>s, paragraph breaks).
  const spaced = html
    .replace(
      /<\/(p|div|li|h[1-6]|blockquote|figcaption|tr|td|th|pre|dd|dt|ul|ol)>/gi,
      " $& "
    )
    .replace(/<br\s*\/?>/gi, " ");
  const text = sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} });
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}
