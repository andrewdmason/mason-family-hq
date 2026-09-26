"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getExportStatus } from "@/app/(clips)/clips/actions";

// Renders happen on the clips worker; this polls until the file is ready, then
// pulls it into memory so the Share button can hand it straight to the phone's
// share sheet (Safari only allows sharing inside the tap itself, so the file
// has to be in hand before the tap — it can't be fetched after).

type Phase =
  | { kind: "starting" }
  | { kind: "rendering"; exportId: string }
  | { kind: "fetching"; url: string }
  | { kind: "ready"; url: string; file: File | null }
  | { kind: "failed"; error: string };

export function ExportDialog({
  open,
  onOpenChange,
  title,
  fileName,
  start,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  fileName: string;
  start: () => Promise<{ exportId: string }>;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const startRef = useRef(start);
  startRef.current = start;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase({ kind: "starting" });
    (async () => {
      try {
        const { exportId } = await startRef.current();
        if (cancelled) return;
        setPhase({ kind: "rendering", exportId });
        for (;;) {
          await new Promise((r) => setTimeout(r, 2500));
          if (cancelled) return;
          const s = await getExportStatus(exportId);
          if (s.status === "failed") throw new Error(s.error ?? "The render failed");
          if (s.status === "ready" && s.url) {
            setPhase({ kind: "fetching", url: s.url });
            let file: File | null = null;
            try {
              const blob = await (await fetch(s.url)).blob();
              file = new File([blob], fileName, { type: "video/mp4" });
            } catch {
              // Download still works without the in-memory copy.
            }
            if (!cancelled) setPhase({ kind: "ready", url: s.url, file });
            return;
          }
        }
      } catch (e) {
        if (!cancelled) setPhase({ kind: "failed", error: e instanceof Error ? e.message : "Export failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, fileName]);

  const canShare =
    phase.kind === "ready" &&
    phase.file != null &&
    typeof navigator !== "undefined" &&
    !!navigator.canShare?.({ files: [phase.file] });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {phase.kind === "failed"
              ? phase.error
              : phase.kind === "ready"
                ? "Ready to send."
                : "Rendering the quick version — this takes a minute or two."}
          </DialogDescription>
        </DialogHeader>
        {phase.kind === "ready" ? (
          <div className="flex flex-col gap-2">
            {canShare && (
              <Button
                size="lg"
                className="h-11"
                onClick={() => {
                  if (phase.file) navigator.share({ files: [phase.file] }).catch(() => {});
                }}
              >
                <Share /> Share
              </Button>
            )}
            <a
              href={phase.url}
              download={fileName}
              className={buttonVariants({ variant: canShare ? "outline" : "default", size: "lg", className: "h-11" })}
            >
              <Download /> Download
            </a>
          </div>
        ) : phase.kind !== "failed" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {phase.kind === "fetching" ? "Almost there…" : "Rendering…"}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
