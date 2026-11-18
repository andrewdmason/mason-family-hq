import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResponseInputFile } from "openai/resources/responses/responses";

/**
 * A PDF sent with a chat message or given to a study set (a handout, a study
 * guide). The phone uploads it to the tuttles bucket beside the photos and
 * names it here; the tutor is handed the PDF itself, so it reads the text and
 * sees the pages.
 *
 * The phone turns away a PDF over 30 pages or 20 MB (and the bucket refuses
 * anything bigger), since every file in a chat goes to the model each turn.
 */
export type TutorFile = {
  /** In the tuttles bucket. */
  path: string;
  /** What it was called on the phone, ending in .pdf. */
  name: string;
  pages: number | null;
};

export const MAX_FILES = 4;

/**
 * The files a request names, each checked to be a PDF in `folder` (the
 * caller's own). Null if any of it is malformed.
 */
export function parseFiles(raw: unknown, folder: string): TutorFile[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_FILES) return null;
  const files: TutorFile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const { path, name, pages } = item as Record<string, unknown>;
    if (typeof path !== "string" || !path.startsWith(folder) || !path.endsWith(".pdf") || path.includes("..")) return null;
    const given = typeof name === "string" ? name.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120) : "";
    files.push({
      path,
      name: /\.pdf$/i.test(given) ? given : `${given || "Document"}.pdf`,
      pages: typeof pages === "number" && Number.isInteger(pages) && pages > 0 ? pages : null,
    });
  }
  return files;
}

/** Files as they were saved on a message, which older rows don't have. */
export function savedFiles(raw: unknown): TutorFile[] {
  return Array.isArray(raw) ? (raw as TutorFile[]).filter((f) => f && typeof f.path === "string") : [];
}

/**
 * A file as the model takes it: the PDF itself, as data rather than a link
 * (like the photos). Null if it isn't in the bucket.
 */
export async function fileInput(db: SupabaseClient, file: TutorFile): Promise<ResponseInputFile | null> {
  const { data } = await db.storage.from("tuttles").download(file.path);
  if (!data) return null;
  return {
    type: "input_file",
    filename: file.name,
    file_data: `data:application/pdf;base64,${Buffer.from(await data.arrayBuffer()).toString("base64")}`,
  };
}
