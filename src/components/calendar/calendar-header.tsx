"use client";

import Link from "next/link";
import { Settings } from "lucide-react";
import { AppSwitcher } from "@/components/layout/app-switcher";

export function CalendarHeader() {
  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="relative mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
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
