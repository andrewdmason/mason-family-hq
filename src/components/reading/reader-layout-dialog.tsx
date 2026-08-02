"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  FONT_STEPS,
  LEADING_STEPS,
  fitsTwoColumns,
  type ReaderSettings,
} from "@/lib/reading/reader-settings";
import { cn } from "@/lib/utils";

/**
 * How this book is laid out on this device.
 *
 * Everything in here is local to the browser it's set in — the right column
 * count on a desktop is wrong on a phone, and a setting that followed you
 * between them would be wrong in one place or the other. Reading position is the
 * opposite and lives on the server, which is what lets these be free.
 *
 * Articles get a reduced version: they keep images, tables and code, which
 * column pagination mangles, so they're always scrolled.
 */
export function ReaderLayoutDialog({
  open,
  onOpenChange,
  settings,
  onChange,
  supportsPaging,
  availableWidth,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ReaderSettings;
  onChange: <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => void;
  /** False for saved articles, which are always scrolled. */
  supportsPaging: boolean;
  /** Width the book has, chat panel already subtracted — see bookAreaWidth. */
  availableWidth: number;
}) {
  const paged = supportsPaging && settings.paged;
  // Depends on the margins, so this answer changes under you as you set them —
  // which is the point: narrowing the margins is how a laptop earns two columns.
  const tooNarrowForTwo = !fitsTwoColumns(availableWidth, settings.margins, settings.eink);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Layout</DialogTitle>
          <DialogDescription>
            Saved for this browser only.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col divide-y divide-border">
          <Row
            label="E-ink mode"
            hint="Black on white, no animation. For a Boox or similar."
          >
            <Switch
              checked={settings.eink}
              onCheckedChange={(checked) => onChange("eink", checked)}
            />
          </Row>

          {supportsPaging && (
            <Row label="Continuous scrolling">
              <Switch
                checked={!settings.paged}
                onCheckedChange={(checked) => onChange("paged", !checked)}
              />
            </Row>
          )}

          <Field label="Text size">
            <Segmented
              options={FONT_STEPS.map((rem, i) => ({
                value: i,
                label: "A",
                style: { fontSize: `${0.7 + i * 0.12}rem` },
                title: `${Math.round(rem * 16)}px`,
              }))}
              value={settings.fontStep}
              onChange={(v) => onChange("fontStep", v)}
            />
          </Field>

          <Field label="Line spacing">
            <Segmented
              options={LEADING_STEPS.map((_, i) => ({
                value: i,
                label: <Lines count={4 - i} />,
              }))}
              value={settings.leading}
              onChange={(v) => onChange("leading", v)}
            />
          </Field>

          <Field label="Margins">
            <Segmented
              options={[
                { value: "narrow" as const, label: <Lines count={4} inset={1} /> },
                { value: "normal" as const, label: <Lines count={4} inset={3} /> },
                { value: "wide" as const, label: <Lines count={4} inset={5} /> },
              ]}
              value={settings.margins}
              onChange={(v) => onChange("margins", v)}
            />
          </Field>

          <Field label="Alignment">
            <Segmented
              options={[
                { value: "left" as const, label: <Lines count={4} ragged /> },
                { value: "justify" as const, label: <Lines count={4} /> },
              ]}
              value={settings.align}
              onChange={(v) => onChange("align", v)}
            />
          </Field>

          {paged && (
            <Field
              label="Columns"
              hint={
                tooNarrowForTwo
                  ? settings.margins === "narrow"
                    ? "Not enough width for two."
                    : "Not enough width — try narrower margins."
                  : undefined
              }
            >
              <Segmented
                options={[
                  { value: 1 as const, label: <Lines count={4} /> },
                  {
                    value: 2 as const,
                    label: (
                      <span className="flex gap-1">
                        <Lines count={4} width={14} />
                        <Lines count={4} width={14} />
                      </span>
                    ),
                    disabled: tooNarrowForTwo,
                  },
                ]}
                value={settings.columns === "auto" ? (tooNarrowForTwo ? 1 : 2) : settings.columns}
                onChange={(v) => onChange("columns", v)}
              />
            </Field>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-foreground">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-foreground">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: {
    value: T;
    label: ReactNode;
    style?: React.CSSProperties;
    title?: string;
    disabled?: boolean;
  }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          title={option.title}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          style={option.style}
          className={cn(
            "flex h-10 flex-1 items-center justify-center rounded-md border transition-colors",
            "disabled:cursor-not-allowed disabled:opacity-40",
            option.value === value
              ? "border-foreground/40 bg-accent text-foreground"
              : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A few stacked rules standing in for lines of text — the same visual language
 * Kindle uses, and far quicker to read than the words "narrow" and "wide".
 */
function Lines({
  count,
  inset = 0,
  ragged = false,
  width = 24,
}: {
  count: number;
  /** Horizontal padding, for the margin previews. */
  inset?: number;
  /** Uneven right edge, for left-aligned vs justified. */
  ragged?: boolean;
  width?: number;
}) {
  const raggedWidths = ["100%", "82%", "94%", "70%"];
  return (
    <span
      className="flex flex-col justify-center gap-[3px]"
      style={{ width, paddingInline: inset }}
      aria-hidden
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="h-[2px] rounded-full bg-current"
          style={{ width: ragged ? raggedWidths[i % raggedWidths.length] : "100%" }}
        />
      ))}
    </span>
  );
}
