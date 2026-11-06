/**
 * Canvas rich text (assignment instructions, unit pages, announcements) as
 * plain text for the tutor: paragraphs and list items on their own lines,
 * headings kept, links and images dropped, entities decoded. Not a general
 * HTML parser; teachers' Canvas pages are simple enough for this.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|li|tr|ul|ol|table|blockquote)>/gi, "\n")
    .replace(/<(p|div|h[1-6]|tr|ul|ol|table|blockquote)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n")
    // List items wrapped in their own paragraphs read as one list.
    .replace(/\n\n(?=- )/g, "\n")
    .trim();
}

/** File ids an instruction links to (Canvas marks them data-api-endpoint=".../files/123"). */
export function linkedFileIds(html: string | null | undefined): number[] {
  if (!html) return [];
  const ids = new Set<number>();
  for (const m of html.matchAll(/\/files\/(\d+)/g)) ids.add(Number(m[1]));
  return [...ids];
}
