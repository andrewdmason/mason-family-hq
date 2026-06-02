"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";

/**
 * Book cover thumbnail. Covers come from Open Library and may be missing, so it
 * falls back to a neutral placeholder if the image fails to load.
 */
export function BookCover({
  url,
  title,
}: {
  url: string | null;
  title: string;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = url && !broken;

  return (
    <div className="flex h-16 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Cover of ${title}`}
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}
