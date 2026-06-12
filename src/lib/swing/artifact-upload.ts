"use client";

// Upload a clip's derived artifacts against a server-issued grant. The grant
// already created the clip row and decided every path; this just moves bytes.
// Artifacts live in the caller's memory until acked, so a failed upload can
// be retried without re-extraction (within the same tab).

import { createClient } from "@/lib/supabase/client";
import { SWING_BUCKET } from "@/lib/swing/bucket";
import type { ClipUploadGrant } from "@/app/(swing)/swing/actions";
import type { ClientStill } from "@/lib/swing/extraction-client";

export async function uploadClipArtifacts(
  grant: ClipUploadGrant,
  artifacts: { keypointsGzip: Blob; stills: ClientStill[] }
): Promise<void> {
  const storage = createClient().storage.from(SWING_BUCKET);

  const { error: kpError } = await storage.uploadToSignedUrl(
    grant.keypoints.path,
    grant.keypoints.token,
    artifacts.keypointsGzip,
    { contentType: "application/gzip" }
  );
  if (kpError) throw new Error(`Keypoints upload failed: ${kpError.message}`);

  for (const grantStill of grant.stills) {
    const still = artifacts.stills.find((s) => s.phase === grantStill.phase);
    if (!still) continue;
    const { error } = await storage.uploadToSignedUrl(
      grantStill.path,
      grantStill.token,
      still.blob,
      { contentType: still.contentType }
    );
    if (error) throw new Error(`Still upload failed (${still.phase}): ${error.message}`);
  }
}
