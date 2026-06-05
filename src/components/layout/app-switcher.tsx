"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const APPS = [
  { href: "/family", label: "Family", match: "/family" },
  { href: "/reader", label: "Reader", match: "/reader" },
  { href: "/journal", label: "Journal", match: "/journal" },
  { href: "/timeline", label: "Timeline", match: "/timeline" },
  { href: "/calendar", label: "Calendar", match: "/calendar" },
] as const;

/**
 * Top-level nav bar for the family-wide apps. Each label is a link; the one
 * whose path is active is highlighted and underlined. Doubles as each app's
 * identity in the header, so the header doesn't repeat the app name as a title.
 */
export function AppSwitcher() {
  const pathname = usePathname();
  return (
    <nav aria-label="Apps" className="flex h-14 items-center gap-5">
      {APPS.map(({ href, label, match }) => {
        const active = pathname === match || pathname.startsWith(`${match}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-14 items-center font-serif text-lg tracking-tight transition-colors hover:text-foreground",
              active ? "text-foreground" : "text-muted-foreground",
              active &&
                "after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:bg-primary"
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
