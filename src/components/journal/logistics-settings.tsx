"use client";

import { useState } from "react";
import { Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  updateLogisticsSettings,
  type LogisticsSettingsView,
} from "@/app/(calendar)/calendar/actions";

// Drive-time logistics: the home address every drive time is measured from,
// and how many minutes early to arrive. Changes flow into existing drive
// blocks on the next sync tick (the cron re-hashes every assignment).
export function LogisticsSettings({
  settings,
}: {
  settings: LogisticsSettingsView | null;
}) {
  const [address, setAddress] = useState(settings?.homeAddress ?? "");
  const [buffer, setBuffer] = useState(String(settings?.bufferMinutes ?? 5));
  const [geocoded, setGeocoded] = useState(settings?.homeGeocoded ?? false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSave() {
    setPending(true);
    setMessage(null);
    try {
      const res = await updateLogisticsSettings({
        homeAddress: address,
        bufferMinutes: Number(buffer) || 5,
      });
      if ("error" in res) {
        setMessage(res.error);
      } else {
        setGeocoded(res.geocoded);
        setMessage(
          res.geocoded
            ? "Saved."
            : "Saved — the address couldn't be located yet; it'll retry on the next sync.",
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-8 space-y-3 border-t pt-6">
      <div className="flex items-center gap-2">
        <Car className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Drive times</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Drop-off and pick-up blocks are timed from home to the event&rsquo;s
        location, arriving a few minutes early.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="logi-address">Home address</Label>
        <Input
          id="logi-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="2909 Avalon Ave. Berkeley, CA 94705"
        />
        <p className="text-xs text-muted-foreground">
          {geocoded
            ? "Located ✓"
            : "Not located yet — drive times use an estimate until the address is found."}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="logi-buffer">Arrive early (minutes)</Label>
        <Input
          id="logi-buffer"
          type="number"
          min={0}
          max={60}
          value={buffer}
          onChange={(e) => setBuffer(e.target.value)}
          className="w-24"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={onSave} disabled={pending}>
          Save
        </Button>
        {message && (
          <p className="text-xs text-muted-foreground">{message}</p>
        )}
      </div>
    </div>
  );
}
