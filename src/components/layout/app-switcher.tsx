"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  CalendarDays,
  CalendarRange,
  Check,
  ChevronDown,
  Dumbbell,
  GraduationCap,
  House,
  ListTodo,
  Music,
  NotebookPen,
  Settings,
  Users,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
    description: "Books & reading",
    icon: BookOpen,
  },
  {
    href: "/journal",
    label: "Journal",
    match: "/journal",
    description: "Your personal journal",
    icon: NotebookPen,
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
 * App identity + switcher for the family-wide apps. The header shows only the
 * current app's name; the dropdown is a "product switcher" — each app is a
 * substantial row with its icon and a one-line description. Settings sits at the
 * bottom, separated and compact, as a global "app" of its own.
 */
export function AppSwitcher({ isOwner = false }: { isOwner?: boolean }) {
  const pathname = usePathname();
  const apps = isOwner ? [...APPS, PRACTICE_APP] : APPS;
  // Settings is a matchable destination too, so the trigger reads "Settings"
  // while you're in it — even though it renders in the footer, not the list.
  const current =
    [...apps, SETTINGS].find((app) => isActive(pathname, app.match)) ?? apps[0];
  const onSettings = current.match === SETTINGS.match;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`${current.label} — switch app`}
            className="inline-flex h-14 items-center gap-1.5 font-serif text-lg tracking-tight text-foreground transition-colors hover:text-foreground/70"
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
  );
}
