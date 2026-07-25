import { createClient } from "@/lib/supabase/client";
import { createMilestoneImageUploadUrl } from "@/app/(books)/books/quizzes/milestone-actions";
import { READING_MILESTONES_BUCKET } from "@/lib/reading/constants";

// Mirrors the storage bucket's file_size_limit (see migration 00149).
export const MAX_MILESTONE_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

/**
 * Upload a milestone's reward image: sign an upload URL, push the file to storage,
 * and return the stored path (the caller persists it via updateMilestone). Owner
 * action gates access; the path lives under the kid's folder.
 */
export async function uploadMilestoneImage(
  milestoneId: string,
  file: File,
  memberEmail?: string | null
): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!IMAGE_EXT.has(ext) || !file.type.startsWith("image/")) {
    throw new Error("Upload a JPEG, PNG, WebP, or GIF image.");
  }
  if (file.size > MAX_MILESTONE_IMAGE_BYTES) {
    throw new Error("That image is too large (10MB max).");
  }

  const { path, token } = await createMilestoneImageUploadUrl(
    milestoneId,
    ext,
    memberEmail
  );
  const supabase = createClient();
  const upload = await supabase.storage
    .from(READING_MILESTONES_BUCKET)
    .uploadToSignedUrl(path, token, file, {
      contentType: file.type,
      upsert: true,
    });
  if (upload.error) throw upload.error;
  return path;
}
