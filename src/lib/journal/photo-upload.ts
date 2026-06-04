import { createClient } from "@/lib/supabase/client";
import {
  attachEntryPhoto,
  createPhotoUploadUrls,
} from "@/app/(journal)/journal/actions";
import {
  attachTimelinePhoto,
  createTimelinePhotoUploadUrls,
} from "@/lib/timeline/actions";
import type { JournalMediaType } from "@/lib/types";

const PHOTOS_BUCKET = "journal-photos";
const MAX_DISPLAY_EDGE = 2000;
// Mirrors the storage bucket's file_size_limit (see migration 00044).
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const VIDEO_EXTENSIONS = ["mov", "mp4", "m4v", "webm", "ogv"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"];

export function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/**
 * Classify a dropped/picked file as photo or video. Falls back to the file
 * extension because drag sources (notably macOS Photos) sometimes hand over
 * files with an empty or misleading MIME type.
 */
export function detectMediaType(file: File): JournalMediaType | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "photo";
  const ext = file.name.includes(".")
    ? (file.name.split(".").pop() ?? "").toLowerCase()
    : "";
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (IMAGE_EXTENSIONS.includes(ext)) return "photo";
  return null;
}

/**
 * Build a downscaled JPEG copy of an image for display. Falls back to the
 * original bytes when the browser can't decode the format to a canvas (e.g.
 * HEIC).
 */
async function makeImageDisplayBlob(file: File): Promise<Blob> {
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

// Edge length for member profile photos — a small square avatar.
const AVATAR_EDGE = 512;

/**
 * Build a square, center-cropped JPEG avatar from an image file. Falls back to
 * the original bytes when the browser can't decode the format to a canvas (e.g.
 * HEIC). Used for family-member profile photos.
 */
export async function makeSquareAvatarBlob(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = Math.round((bitmap.width - side) / 2);
    const sy = Math.round((bitmap.height - side) / 2);
    const edge = Math.min(AVATAR_EDGE, side);
    const canvas = document.createElement("canvas");
    canvas.width = edge;
    canvas.height = edge;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas context");
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, edge, edge);
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
 * Extract a poster frame from a video as a downscaled JPEG. Used as the
 * display copy so galleries and history covers can render a thumbnail.
 */
async function makeVideoPosterBlob(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  try {
    video.src = url;
    video.muted = true;
    video.preload = "auto";
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Couldn't read that video file."));
    });
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("Couldn't read that video file."));
      // Seek slightly in to avoid a black opening frame.
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
    });
    const scale = Math.min(
      1,
      MAX_DISPLAY_EDGE / Math.max(video.videoWidth, video.videoHeight)
    );
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't read that video file.");
    ctx.drawImage(video, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    if (!blob) throw new Error("Couldn't read that video file.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

type SignedUploadUrls = {
  originalPath: string;
  originalToken: string;
  displayPath: string;
  displayToken: string;
};

type UploadedMedia = {
  id: string;
  displayPath: string;
  originalPath: string;
  mediaType: JournalMediaType;
};

/**
 * Shared upload core: classify the file, sign upload URLs via `getUrls`, push
 * the original plus a downscaled display copy (a poster frame for video) to
 * storage, then record the DB row via `attach`. The two public wrappers below
 * differ only in where the photo is recorded (a journal entry vs. a timeline
 * event).
 */
async function uploadMediaWith(
  file: File,
  getUrls: (photoId: string, ext: string) => Promise<SignedUploadUrls>,
  attach: (
    originalPath: string,
    displayPath: string,
    mediaType: JournalMediaType
  ) => Promise<string>
): Promise<UploadedMedia> {
  const mediaType = detectMediaType(file) ?? "photo";
  const isVideo = mediaType === "video";
  const ext = file.name.split(".").pop() ?? (isVideo ? "mp4" : "jpg");
  const photoId = crypto.randomUUID();
  const urls = await getUrls(photoId, ext);
  const displayBlob = isVideo
    ? await makeVideoPosterBlob(file)
    : await makeImageDisplayBlob(file);
  const supabase = createClient();

  const original = await supabase.storage
    .from(PHOTOS_BUCKET)
    .uploadToSignedUrl(urls.originalPath, urls.originalToken, file, {
      contentType: file.type || undefined,
    });
  if (original.error) throw original.error;

  const display = await supabase.storage
    .from(PHOTOS_BUCKET)
    .uploadToSignedUrl(urls.displayPath, urls.displayToken, displayBlob, {
      contentType: displayBlob.type || "image/jpeg",
    });
  if (display.error) throw display.error;

  const id = await attach(urls.originalPath, urls.displayPath, mediaType);
  return {
    id,
    displayPath: urls.displayPath,
    originalPath: urls.originalPath,
    mediaType,
  };
}

/**
 * Upload one photo or video to a journal entry. Returns the new id, the stored
 * paths, and the detected media type.
 */
export function uploadJournalMedia(
  entryId: string,
  file: File
): Promise<UploadedMedia> {
  return uploadMediaWith(
    file,
    (photoId, ext) => createPhotoUploadUrls(entryId, photoId, ext),
    (originalPath, displayPath, mediaType) =>
      attachEntryPhoto(entryId, originalPath, displayPath, mediaType)
  );
}

/**
 * Upload one photo or video pinned directly to a timeline event (no journal
 * post). Returns the new id, the stored paths, and the detected media type.
 */
export function uploadTimelineMedia(
  timelineEntryId: string,
  file: File
): Promise<UploadedMedia> {
  return uploadMediaWith(
    file,
    (photoId, ext) => createTimelinePhotoUploadUrls(timelineEntryId, photoId, ext),
    (originalPath, displayPath, mediaType) =>
      attachTimelinePhoto(timelineEntryId, originalPath, displayPath, mediaType)
  );
}
