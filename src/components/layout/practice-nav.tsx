"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import {
  AppHeaderContent,
  AppNavContent,
} from "@/components/layout/app-header";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Practice Log", href: "/practice" },
  { label: "Lessons", href: "/practice/lessons" },
  { label: "Repertoire", href: "/practice/repertoire" },
  { label: "Reports", href: "/practice/reports" },
  { label: "Recordings", href: "/practice/recordings" },
  { label: "Listen", href: "/practice/session" },
];

function isActive(pathname: string, href: string) {
  if (href === "/practice") return pathname === "/practice";
  return pathname.startsWith(href);
}

/**
 * Practice's page tabs, published into the shared global header. On sm+ they're
 * a row of underline tabs sitting just right of the app switcher (the header
 * slot, see AppHeaderContent); on phones they fold into the hamburger sheet's
 * app-nav section (AppNavContent), the same place the calendar parks its view
 * picker. Renders null itself — both bodies live in the global chrome.
 */
export function PracticeNav() {
  const pathname = usePathname();

  return (
    <>
      <AppHeaderContent>
        <nav className="hidden h-14 items-center gap-6 pl-4 sm:flex">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex h-14 items-center text-sm font-medium transition-colors hover:text-foreground",
                  active ? "text-foreground" : "text-muted-foreground",
                  active &&
                    "after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:bg-primary"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </AppHeaderContent>

      <AppNavContent>
        <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Practice
        </div>
        <div className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-2 py-2 text-sm",
                  active
                    ? "bg-accent/60 text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {item.label}
                {active && (
                  <Check className="ml-auto size-4 shrink-0 text-primary" />
                )}
              </Link>
            );
          })}
        </div>
      </AppNavContent>
    </>
  );
}
