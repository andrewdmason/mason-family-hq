"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Coins, Flame, Pencil, Star, Trophy } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NotificationBell } from "@/components/journal/notification-bell";
import { AppHeaderSlot } from "@/components/layout/app-header";
import { AppSwitcher } from "@/components/layout/app-switcher";
import { cn } from "@/lib/utils";
import type { JournalStreakStats } from "@/components/layout/global-header";
import type { JournalNotifications } from "@/lib/types";

// The distraction-free reader (/reader/[id]/read) hides all global chrome —
// the book's own (hover-revealed) header is the only way out.
function hidesGlobalChrome(pathname: string | null) {
  return /^\/reader\/[^/]+\/read\/?$/.test(pathname ?? "");
}

/**
 * Marks the header on reader routes so e-ink mode can thin it out in CSS.
 *
 * An e-reader is a single-purpose device, and most of this header is the family
 * hub speaking: the app switcher, journal streak, Mason Bucks balance and
 * notification bell are all things you'd act on somewhere else, and on a 6"
 * greyscale panel they cost real estate to say nothing.
 *
 * What stays is AppHeaderSlot — "Add a book", the reader's own settings and
 * overflow. Those are the shelf's controls, not the hub's, and dropping the
 * whole bar to be rid of the badges takes them with it, which leaves you on a
 * device that can open books but not add one.
 *
 * Done as data attributes plus a stylesheet rule rather than a `return null`
 * because the e-ink flag lives in localStorage: React can't know it until
 * hydration, so branching on it here would render the badges and then yank
 * them, which is a repaint on exactly the display we're trying to spare. The
 * route is known during SSR, the class is set by EINK_BOOT_SCRIPT before first
 * paint, and the two meet in CSS with nothing to flash.
 */
function readerRouteProps(pathname: string | null) {
  return {
    "data-global-header": "",
    "data-reader-route": pathname?.startsWith("/reader") ? "" : undefined,
  };
}

/** Wrapper that e-ink mode hides on reader routes; transparent to layout. */
const HUB_ONLY = { "data-hub-only": "", className: "contents" } as const;

// The journaling streak only applies where journaling happens — the personal
// journal and the family feed — so the badge only renders on those apps
// instead of riding along in every header.
const STREAK_ROUTES = ["/journal", "/family"];

function showsStreak(pathname: string | null) {
  return STREAK_ROUTES.some(
    (route) => pathname === route || pathname?.startsWith(`${route}/`)
  );
}

// The calendar and practice apps publish their toolbars into the header's app
// slot (see AppHeaderContent in calendar-client / practice-nav), and their
// content runs wider than the journal-ish apps — widen the header there so the
// controls line up with the page below.
function headerWidthClass(pathname: string | null) {
  if (pathname?.startsWith("/practice")) return "max-w-7xl";
  if (pathname?.startsWith("/calendar")) return "max-w-5xl";
  return "max-w-3xl";
}

export function GlobalHeaderClient({
  streak,
  notifications,
  isOwner,
  isAdult,
  bucksBalance,
}: {
  streak: JournalStreakStats;
  notifications: JournalNotifications;
  isOwner: boolean;
  isAdult: boolean;
  bucksBalance: number | null;
}) {
  const pathname = usePathname();
  if (hidesGlobalChrome(pathname)) return null;

  return (
    <TooltipProvider>
      <header
        {...readerRouteProps(pathname)}
        className="sticky top-0 z-50 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"
      >
        <div
          className={cn(
            "relative mx-auto flex h-14 items-center gap-2 px-6",
            headerWidthClass(pathname)
          )}
        >
          <span {...HUB_ONLY}>
            <AppSwitcher isOwner={isOwner} isAdult={isAdult} />
          </span>
          <AppHeaderSlot />
          <div {...HUB_ONLY}>
            <div className="flex shrink-0 items-center gap-2">
              {showsStreak(pathname) && <JournalStreakBadge streak={streak} />}
              {bucksBalance !== null && <BucksBalanceBadge balance={bucksBalance} />}
              {notifications.count > 0 && (
                <NotificationBell notifications={notifications} />
              )}
            </div>
          </div>
        </div>
      </header>
    </TooltipProvider>
  );
}

/** A kid's current Mason Bucks balance, linking to the wallet. */
function BucksBalanceBadge({ balance }: { balance: number }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link href="/bucks" aria-label={`${balance} Mason Bucks`} />
        }
        className="inline-flex h-8 items-center gap-1.5 rounded-full bg-muted/70 px-2.5 text-sm font-semibold tabular-nums text-foreground transition-colors hover:bg-muted"
      >
        <Coins className="h-4 w-4 text-amber-500" />
        <span>{balance.toLocaleString()}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="rounded-lg px-3 py-2">
        <p className="font-medium">{balance.toLocaleString()} Mason Bucks</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Instant-paint stand-in shown while GlobalHeader's data streams in: the same
 * frame and app switcher (neither needs data), with a pulsing pill where the
 * streak badge will land so nothing shifts when it arrives. The switcher
 * assumes non-owner until the real header replaces it — the only difference is
 * an extra dropdown item, visible only if the menu is opened in that moment.
 * The exceptions are the role-gated routes: anyone seeing this shell on
 * /practice is an owner, and anyone seeing it on /reader is a parent, so we say
 * so up front — otherwise the switcher would name the fallback's first app
 * ("Home") for a frame before resolving to the real one.
 */
export function GlobalHeaderShell() {
  const pathname = usePathname();
  if (hidesGlobalChrome(pathname)) return null;

  const ownerByRoute = pathname?.startsWith("/practice") ?? false;
  const adultByRoute = ownerByRoute || (pathname?.startsWith("/reader") ?? false);

  return (
    <header
      {...readerRouteProps(pathname)}
      className="sticky top-0 z-50 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <div
        className={cn(
          "relative mx-auto flex h-14 items-center gap-2 px-6",
          headerWidthClass(pathname)
        )}
      >
        <span {...HUB_ONLY}>
          <AppSwitcher isOwner={ownerByRoute} isAdult={adultByRoute} />
        </span>
        <AppHeaderSlot />
        <div {...HUB_ONLY}>
          <div className="flex shrink-0 items-center gap-2">
            {showsStreak(pathname) && (
              <div
                aria-hidden
                className="h-8 w-14 animate-pulse rounded-full bg-muted/70"
              />
            )}
          </div>
        </div>
      </div>
    </header>
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
