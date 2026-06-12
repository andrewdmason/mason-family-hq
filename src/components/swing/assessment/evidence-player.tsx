"use client";

// Evidence media: the annotated slow-motion swing video when one exists,
// frozen on the evidence frame (the coach sees the exact moment the tell
// references, then presses play for the before/after movement). Falls back
// to the annotated still when this clip has no video.

import { useRef } from "react";

export function EvidencePlayer({
  videoUrl,
  posterUrl,
  offsetSec,
  alt,
}: {
  videoUrl: string;
  posterUrl: string | null;
  /** Seconds into the video where the evidence frame sits. */
  offsetSec: number;
  alt: string;
}) {
  const seeked = useRef(false);
  return (
    <video
      src={videoUrl}
      poster={posterUrl ?? undefined}
      controls
      playsInline
      muted
      preload="metadata"
      aria-label={alt}
      className="w-full rounded-lg border bg-muted"
      onLoadedMetadata={(e) => {
        // Freeze on the evidence frame: seek once on load, never re-seek
        // after the coach starts scrubbing around.
        if (seeked.current) return;
        seeked.current = true;
        const video = e.currentTarget;
        video.currentTime = Math.max(
          0,
          Math.min(offsetSec, Math.max(video.duration - 0.05, 0))
        );
      }}
    />
  );
}
