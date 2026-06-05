"use client";

import { AppSwitcher } from "@/components/layout/app-switcher";

export function TimelineHeader({ isOwner = false }: { isOwner?: boolean }) {
  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="relative mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
        <AppSwitcher isOwner={isOwner} />
      </div>
    </header>
  );
}
