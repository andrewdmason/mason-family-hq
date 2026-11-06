"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connectCanvas, syncCanvasNow } from "@/app/(tuttles)/tuttles/actions";
import type { CanvasStatus } from "@/lib/canvas/connections";
import { cn } from "@/lib/utils";

const DAY = 864e5;
/** Matches the reminder email's lead time (src/lib/canvas/reminders.ts). */
const WARN = 5 * DAY;

/**
 * Each kid's Canvas on the parents' Tuttles page: whether Tuttles can read it,
 * when the key runs out, and the box to paste a new one. The school caps keys
 * at 30 days, so this is where the monthly renewal happens.
 */
export function CanvasConnections({
  statuses,
  canvasUrl,
  now,
}: {
  statuses: CanvasStatus[];
  canvasUrl: string;
  /** The server's clock at render, so server and browser agree on "expired". */
  now: number;
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-2 px-1 font-serif text-lg text-foreground">Canvas</h2>
      <ul className="divide-y divide-foreground/8 overflow-hidden rounded-xl border border-foreground/10 bg-card">
        {statuses.map((s) => (
          <li key={s.studentId}>
            <KidCanvas status={s} canvasUrl={canvasUrl} now={now} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function KidCanvas({ status: s, canvasUrl, now }: { status: CanvasStatus; canvasUrl: string; now: number }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const expires = s.expiresAt ? Date.parse(s.expiresAt) : null;
  const expired = expires != null && expires <= now;
  const expiringSoon = expires != null && !expired && expires - now <= WARN;

  const line = !s.connected
    ? "Not connected"
    : expired
      ? "Key expired: Tuttles can't see new coursework until it gets a new one."
      : [
          `${s.courses} classes, ${s.assignments} assignments`,
          s.lastSyncedAt ? `synced ${ago(s.lastSyncedAt, now)}` : "not synced yet",
          expires ? `key ${expiringSoon ? "expires" : "good until"} ${dateLabel(expires)}` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  function sync() {
    setNote(null);
    start(async () => {
      const res = await syncCanvasNow(s.studentId);
      setNote(res.ok ? `Synced ${res.assignments} assignments.` : res.error ?? "Sync failed.");
    });
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            !s.connected ? "bg-foreground/15" : expired || s.lastError ? "bg-[#d7261e]" : expiringSoon ? "bg-amber-500" : "bg-emerald-600"
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[0.95rem] text-foreground">{s.name}</p>
          <p className={cn("text-xs", expired ? "text-[#d7261e]" : "text-muted-foreground")}>{line}</p>
          {s.lastError && !expired && <p className="text-xs text-[#d7261e]">Last sync failed: {s.lastError}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          {s.connected && !expired && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={sync}>
              {pending ? "Syncing…" : "Sync now"}
            </Button>
          )}
          <Button
            size="sm"
            variant={expired || expiringSoon || !s.connected ? "default" : "outline"}
            onClick={() => setOpen((o) => !o)}
          >
            {s.connected ? "New key" : "Connect"}
          </Button>
        </div>
      </div>
      {note && <p className="mt-2 pl-5 text-xs text-muted-foreground">{note}</p>}
      {open && <KeyForm status={s} canvasUrl={canvasUrl} onDone={(msg) => { setOpen(false); setNote(msg); }} />}
    </div>
  );
}

function KeyForm({
  status: s,
  canvasUrl,
  onDone,
}: {
  status: CanvasStatus;
  canvasUrl: string;
  onDone: (message: string) => void;
}) {
  const [token, setToken] = useState("");
  // The school's maximum, which is what the steps say to pick.
  const [expiresOn, setExpiresOn] = useState(() => new Date(Date.now() + 30 * DAY).toLocaleDateString("en-CA"));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const res = await connectCanvas(s.studentId, token, expiresOn);
      if (res.ok) onDone(`Connected. Synced ${res.assignments} assignments.`);
      else setError(res.error ?? "Couldn't connect.");
    });
  }

  return (
    <div className="mt-3 ml-5 rounded-lg border border-dashed bg-muted/30 p-3 text-sm">
      <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
        <li>
          Signed in to Canvas as {s.name}, open{" "}
          <a href={`${canvasUrl}/profile/settings`} target="_blank" rel="noreferrer" className="underline">
            Account › Settings
          </a>{" "}
          and click <span className="font-medium text-foreground">+ New Access Token</span>.
        </li>
        <li>Name it Tuttles, pick the latest expiry it allows (30 days), and copy the key.</li>
        <li>Paste it here. It stays on the server; the phones never see it.</li>
      </ol>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-xs text-muted-foreground">Key</span>
          <Input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="12345~…"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs text-muted-foreground">Expires</span>
          <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} className="w-40" />
        </label>
        <Button size="sm" disabled={pending || !token.trim()} onClick={submit}>
          {pending ? "Connecting…" : "Connect"}
        </Button>
      </div>
      {pending && <p className="mt-2 text-xs text-muted-foreground">Checking the key and pulling coursework (about 20 seconds)…</p>}
      {error && <p className="mt-2 text-xs text-[#d7261e]">{error}</p>}
    </div>
  );
}

function ago(iso: string, now: number): string {
  const mins = Math.round((now - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function dateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
