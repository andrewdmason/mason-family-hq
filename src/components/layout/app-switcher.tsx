"use client";

import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  Brain,
  CircleDot,
  Coins,
  Dumbbell,
  GraduationCap,
  House,
  Library,
  ListTodo,
  Menu,
  Music,
  NotebookPen,
  Settings,
  Users,
} from "lucide-react";
import { useAppNav } from "@/components/layout/app-header";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type App = {
  href: string;
  label: string;
  match: string;
  description: string;
  icon: LucideIcon;
};

const APPS: App[] = [
  {
    href: "/home",
    label: "Home",
    match: "/home",
    description: "Your daily dashboard",
    icon: House,
  },
  {
    href: "/family",
    label: "Family",
    match: "/family",
    description: "Shared journal feed",
    icon: Users,
  },
  {
    href: "/todos",
    label: "Todos",
    match: "/todos",
    description: "Family to-do lists",
    icon: ListTodo,
  },
  {
    href: "/reader",
    label: "Reader",
    match: "/reader",
    description: "Your books & saved articles",
    icon: BookOpen,
  },
  {
    href: "/books",
    label: "Bookshelf",
    match: "/books",
    description: "The kids' reading & quizzes",
    icon: Library,
  },
  {
    href: "/journal",
    label: "Journal",
    match: "/journal",
    description: "Your personal journal",
    icon: NotebookPen,
  },
  {
    href: "/bucks",
    label: "Mason Bucks",
    match: "/bucks",
    description: "Earn & spend family currency",
    icon: Coins,
  },
  {
    href: "/timeline",
    label: "Timeline",
    match: "/timeline",
    description: "Family life events",
    icon: CalendarDays,
  },
  {
    href: "/calendar",
    label: "Calendar",
    match: "/calendar",
    description: "Schedules & activities",
    icon: CalendarRange,
  },
  {
    href: "/assignments",
    label: "Assignments",
    match: "/assignments",
    description: "School homework & due dates",
    icon: GraduationCap,
  },
  {
    href: "/workouts",
    label: "Workouts",
    match: "/workouts",
    description: "Training log & progress",
    icon: Dumbbell,
  },
  {
    href: "/baseball",
    label: "Baseball",
    match: "/baseball",
    description: "Season-by-season stats",
    icon: CircleDot,
  },
  {
    href: "/games",
    label: "Games",
    match: "/games",
    description: "Family games to play together",
    icon: Brain,
  },
];

// The practice book is owner-only (gated in middleware), so it only joins the
// list for the owner. It runs its own header, so picking it leaves this switcher
// behind — there's no "current app" of practice to land back on here.
const PRACTICE_APP: App = {
  href: "/practice",
  label: "Practice Log",
  match: "/practice",
  description: "Track your practice",
  icon: Music,
};

// Settings is its own global "app" — settings for every app collect here as we
// add them. It lives in the footer rather than the app list, but it's still a
// real destination, so the switcher names it when you're in it.
const SETTINGS: App = {
  href: "/settings",
  label: "Settings",
  match: "/settings",
  description: "App & account settings",
  icon: Settings,
};

function isActive(pathname: string, match: string): boolean {
  return pathname === match || pathname.startsWith(`${match}/`);
}

/**
 * App identity + switcher for the family-wide apps. On sm+ the header shows
 * the current app's name and the dropdown is a "product switcher" — each app
 * is a substantial row with its icon and a one-line description, with Settings
 * at the bottom, separated and compact, as a global "app" of its own. On
 * phones it collapses to a hamburger opening a left nav sheet (MobileNav,
 * below) that holds the same app list plus the current app's own nav section.
 */
export function AppSwitcher({
  isOwner = false,
  isAdult = false,
}: {
  isOwner?: boolean;
  isAdult?: boolean;
}) {
  const pathname = usePathname();
  // Reader is the parents' e-reader (gated in middleware); the kids' reading
  // lives in Bookshelf, which everyone gets.
  const apps = [
    ...APPS.filter((app) => app.match !== "/reader" || isAdult),
    ...(isOwner ? [PRACTICE_APP] : []),
  ];
  // Settings is a matchable destination too, so the trigger reads "Settings"
  // while you're in it — even though it renders in the footer, not the list.
  const current =
    [...apps, SETTINGS].find((app) => isActive(pathname, app.match)) ?? apps[0];
  const onSettings = current.match === SETTINGS.match;

  return (
    <>
      <MobileNav apps={apps} current={current} onSettings={onSettings} />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`${current.label} — switch app`}
              className="hidden h-14 shrink-0 items-center gap-1.5 whitespace-nowrap font-serif text-lg tracking-tight text-foreground transition-colors hover:text-foreground/70 sm:inline-flex"
            />
          }
        >
          {current.label}
          <ChevronDown className="size-4 text-muted-foreground" />
        </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-1.5">
        {apps.map((app) => {
          const active = app.match === current.match;
          const Icon = app.icon;
          return (
            <DropdownMenuItem
              key={app.href}
              render={<Link href={app.href} />}
              className={cn(
                "gap-3 rounded-lg px-2 py-2",
                active && "bg-accent/60"
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground",
                  active && "border-primary/30 bg-primary/10 text-primary"
                )}
              >
                <Icon className="size-5" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-serif text-base leading-tight text-foreground">
                  {app.label}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {app.description}
                </span>
              </span>
              {active && (
                <Check className="ml-auto size-4 shrink-0 text-primary" />
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={<Link href={SETTINGS.href} />}
          className={cn(
            "gap-2.5 rounded-lg px-2 py-1.5 text-muted-foreground",
            onSettings && "bg-accent/60 text-foreground"
          )}
        >
          <Settings className="size-4" />
          <span className="text-sm">Settings</span>
          {onSettings && (
            <Check className="ml-auto size-4 shrink-0 text-primary" />
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * Phone navigation, Google Calendar style: a hamburger in the header's corner
 * opening a left sheet. Up top sits just the current app, as a disclosure —
 * tapping it expands the full app list in place — and below it, when the
 * current app published one (see AppNavContent), that app's own nav section,
 * e.g. the calendar's day/feed/week/month picker.
 */
function MobileNav({
  apps,
  current,
  onSettings,
}: {
  apps: App[];
  current: App;
  onSettings: boolean;
}) {
  const [open, setOpen] = useState(false);
  // The app list starts collapsed every time the sheet opens — the common
  // case is acting within the current app, not leaving it.
  const [appsExpanded, setAppsExpanded] = useState(false);
  const appNav = useAppNav();
  const CurrentIcon = current.icon;

  function setSheetOpen(next: boolean) {
    setOpen(next);
    if (!next) setAppsExpanded(false);
  }

  return (
    <Sheet open={open} onOpenChange={setSheetOpen}>
      <SheetTrigger
        aria-label="Menu"
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon-sm" }),
          "sm:hidden"
        )}
      >
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-80 gap-0 overflow-y-auto p-3"
      >
        <SheetTitle className="sr-only">Apps</SheetTitle>
        <button
          type="button"
          onClick={() => setAppsExpanded((x) => !x)}
          aria-expanded={appsExpanded}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
            <CurrentIcon className="size-5" />
          </span>
          <span className="font-serif text-base leading-tight text-foreground">
            {current.label}
          </span>
          <ChevronDown
            className={cn(
              "ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
              appsExpanded && "rotate-180"
            )}
          />
        </button>
        {appsExpanded && (
          <nav className="mt-0.5 flex flex-col gap-0.5">
            {apps.map((app) => {
              const active = app.match === current.match;
              const Icon = app.icon;
              return (
                <Link
                  key={app.href}
                  href={app.href}
                  onClick={() => setSheetOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-2 py-2",
                    active && "bg-accent/60"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground",
                      active && "border-primary/30 bg-primary/10 text-primary"
                    )}
                  >
                    <Icon className="size-5" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-serif text-base leading-tight text-foreground">
                      {app.label}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {app.description}
                    </span>
                  </span>
                  {active && (
                    <Check className="ml-auto size-4 shrink-0 text-primary" />
                  )}
                </Link>
              );
            })}
          </nav>
        )}
        {appNav != null && (
          <div
            className="mt-3 border-t pt-3"
            // The app's nav section is published from another tree, so it
            // can't close the sheet itself. Any tap on one of its buttons or
            // links (picking a view) is a final action — close for it.
            onClickCapture={(e) => {
              if ((e.target as HTMLElement).closest("button, a")) {
                setSheetOpen(false);
              }
            }}
          >
            {appNav}
          </div>
        )}
        <div className="mt-3 border-t pt-3">
          <Link
            href={SETTINGS.href}
            onClick={() => setSheetOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-muted-foreground",
              onSettings && "bg-accent/60 text-foreground"
            )}
          >
            <Settings className="size-4" />
            <span className="text-sm">Settings</span>
            {onSettings && (
              <Check className="ml-auto size-4 shrink-0 text-primary" />
            )}
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
