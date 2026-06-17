/**
 * The block model shared by the journal authoring editor and the published post
 * renderer. A post body is stored as markdown-ish lines; both the contentEditable
 * (seeding / paste) and `PostBody` parse it through here so what you write, paste,
 * and read all agree.
 */
export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

// Lenient on leading whitespace and bullet glyph so pasted rich text (which often
// arrives as "  • item" or "- item") is recognized, not just our canonical "* ".
const BULLET = /^\s*[-*+•·]\s+(.*)$/;
const HEADING = /^\s*(#{1,3})\s+(.*)$/;

export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let list: { type: "list"; items: string[] } | null = null;
  for (const line of content.split("\n")) {
    const bullet = BULLET.exec(line);
    if (bullet) {
      if (!list) {
        list = { type: "list", items: [] };
        blocks.push(list);
      }
      list.items.push(bullet[1]);
      continue;
    }
    list = null;
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
      });
    } else if (line.trim() === "") {
      continue;
    } else {
      blocks.push({ type: "paragraph", text: line });
    }
  }
  return blocks;
}
