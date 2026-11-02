import "server-only";
import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";

/**
 * An EPUB's own title and author, from its package document (the OPF that
 * META-INF/container.xml points at). For a book added from a file alone (the
 * iOS Share menu), where there was no title typed or looked up. Nulls when
 * the file doesn't say.
 */
export async function epubMetadata(
  buffer: ArrayBuffer
): Promise<{ title: string | null; author: string | null }> {
  const none = { title: null, author: null };
  try {
    const zip = await JSZip.loadAsync(buffer);
    const container = await zip.file("META-INF/container.xml")?.async("string");
    if (!container) return none;
    const containerDoc = new DOMParser().parseFromString(container, "text/xml");
    const rootfile = containerDoc.getElementsByTagName("rootfile")[0];
    const opfPath = rootfile?.getAttribute("full-path");
    if (!opfPath) return none;
    const opf = await zip.file(opfPath)?.async("string");
    if (!opf) return none;
    const doc = new DOMParser().parseFromString(opf, "text/xml");
    const text = (tag: string) => {
      const el =
        doc.getElementsByTagName(`dc:${tag}`)[0] ?? doc.getElementsByTagName(tag)[0];
      const value = el?.textContent?.replace(/\s+/g, " ").trim();
      return value || null;
    };
    return { title: text("title"), author: text("creator") };
  } catch {
    return none;
  }
}
