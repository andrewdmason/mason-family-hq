import Link from "next/link";
import { ChevronRight, Coins } from "lucide-react";

/**
 * The reader-home reward nudge: a lifetime bonus-pages counter that doubles as a
 * link into the Mason Bucks app. Reward milestones moved to Mason Bucks (as
 * prizes), so this no longer shows per-milestone progress — bonus pages are now
 * Mason Bucks (1:1). Renders nothing when no bonus has been banked.
 */
export function ReadingProgressHeader({
  bonusPagesTotal,
  memberEmail,
}: {
  bonusPagesTotal: number;
  memberEmail?: string | null;
}) {
  if (bonusPagesTotal <= 0) return null;

  const href = memberEmail
    ? `/bucks?member=${encodeURIComponent(memberEmail)}`
    : "/bucks";

  return (
    <Link
      href={href}
      className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-card/50 px-4 py-3.5 transition-colors hover:bg-accent/50"
    >
      <Coins className="h-5 w-5 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">
          <span className="text-lg font-semibold tabular-nums">
            {bonusPagesTotal.toLocaleString()}
          </span>{" "}
          bonus pages earned as Mason Bucks
        </p>
        <p className="text-xs text-muted-foreground">
          Spend them on prizes in Mason Bucks
        </p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
