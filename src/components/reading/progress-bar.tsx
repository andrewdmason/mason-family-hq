import { cn } from "@/lib/utils";

/**
 * A thin progress bar for milestone/bonus progress. Fills with the accent colour
 * once reached. Shared by the reader dashboard header and the parent-admin list so
 * the two never drift. Pure markup — safe in both server and client components.
 */
export function ProgressBar({
  pct,
  reached,
  className,
}: {
  /** Fill percentage, 0–100. */
  pct: number;
  /** Reached the threshold — fills with the amber accent instead of foreground. */
  reached: boolean;
  className?: string;
}) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-all",
          reached ? "bg-amber-500" : "bg-foreground/70"
        )}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}
