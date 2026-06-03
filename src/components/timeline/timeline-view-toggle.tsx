import Link from "next/link";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { view: "family", label: "Family", href: "/timeline" },
  { view: "mine", label: "My timeline", href: "/timeline?view=mine" },
] as const;

export function TimelineViewToggle({ view }: { view: "mine" | "family" }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border bg-background p-0.5">
      {OPTIONS.map((option) => (
        <Link
          key={option.view}
          href={option.href}
          aria-current={view === option.view ? "page" : undefined}
          className={cn(
            "inline-flex items-center justify-center rounded px-3 py-1 font-serif text-sm text-muted-foreground transition-colors hover:text-foreground",
            view === option.view && "bg-accent text-foreground"
          )}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}
