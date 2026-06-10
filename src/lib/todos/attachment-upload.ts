import { createClient } from "@/lib/supabase/client";
import {
  attachTaskAttachment,
  createTaskAttachmentUploadUrls,
} from "@/app/(todos)/todos/actions";

const ATTACHMENTS_BUCKET = "todo-images";
const MAX_DISPLAY_EDGE = 2000;

/** Whether a dropped/pasted file should get the image treatment (downscaled
 * display copy + thumbnail grid). Extension fallback because drag sources
 * sometimes hand over files with an empty MIME type. Everything else attaches
 * as a plain file (PDFs, docs, …). */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.includes(".")
    ? (file.name.split(".").pop() ?? "").toLowerCase()
    : "";
  return ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(ext);
}

/** Downscaled JPEG display copy; falls back to the original bytes when the
 * browser can't decode the format (e.g. HEIC). Mirrors journal photo-upload. */
async function makeDisplayBlob(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(
      1,
      MAX_DISPLAY_EDGE / Math.max(bitmap.width, bitmap.height)
    );
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas context");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    if (!blob) throw new Error("toBlob failed");
    return blob;
  } catch {
    return file;
  }
}

/**
 * Upload one attachment to a task. Images push an original + downscaled
 * display copy; other files push just the original. Returns the new row id.
 */
export async function uploadTaskAttachment(
  taskId: string,
  file: File
): Promise<string> {
  const kind = isImageFile(file) ? "image" : "file";
  const ext = file.name.includes(".")
    ? (file.name.split(".").pop() ?? "bin")
    : "bin";
  const attachmentId = crypto.randomUUID();
  const urls = await createTaskAttachmentUploadUrls(
    taskId,
    attachmentId,
    ext,
    kind
  );
  const supabase = createClient();

  const original = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .uploadToSignedUrl(urls.originalPath, urls.originalToken, file, {
      contentType: file.type || undefined,
    });
  if (original.error) throw original.error;

  if (kind === "image" && urls.displayPath && urls.displayToken) {
    const displayBlob = await makeDisplayBlob(file);
    const display = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .uploadToSignedUrl(urls.displayPath, urls.displayToken, displayBlob, {
        contentType: displayBlob.type || "image/jpeg",
      });
    if (display.error) throw display.error;
  }

  return attachTaskAttachment(taskId, {
    originalPath: urls.originalPath,
    displayPath: urls.displayPath,
    kind,
    fileName: file.name,
    mimeType: file.type || null,
  });
}
