"use client";

import { JournalNewButton } from "@/components/journal/journal-new-button";
import { NotificationBell } from "@/components/journal/notification-bell";
import { AppSwitcher } from "@/components/layout/app-switcher";
import type { JournalNotifications } from "@/lib/types";

// Header for the Family app — the shared family record. Its "New" button starts
// an entry aimed at the family (audience pre-set), and the notification bell
// lives here because new posts and comments are the relevant activity. The
// personal-journaling streak badge stays on the Journal header.
export function FamilyHeaderClient({
  notifications,
  isOwner,
}: {
  notifications: JournalNotifications;
  isOwner: boolean;
}) {
  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="relative mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
        <AppSwitcher isOwner={isOwner} />
        <div className="flex items-center gap-2">
          <JournalNewButton audience="family" />
          {notifications.count > 0 && (
            <NotificationBell notifications={notifications} />
          )}
        </div>
      </div>
    </header>
  );
}
