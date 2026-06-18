"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { PRACTICE_AUTOLOG_ENABLED } from "@/lib/practice/flags";

const navItems = [
  { label: "Practice Log", href: "/practice" },
  { label: "Lessons", href: "/practice/lessons" },
  { label: "Repertoire", href: "/practice/repertoire" },
  { label: "Reports", href: "/practice/reports" },
  { label: "Recordings", href: "/practice/recordings" },
  ...(PRACTICE_AUTOLOG_ENABLED
    ? [{ label: "Listen", href: "/practice/session" }]
    : []),
];

function NavLink({
  href,
  label,
  active,
  onClick,
  variant = "default",
}: {
  href: string;
  label: string;
  active: boolean;
  onClick?: () => void;
  variant?: "default" | "tab";
}) {
  if (variant === "tab") {
    return (
      <Link
        href={href}
        onClick={onClick}
        className={cn(
          "relative flex h-14 items-center text-sm font-medium transition-colors hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
          active &&
            "after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:bg-primary"
        )}
      >
        {label}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "text-sm font-medium transition-colors hover:text-foreground",
        active ? "text-foreground" : "text-muted-foreground"
      )}
    >
      {label}
    </Link>
  );
}

export function Header() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/practice") return pathname === "/practice";
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:px-6">
        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6 h-14">
          {navItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              active={isActive(item.href)}
              variant="tab"
            />
          ))}
        </nav>

        {/* Mobile nav */}
        <Sheet>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon" className="ml-auto md:hidden" />
            }
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle menu</span>
          </SheetTrigger>
          <SheetContent side="right" className="w-64">
            <SheetTitle className="font-semibold">Navigation</SheetTitle>
            <nav className="mt-6 flex flex-col gap-4">
              {navItems.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  active={isActive(item.href)}
                />
              ))}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
