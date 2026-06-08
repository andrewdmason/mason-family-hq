import Link from "next/link";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkoutsTab = "today" | "upcoming" | "prs" | "history" | "library";

/**
 * The shared title + tab bar across the Workouts section. "Today" is the default
 * landing view (today's workout, ready to log); "Upcoming" and "History" are
 * query params on the same route; Library is owner-only.
 */
export function WorkoutsHeader({
  active,
  isOwner,
}: {
  active: WorkoutsTab;
  isOwner: boolean;
}) {
  const tabs: { key: WorkoutsTab; label: string; href: string }[] = [
    { key: "today", label: "Today", href: "/workouts" },
    { key: "upcoming", label: "Upcoming", href: "/workouts?tab=upcoming" },
    { key: "prs", label: "PRs", href: "/workouts/prs" },
    { key: "history", label: "History", href: "/workouts?tab=completed" },
  ];
  if (isOwner) {
    tabs.push({ key: "library", label: "Library", href: "/workouts/movements" });
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">
          Workouts
        </h1>
        <Link
          href="/workouts/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" />
          Log a workout
        </Link>
      </div>
      <div className="mb-5 flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              t.key === active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </>
  );
}
