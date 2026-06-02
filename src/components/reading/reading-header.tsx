"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { AppSwitcher } from "@/components/layout/app-switcher";

export function ReadingHeader() {
  const pathname = usePathname();
  // The reader is a full-screen, distraction-free experience — hide all global
  // chrome there. The book's own (hover-revealed) header is the only way out.
  if (/^\/reader\/[^/]+\/read\/?$/.test(pathname ?? "")) return null;

  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="relative mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
        <AppSwitcher />
        <Link
          href="/settings"
          aria-label="Settings"
          title="Settings"
          className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
        >
          <Settings className="h-5 w-5" />
        </Link>
      </div>
    </header>
  );
}
