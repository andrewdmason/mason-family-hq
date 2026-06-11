"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { triggerFullSync } from "@/app/(calendar)/calendar/actions";

/** Manually pull the latest — including every player's RSVP — from TeamSnap, ICS,
 * and Google. The same full sync also runs every 15 minutes via cron (and on
 * calendar page mount via SyncTrigger); this is the "do it now" button, living
 * in Settings → Calendars. */
export function SyncButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [justSynced, setJustSynced] = useState(false);

  function sync() {
    setJustSynced(false);
    startTransition(async () => {
      await triggerFullSync().catch(() => {});
      router.refresh();
      setJustSynced(true);
    });
  }

  return (
    <Button size="sm" variant="outline" onClick={sync} disabled={pending}>
      <RefreshCw className={cn(pending && "animate-spin")} />
      {pending ? "Syncing…" : justSynced ? "Synced" : "Sync"}
    </Button>
  );
}
