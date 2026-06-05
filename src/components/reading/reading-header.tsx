"use client";

import { usePathname } from "next/navigation";
import { AppSwitcher } from "@/components/layout/app-switcher";

export function ReadingHeader({ isOwner = false }: { isOwner?: boolean }) {
  const pathname = usePathname();
  // The reader is a full-screen, distraction-free experience — hide all global
  // chrome there. The book's own (hover-revealed) header is the only way out.
  if (/^\/reader\/[^/]+\/read\/?$/.test(pathname ?? "")) return null;

  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="relative mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
        <AppSwitcher isOwner={isOwner} />
      </div>
    </header>
  );
}
