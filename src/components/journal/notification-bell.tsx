"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { JournalNotifications } from "@/lib/types";

/**
 * Header bell showing how many family posts are unread for the current user
 * (new posts + posts with new comments, one count per post). Clicking opens a
 * list of those posts; clicking an entry jumps to it, where the page view
 * dismisses its notification.
 */
export function NotificationBell({
  notifications,
}: {
  notifications: JournalNotifications;
}) {
  const [open, setOpen] = useState(false);
  const { count, items } = notifications;
  const label =
    count === 0
      ? "Notifications"
      : `${count} unread post${count === 1 ? "" : "s"}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        title={label}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums"
            aria-hidden
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-0 p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">
          Notifications
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            You&apos;re all caught up.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex flex-col gap-0.5 px-3 py-2 transition-colors hover:bg-muted"
                >
                  <span className="truncate text-sm font-medium text-foreground">
                    {item.title}
                  </span>
                  <span className={cn("text-xs text-muted-foreground")}>
                    {item.reason}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
