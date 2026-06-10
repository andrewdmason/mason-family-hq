"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal, dependency-free toast surface. There is no built-in auto-dismiss
 * timer: most toasts are deliberate prompts that wait for an explicit action;
 * transient confirmations (e.g. quick-add's "Added to …") own their own timer.
 */
function ToastViewport({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-end gap-2 p-4 sm:max-w-sm sm:left-auto sm:right-0",
        className
      )}
      {...props}
    />
  );
}

function Toast({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-auto w-full rounded-xl bg-background p-4 text-sm shadow-lg ring-1 ring-foreground/10 animate-in fade-in-0 slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  );
}

export { Toast, ToastViewport };
