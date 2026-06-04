"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Toast, ToastViewport } from "@/components/ui/toast";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  acceptProfileSuggestion,
  dismissProfileSuggestion,
  loadPendingProfileSuggestions,
  type AcceptSuggestionResult,
} from "@/app/(journal)/journal/actions";
import type { JournalProfileSuggestion } from "@/lib/types";

// Suggestions are rare and the table is tiny, so a light poll is cheap. This
// catches both the just-closed-entry case (the wrap finishes a few seconds
// after we navigate to /journal) and the next-load case, without coupling to
// the close handler.
const POLL_MS = 10_000;

type Applied = Extract<AcceptSuggestionResult, { ok: true }>;

export function ProfileSuggestionToaster() {
  const router = useRouter();
  const [pending, setPending] = useState<JournalProfileSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const rows = await loadPendingProfileSuggestions();
      setPending(rows);
    } catch {
      // Transient; the next poll will retry.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  const current = pending[0] ?? null;

  async function handleAccept(id: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await acceptProfileSuggestion(id);
      setPending((prev) => prev.filter((s) => s.id !== id));
      if (result.ok) {
        setApplied(result);
        router.refresh();
      } else {
        setError(result.error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDismiss(id: string) {
    setBusy(true);
    try {
      await dismissProfileSuggestion(id);
      setPending((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {(current || error) && (
        <ToastViewport>
          {error && !current && (
            <Toast className="ring-destructive/20">
              <p className="text-foreground">{error}</p>
              <div className="mt-3 flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => setError(null)}>
                  Dismiss
                </Button>
              </div>
            </Toast>
          )}
          {current && (
            <Toast>
              <p className="font-serif leading-relaxed text-foreground">
                {current.summary}
              </p>
              <div className="mt-3 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => handleDismiss(current.id)}
                >
                  Dismiss
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  disabled={busy}
                  onClick={() => handleAccept(current.id)}
                >
                  Add to profile
                </Button>
              </div>
            </Toast>
          )}
        </ToastViewport>
      )}

      <Dialog open={applied !== null} onOpenChange={(o) => !o && setApplied(null)}>
        {applied && (
          <DialogContent>
            {(() => {
              const docLabel = "profile";
              return (
                <>
                  <DialogHeader>
                    <DialogTitle>Profile updated</DialogTitle>
                    <DialogDescription>
                      {applied.change_type === "remove"
                        ? `Removed from your ${docLabel}:`
                        : applied.change_type === "edit"
                          ? `Updated in your ${docLabel}:`
                          : `Added to your ${docLabel}:`}
                    </DialogDescription>
                  </DialogHeader>

                  <SuggestionPreview applied={applied} />

                  <DialogFooter>
                    <DialogClose
                      render={<Button variant="outline" />}
                      onClick={() => setApplied(null)}
                    >
                      Done
                    </DialogClose>
                    <Button
                      render={
                        <Link
                          href="/settings/user"
                          onClick={() => setApplied(null)}
                        />
                      }
                    >
                      View full {docLabel}
                    </Button>
                  </DialogFooter>
                </>
              );
            })()}
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function SuggestionPreview({ applied }: { applied: Applied }) {
  if (applied.change_type === "edit") {
    return (
      <div className="space-y-2 font-serif text-sm">
        {applied.find && (
          <p className="text-muted-foreground line-through">{applied.find}</p>
        )}
        {applied.replace && <p className="text-foreground">{applied.replace}</p>}
      </div>
    );
  }
  const text = applied.change_type === "remove" ? applied.find : applied.replace;
  return (
    <p
      className={
        "font-serif text-sm " +
        (applied.change_type === "remove"
          ? "text-muted-foreground line-through"
          : "text-foreground")
      }
    >
      {text}
    </p>
  );
}
