import { createClient } from "@/lib/supabase/client";
import {
  attachTaskImage,
  createTaskImageUploadUrls,
} from "@/app/(todos)/todos/actions";

const IMAGES_BUCKET = "todo-images";
const MAX_DISPLAY_EDGE = 2000;

/** Images only — tasks don't take videos. Extension fallback because drag
 * sources sometimes hand over files with an empty MIME type. */
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
 * Upload one image to a task: original + downscaled display copy via signed
 * URLs, then the todo_task_images row. Returns the new image id.
 */
export async function uploadTaskImage(
  taskId: string,
  file: File
): Promise<string> {
  const ext = file.name.split(".").pop() ?? "jpg";
  const imageId = crypto.randomUUID();
  const urls = await createTaskImageUploadUrls(taskId, imageId, ext);
  const displayBlob = await makeDisplayBlob(file);
  const supabase = createClient();

  const original = await supabase.storage
    .from(IMAGES_BUCKET)
    .uploadToSignedUrl(urls.originalPath, urls.originalToken, file, {
      contentType: file.type || undefined,
    });
  if (original.error) throw original.error;

  const display = await supabase.storage
    .from(IMAGES_BUCKET)
    .uploadToSignedUrl(urls.displayPath, urls.displayToken, displayBlob, {
      contentType: displayBlob.type || "image/jpeg",
    });
  if (display.error) throw display.error;

  return attachTaskImage(taskId, urls.originalPath, urls.displayPath);
}
