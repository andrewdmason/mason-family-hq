import { cn } from "@/lib/utils";

/** A single shimmering placeholder line, for widgets awaiting lazy AI content. */
export function SkeletonLine({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "h-4 animate-pulse rounded bg-foreground/10",
        className
      )}
    />
  );
}
