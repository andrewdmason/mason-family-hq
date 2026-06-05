"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { triggerSync } from "@/app/(calendar)/calendar/actions";

/** Manually pull the latest from TeamSnap and ICS feeds. The same sync also runs
 * on load and every 15 minutes via cron; this is the "do it now" button. */
export function SyncButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [justSynced, setJustSynced] = useState(false);

  function sync() {
    setJustSynced(false);
    startTransition(async () => {
      await triggerSync().catch(() => {});
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
