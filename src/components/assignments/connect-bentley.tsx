"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  connectBentley,
  disconnectBentley,
} from "@/app/(assignments)/assignments/actions";
import type { BentleyConnectionStatus } from "@/lib/assignments/queries";

export function ConnectBentley({
  connection,
}: {
  connection: BentleyConnectionStatus | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [cookie, setCookie] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await connectBentley(cookie);
      if (!res.ok) {
        setError(res.error ?? "Could not connect.");
        return;
      }
      setCookie("");
      setShowForm(false);
      router.refresh();
    });
  }

  function disconnect() {
    startTransition(async () => {
      await disconnectBentley();
      router.refresh();
    });
  }

  // --- Connected state -------------------------------------------------------
  if (connection && !showForm) {
    return (
      <div className="mb-8 rounded-lg border bg-card p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-foreground">Connected to Bentley</p>
            <p className="text-xs text-muted-foreground">
              {connection.syncError
                ? `Session problem: ${connection.syncError}`
                : connection.lastSyncedAt
                  ? `Last synced ${formatWhen(connection.lastSyncedAt)}`
                  : "Connected — first sync pending."}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setError(null);
                setShowForm(true);
              }}
            >
              Reconnect
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={disconnect}
            >
              Disconnect
            </Button>
          </div>
        </div>
        {connection.syncError && (
          <p className="mt-2 text-xs text-muted-foreground">
            Your portal session likely expired. Reconnect with a fresh cookie.
          </p>
        )}
      </div>
    );
  }

  // --- Connect / reconnect form ---------------------------------------------
  return (
    <div className="mb-8 rounded-lg border border-dashed bg-muted/30 p-4">
      <p className="text-sm font-medium text-foreground">
        {connection ? "Reconnect Bentley" : "Connect to Bentley"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Paste your myBENTLEY session cookie to sync both kids&apos; homework.
        It&apos;s read-only and stays in your family&apos;s own database. Sessions
        expire, so you&apos;ll re-paste occasionally.
      </p>

      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">
          How do I get my session cookie?
        </summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4">
          <li>
            Log into{" "}
            <a
              href="https://bentleyschool.myschoolapp.com/"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              myBENTLEY
            </a>{" "}
            (your Google sign-in is fine), then open a child&apos;s{" "}
            <span className="font-medium">Assignments</span> page (Children → a
            kid → Assignments).
          </li>
          <li>
            Open DevTools (⌥⌘I) → <span className="font-medium">Network</span>{" "}
            tab.
          </li>
          <li>
            In the Network filter box, type{" "}
            <code className="rounded bg-muted px-1">
              ParentStudentAssignmentCenterGet
            </code>{" "}
            (or just <code className="rounded bg-muted px-1">assignment2</code>),
            then reload the page so it appears.
          </li>
          <li>
            Click that request — it&apos;s the one to{" "}
            <span className="font-medium">bentleyschool.myschoolapp.com</span>,
            not a tracking/analytics domain.
          </li>
          <li>
            Open its <span className="font-medium">Headers</span> tab, scroll to{" "}
            <span className="font-medium">Request Headers</span>, and copy the
            full value of the <span className="font-medium">cookie</span> row.
            (Skip <code className="rounded bg-muted px-1">document.cookie</code>{" "}
            in the Console — it omits the login cookie.)
          </li>
          <li>Paste it below and Connect.</li>
        </ol>
      </details>

      <Textarea
        value={cookie}
        onChange={(e) => setCookie(e.target.value)}
        placeholder="t=...; BBID=...; (your full cookie header)"
        className="mt-3 font-mono text-xs"
        rows={3}
        disabled={pending}
      />

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={submit} disabled={pending || !cookie.trim()}>
          {pending ? "Connecting…" : "Connect"}
        </Button>
        {connection && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setShowForm(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "just now";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
