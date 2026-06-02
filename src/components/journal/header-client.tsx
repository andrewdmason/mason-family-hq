"use client";

import Link from "next/link";
import { Flame, Pencil, Settings, Star, Trophy } from "lucide-react";
import { JournalNewButton } from "@/components/journal/journal-new-button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NotificationBell } from "@/components/journal/notification-bell";
import { AppSwitcher } from "@/components/layout/app-switcher";
import { cn } from "@/lib/utils";
import type { JournalStreakStats } from "@/components/journal/header";
import type { JournalNotifications } from "@/lib/types";

export function JournalHeaderClient({
  streak,
  notifications,
}: {
  streak: JournalStreakStats;
  notifications: JournalNotifications;
}) {
  return (
    <TooltipProvider>
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="relative mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <AppSwitcher />
          <div className="flex items-center gap-2">
            <JournalNewButton />
            <JournalStreakBadge streak={streak} />
            {notifications.count > 0 && (
              <NotificationBell notifications={notifications} />
            )}
            <Link
              href="/settings"
              aria-label="Settings"
              title="Settings"
              className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <Settings className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </header>
    </TooltipProvider>
  );
}

function JournalStreakBadge({ streak }: { streak: JournalStreakStats }) {
  const { icon: Icon, className } = getStreakIcon(streak.currentStreak);
  const message = getStreakMessage(streak);

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={`${streak.currentStreak} day posting streak`}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full bg-muted/70 px-2.5 text-sm font-semibold tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          streak.currentStreak > 0 && "text-foreground"
        )}
      >
        <Icon className={cn("h-4 w-4", className)} />
        <span>{streak.currentStreak}</span>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        className="block max-w-64 rounded-lg px-4 py-3 text-left"
      >
        <p className="font-medium">
          {streak.currentStreak} day
          {streak.currentStreak === 1 ? "" : "s"} in a row
        </p>
        <p className="mt-1 text-background/75">
          {streak.daysThisWeek}/7 days this week
        </p>
        <div className="mt-3 flex gap-1.5" aria-hidden>
          {streak.thisWeekDays.map((posted, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                posted ? "bg-background" : "bg-background/30"
              )}
            />
          ))}
        </div>
        <p className="mt-3 text-background/85">{message}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function getStreakIcon(streak: number) {
  if (streak >= 14) {
    return { icon: Trophy, className: "text-primary" };
  }
  if (streak >= 7) {
    return { icon: Star, className: "fill-primary text-primary" };
  }
  if (streak > 0) {
    return { icon: Flame, className: "fill-primary text-primary" };
  }
  return { icon: Pencil, className: "text-muted-foreground" };
}

function getStreakMessage(streak: JournalStreakStats): string {
  if (streak.currentStreak === 0) {
    return "Start with one small memory today.";
  }
  if (!streak.postedToday) {
    return "Post today to keep the streak alive.";
  }
  if (streak.currentStreak >= 14) {
    return "This is a real run. Future you has a lot to read.";
  }
  if (streak.currentStreak >= 7) {
    return "A full-week habit is forming. Keep the chain alive.";
  }
  return "You are building a rhythm. A few words still count.";
}

