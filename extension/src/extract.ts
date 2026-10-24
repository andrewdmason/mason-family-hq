// The article extractor, shared by the Chrome extension (background.ts injects
// it into the tab) and the Reader iOS app's Share extension (ios-share.ts runs
// it in Safari's page, or in a page the extension loads for other apps).

export type ExtractedArticle = {
  url: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  leadImageUrl: string | null;
  content: string;
  length: number;
};

/**
 * Runs IN THE PAGE (serialized by executeScript). Must be self-contained — it
 * may only reference window/document/location and the globals vendor.js sets.
 */
export function extractArticle(): ExtractedArticle | null {
  const w = window as unknown as {
    __MasonReadability?: new (doc: Document) => {
      parse: () => {
        title?: string;
        byline?: string;
        siteName?: string;
        excerpt?: string;
        content?: string;
        length?: number;
      } | null;
    };
    __MasonDOMPurify?: { sanitize: (html: string) => string };
  };
  const Readability = w.__MasonReadability;
  const DOMPurify = w.__MasonDOMPurify;
  if (!Readability) return null;

  const clone = document.cloneNode(true) as Document;

  // Promote lazy-loaded images (data-src/data-srcset) to real src/srcset before
  // Readability runs, so it keeps them instead of discarding empty <img>s.
  for (const im of Array.from(clone.querySelectorAll("img"))) {
    if (!im.getAttribute("src")) {
      const ds =
        im.getAttribute("data-src") ||
        im.getAttribute("data-lazy-src") ||
        im.getAttribute("data-original");
      if (ds) im.setAttribute("src", ds);
    }
    if (!im.getAttribute("srcset")) {
      const dss = im.getAttribute("data-srcset");
      if (dss) im.setAttribute("srcset", dss);
    }
  }

  const parsed = new Readability(clone).parse();
  if (!parsed || !parsed.content) return null;

  const canonical = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]'
  )?.href;

  // Page metadata Readability drops: the social card image (almost always the
  // hero) and the standfirst/dek. These rebuild the article header in the reader.
  const meta = (key: string): string | null =>
    document
      .querySelector<HTMLMetaElement>(`meta[property="${key}"]`)
      ?.content ||
    document.querySelector<HTMLMetaElement>(`meta[name="${key}"]`)?.content ||
    null;
  const leadImageUrl = meta("og:image");
  const dek = meta("og:description") || meta("description");

  // Stamp intrinsic image dimensions from the live (already-loaded) page and
  // drop lazy-loading. With width/height present, the reader reserves each
  // image's space on first paint, so resuming a half-read article lands at the
  // saved position instantly instead of waiting for images to load.
  let contentHtml = parsed.content;
  try {
    const liveDims = new Map<string, [number, number]>();
    for (const im of Array.from(document.querySelectorAll("img"))) {
      const key = im.getAttribute("src");
      if (key && im.naturalWidth > 0 && im.naturalHeight > 0) {
        liveDims.set(key, [im.naturalWidth, im.naturalHeight]);
      }
    }
    const doc = new DOMParser().parseFromString(parsed.content, "text/html");
    for (const im of Array.from(doc.querySelectorAll("img"))) {
      im.removeAttribute("loading");
      if (!im.getAttribute("width") || !im.getAttribute("height")) {
        const dim = liveDims.get(im.getAttribute("src") || "");
        if (dim) {
          im.setAttribute("width", String(dim[0]));
          im.setAttribute("height", String(dim[1]));
        }
      }
    }
    contentHtml = doc.body.innerHTML;
  } catch {
    contentHtml = parsed.content;
  }

  const content = DOMPurify ? DOMPurify.sanitize(contentHtml) : contentHtml;

  return {
    url: canonical || location.href,
    title: parsed.title || document.title,
    byline: parsed.byline || null,
    siteName: parsed.siteName || null,
    // Prefer the dek (standfirst) over Readability's first-sentence excerpt.
    excerpt: dek || parsed.excerpt || null,
    leadImageUrl,
    content,
    length: parsed.length || 0,
  };
}
