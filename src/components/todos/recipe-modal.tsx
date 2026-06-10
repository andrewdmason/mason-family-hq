"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * Shared shell for the integration recipes on the Integrations settings page:
 * an inline text link that opens a scrollable dialog of rendered setup docs.
 * Content lives in shortcut-recipe-modal.tsx / raycast-recipe-modal.tsx.
 */
export function RecipeModal({
  linkText,
  title,
  children,
}: {
  linkText: string;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
      >
        {linkText}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="block max-h-[85vh] overflow-y-auto p-0 sm:max-w-xl">
          <div className="px-6 py-5">
            <DialogTitle className="font-serif text-xl tracking-tight">
              {title}
            </DialogTitle>

            <div className="mt-3 space-y-4 text-sm leading-relaxed text-foreground">
              {children}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-1.5 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
      {children}
    </code>
  );
}

export function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="my-1.5 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  );
}

/** The real app origin for this deployment — only rendered client-side after open. */
export function AppOrigin({ suffix = "" }: { suffix?: string }) {
  return (
    <InlineCode>
      {typeof window !== "undefined" ? window.location.origin : ""}
      {suffix}
    </InlineCode>
  );
}
