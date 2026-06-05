"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const TABS = [
  {
    label: "User",
    href: "/settings/user",
    description:
      "Your life context — Present (who you are now) and Past (your life story).",
  },
  {
    label: "Interviewer",
    href: "/settings/interviewer",
    description:
      "The interviewer's voice and how it asks — its personality, not which topics it picks. Edit it here directly.",
  },
  {
    label: "Questions",
    href: "/settings/questions",
    description:
      "The kinds of questions you get each morning, how often each shows up, and how many you're offered.",
  },
  {
    label: "Calendars",
    href: "/settings/calendars",
    description:
      "Manage everyone's calendars — subscribe to ICS feeds, connect TeamSnap teams, and share phone subscribe links.",
    manageOnly: true,
  },
  {
    label: "Family",
    href: "/settings/family",
    description: "",
    ownerOnly: true,
  },
] as const;

export function SettingsNav({
  isOwner = false,
  canManage = false,
}: {
  isOwner?: boolean;
  canManage?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // When editing a member's settings, every tab carries the ?member= param so
  // switching tabs stays within that member's session. The Family tab is the
  // launcher for member mode, so it's hidden while a member is selected.
  const member = searchParams.get("member");
  const suffix = member ? `?member=${encodeURIComponent(member)}` : "";
  const tabs = TABS.filter((t) => {
    // Owner-only tabs (Family) need owner role and only outside member mode.
    if ("ownerOnly" in t && t.ownerOnly) return isOwner && !member;
    // Manage-only tabs (Calendars) are for owners and parents.
    if ("manageOnly" in t && t.manageOnly) return canManage;
    return true;
  });
  const active = tabs.find((t) => pathname.startsWith(t.href)) ?? tabs[0];

  return (
    <>
      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href + suffix}
            className={
              "relative px-3 py-2 font-serif text-sm transition-colors " +
              (tab.href === active.href
                ? "text-foreground after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:bg-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {tab.label}
          </Link>
        ))}
      </div>
      {active.description && (
        <p className="mt-3 font-serif text-xs italic text-muted-foreground">
          {active.description}
        </p>
      )}
    </>
  );
}
