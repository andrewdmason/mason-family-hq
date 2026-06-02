"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Book cover. Covers come from Open Library and may be missing, so it falls back
 * to a neutral placeholder if the image fails to load. "sm" is the row thumbnail;
 * "lg" fills its container at a 2:3 book ratio for the cover-tile grid.
 */
export function BookCover({
  url,
  title,
  size = "sm",
}: {
  url: string | null;
  title: string;
  size?: "sm" | "lg";
}) {
  const [broken, setBroken] = useState(false);
  const showImage = url && !broken;

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded bg-muted",
        size === "sm" ? "h-16 w-11" : "aspect-[2/3] w-full"
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Cover of ${title}`}
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <BookOpen
          className={cn(
            "text-muted-foreground",
            size === "sm" ? "h-4 w-4" : "h-7 w-7"
          )}
          aria-hidden
        />
      )}
    </div>
  );
}
