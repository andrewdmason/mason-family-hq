"use client";

// Upload a clip's derived artifacts against a server-issued grant. The grant
// already created the clip row and decided every path; this just moves bytes.
// Artifacts live in the caller's memory until acked, so a failed upload can
// be retried without re-extraction (within the same tab).

import { createClient } from "@/lib/supabase/client";
import { SWING_BUCKET } from "@/lib/swing/bucket";
import type { ClipUploadGrant } from "@/app/(swing)/swing/actions";
import type { ClientStill, ClientSwingVideo } from "@/lib/swing/extraction-client";

export async function uploadClipArtifacts(
  grant: ClipUploadGrant,
  artifacts: { keypointsGzip: Blob; stills: ClientStill[]; video: ClientSwingVideo | null }
): Promise<void> {
  const storage = createClient().storage.from(SWING_BUCKET);

  const { error: kpError } = await storage.uploadToSignedUrl(
    grant.keypoints.path,
    grant.keypoints.token,
    artifacts.keypointsGzip,
    { contentType: "application/gzip" }
  );
  if (kpError) throw new Error(`Keypoints upload failed: ${kpError.message}`);

  if (grant.video && artifacts.video) {
    const { error } = await storage.uploadToSignedUrl(
      grant.video.path,
      grant.video.token,
      artifacts.video.blob,
      { contentType: artifacts.video.contentType }
    );
    if (error) throw new Error(`Swing video upload failed: ${error.message}`);
  }

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
