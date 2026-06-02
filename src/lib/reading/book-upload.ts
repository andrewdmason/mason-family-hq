import { createClient } from "@/lib/supabase/client";
import {
  attachBookFile,
  createBookUploadUrl,
} from "@/app/(reading)/reader/actions";
import { READING_BOOKS_BUCKET } from "@/lib/reading/constants";

// Mirrors the storage bucket's file_size_limit (see migration 00083).
export const MAX_BOOK_UPLOAD_BYTES = 100 * 1024 * 1024;

export type BookFormat = "pdf" | "epub";

const CONTENT_TYPE: Record<BookFormat, string> = {
  pdf: "application/pdf",
  epub: "application/epub+zip",
};

/**
 * Classify a picked file as a PDF or EPUB. Falls back to the file extension
 * because some sources hand over an empty or generic MIME type (e.g. EPUBs
 * arriving as application/octet-stream).
 */
export function detectBookFormat(file: File): BookFormat | null {
  const type = file.type.toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type === "application/epub+zip") return "epub";
  const ext = file.name.includes(".")
    ? (file.name.split(".").pop() ?? "").toLowerCase()
    : "";
  if (ext === "pdf") return "pdf";
  if (ext === "epub") return "epub";
  return null;
}

export function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/**
 * Ask the server to convert a freshly-uploaded source file into reflowable
 * HTML. Triggered from the browser so the route authenticates via the user's
 * session cookies; awaited so the caller can surface success/failure directly.
 */
export async function convertBook(
  bookId: string,
  memberEmail?: string | null
): Promise<void> {
  const res = await fetch("/reader/api/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookId, memberEmail: memberEmail ?? null }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Couldn't process this book.");
  }
}

/**
 * Upload a book file to a book and kick off conversion: sign an upload URL, push
 * the file to storage, record it, then run conversion. Resolves once the book is
 * processed (ready or failed — the detail page reflects the outcome).
 */
export async function uploadBookFile(
  bookId: string,
  file: File,
  memberEmail?: string | null
): Promise<void> {
  const format = detectBookFormat(file);
  if (!format) throw new Error("Upload a PDF or EPUB file.");
  if (file.size > MAX_BOOK_UPLOAD_BYTES) {
    throw new Error(
      `That file is ${formatBytes(file.size)}; the limit is ${formatBytes(
        MAX_BOOK_UPLOAD_BYTES
      )}.`
    );
  }

  const { path, token } = await createBookUploadUrl(bookId, format, memberEmail);
  const supabase = createClient();
  const upload = await supabase.storage
    .from(READING_BOOKS_BUCKET)
    .uploadToSignedUrl(path, token, file, {
      contentType: CONTENT_TYPE[format],
      upsert: true,
    });
  if (upload.error) throw upload.error;

  await attachBookFile(bookId, path, format, memberEmail);
  await convertBook(bookId, memberEmail);
}
