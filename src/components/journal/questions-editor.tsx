"use client";

import { useState, useTransition, type ComponentType } from "react";
import { Ban, ChevronRight, Plus, Repeat, StickyNote, Trash2 } from "lucide-react";
import {
  addCustomQuestionType,
  deleteCustomQuestionType,
  saveQuestionConfig,
} from "@/app/(journal)/journal/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  DEFAULT_RECURRING_SPEC,
  sourcesFor,
  type CategoryContextSpec,
} from "@/lib/journal/question-sources";
import type { JournalQuestionType, JournalSettings } from "@/lib/types";

const MIN_PER_DAY = 1;
const MAX_PER_DAY = 5;

/**
 * A signal-style bar ramp drawing exactly `count` bars (1–3), shortest first.
 * Unlike lucide's Signal* icons it never renders a faded extra bar, so "High"
 * reads as three bars, not four.
 */
function bars(count: number): ComponentType<{ className?: string }> {
  const BARS = [
    { x: 6, y1: 15 },
    { x: 12, y1: 11 },
    { x: 18, y1: 6 },
  ];
  function Bars({ className }: { className?: string }) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        className={className}
        aria-hidden="true"
      >
        {BARS.slice(0, count).map((b) => (
          <line key={b.x} x1={b.x} y1={b.y1} x2={b.x} y2={20} />
        ))}
      </svg>
    );
  }
  return Bars;
}

/**
 * Priority tiers, highest → lowest, then Off. The `weight` values are the
 * relative weights written to the row (the sampler normalizes them); the UI
 * never exposes the numbers. Icons form an issue-tracker-style priority ramp.
 */
type PriorityKey = "high" | "medium" | "low" | "off";

const PRIORITIES: {
  key: PriorityKey;
  label: string;
  weight: number;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { key: "high", label: "High", weight: 9, Icon: bars(3) },
  { key: "medium", label: "Medium", weight: 3, Icon: bars(2) },
  { key: "low", label: "Low", weight: 1, Icon: bars(1) },
  { key: "off", label: "Off", weight: 0, Icon: Ban },
];

const ACTIVE_TIERS = PRIORITIES.filter((t) => t.key !== "off");

function priorityFor(row: { enabled: boolean; weight: number }): PriorityKey {
  if (!row.enabled) return "off";
  // Snap to the active tier whose weight is closest to the stored weight.
  let best = ACTIVE_TIERS[0];
  let bestDiff = Infinity;
  for (const t of ACTIVE_TIERS) {
    const d = Math.abs((row.weight || 0) - t.weight);
    if (d < bestDiff) {
      bestDiff = d;
      best = t;
    }
  }
  return best.key;
}

type Row = {
  id: string;
  name: string;
  base_description: string;
  style_note: string;
  weight: number;
  enabled: boolean;
  is_builtin: boolean;
  sort_order: number;
  recurrence_days: number | null;
  context_spec: CategoryContextSpec | null;
};

function labelFor(name: string): string {
  const s = name.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Sort by effective priority (enabled weight, desc), Off last, stable on the
// seeded order for ties.
function byPriority(a: Row, b: Row): number {
  const aw = a.enabled ? a.weight : -1;
  const bw = b.enabled ? b.weight : -1;
  if (bw !== aw) return bw - aw;
  return a.sort_order - b.sort_order;
}

function toRow(t: JournalQuestionType): Row {
  return {
    id: t.id,
    name: t.name,
    base_description: t.base_description,
    style_note: t.style_note,
    weight: Math.round(Number(t.weight) || 0),
    enabled: t.enabled,
    is_builtin: t.is_builtin,
    sort_order: t.sort_order,
    recurrence_days: t.recurrence_days,
    context_spec: t.context_spec,
  };
}

export function QuestionsEditor({
  questionTypes,
  settings,
  memberEmail,
}: {
  questionTypes: JournalQuestionType[];
  settings: JournalSettings;
  /** When the owner is editing on a member's behalf, the member's email. */
  memberEmail?: string;
}) {
  const [rows, setRows] = useState<Row[]>(() => questionTypes.map(toRow));
  const [perDay, setPerDay] = useState(settings.questions_per_day);
  const [dirty, setDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  // Recurring posts live in their own section; the rotation lists exclude them.
  const recurrings = rows
    .filter((r) => r.recurrence_days != null)
    .sort((a, b) => a.sort_order - b.sort_order);
  const builtins = rows
    .filter((r) => r.is_builtin && r.recurrence_days == null)
    .sort(byPriority);
  const customs = rows
    .filter((r) => !r.is_builtin && r.recurrence_days == null)
    .sort(byPriority);

  function touch() {
    setDirty(true);
    setJustSaved(false);
  }

  function patch(id: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
    touch();
  }

  function setPriority(id: string, key: PriorityKey) {
    const tier = PRIORITIES.find((t) => t.key === key)!;
    if (key === "off") {
      patch(id, { enabled: false });
    } else {
      patch(id, { enabled: true, weight: tier.weight });
    }
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await saveQuestionConfig(
          rows.map((r) => ({
            id: r.id,
            weight: r.weight,
            style_note: r.style_note,
            base_description: r.base_description,
            enabled: r.enabled,
            recurrence_days: r.recurrence_days,
            context_spec: r.context_spec,
          })),
          perDay,
          memberEmail
        );
        setDirty(false);
        setJustSaved(true);
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function handleAdd() {
    startTransition(async () => {
      try {
        const created = await addCustomQuestionType(newName, newDesc, memberEmail);
        setRows((rs) => [...rs, toRow(created)]);
        setNewName("");
        setNewDesc("");
        setAdding(false);
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      try {
        await deleteCustomQuestionType(id, memberEmail);
        setRows((rs) => rs.filter((r) => r.id !== id));
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    });
  }

  function handleAddRecurring(
    name: string,
    desc: string,
    days: number,
    spec: CategoryContextSpec,
    onDone: () => void
  ) {
    startTransition(async () => {
      try {
        const created = await addCustomQuestionType(name, desc, memberEmail, {
          recurrence_days: days,
          context_spec: spec,
        });
        setRows((rs) => [...rs, toRow(created)]);
        onDone();
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="mt-4">
      {/* Questions per day */}
      <div className="mb-6 flex items-center gap-3">
        <span className="font-serif text-sm text-foreground">Questions per day</span>
        <div className="flex items-center gap-1">
          {Array.from(
            { length: MAX_PER_DAY - MIN_PER_DAY + 1 },
            (_, i) => i + MIN_PER_DAY
          ).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setPerDay(n);
                touch();
              }}
              className={cn(
                "h-7 w-7 rounded-md border font-serif text-sm transition-colors",
                perDay === n
                  ? "border-foreground bg-foreground/10 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border">
        {builtins.map((r) => (
          <QuestionRow key={r.id} row={r} onPatch={patch} onPriority={setPriority} />
        ))}
      </div>

      {/* Custom types */}
      <div className="mt-8">
        <h3 className="font-serif text-sm uppercase tracking-wide text-muted-foreground">
          Your own types
        </h3>
        <div className="mt-3">
          {customs.length === 0 && !adding && (
            <p className="font-serif text-sm italic text-muted-foreground">
              None yet — add a question type that&apos;s specific to your life.
            </p>
          )}
          {customs.length > 0 && (
            <div className="divide-y divide-border rounded-lg border border-border">
              {customs.map((r) => (
                <QuestionRow
                  key={r.id}
                  row={r}
                  onPatch={patch}
                  onPriority={setPriority}
                  onDelete={() => handleDelete(r.id)}
                />
              ))}
            </div>
          )}

          {adding ? (
            <div className="mt-3 rounded-lg border border-border p-3">
              <Input
                autoFocus
                placeholder="name (e.g. marathon-training)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Textarea
                className="mt-2"
                placeholder="What is a question of this type about?"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
              />
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" onClick={handleAdd} disabled={pending}>
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAdding(false);
                    setNewName("");
                    setNewDesc("");
                  }}
                  disabled={pending}
                >
                  Cancel
                </Button>
              </div>
              <p className="mt-2 font-serif text-xs italic text-muted-foreground">
                New types start Off — set a priority to add them to the rotation.
              </p>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              Add custom type
            </Button>
          )}
        </div>
      </div>

      {/* Recurring posts */}
      <RecurringSection
        rows={recurrings}
        onPatch={patch}
        onDelete={handleDelete}
        onAdd={handleAddRecurring}
        pending={pending}
      />

      {/* Save bar */}
      <div className="mt-8 flex items-center justify-end gap-3 border-t border-border pt-4 text-xs">
        <span className="text-muted-foreground">
          {justSaved ? "saved" : dirty ? "unsaved changes" : ""}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || pending}
          className="font-serif text-sm text-foreground underline-offset-4 hover:underline disabled:opacity-40 disabled:hover:no-underline"
        >
          {pending ? "saving…" : "save"}
        </button>
      </div>
    </div>
  );
}

function QuestionRow({
  row,
  onPatch,
  onPriority,
  onDelete,
}: {
  row: Row;
  onPatch: (id: string, p: Partial<Row>) => void;
  onPriority: (id: string, key: PriorityKey) => void;
  onDelete?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasNotes = row.style_note.trim().length > 0;
  const off = !row.enabled;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div>
      {/* Collapsed header — click anywhere (except the controls) to expand. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((x) => !x);
          }
        }}
        className="flex cursor-pointer select-none items-center gap-2 px-2 py-1.5"
      >
        <span onClick={stop} className="inline-flex">
          <PriorityPicker
            value={priorityFor(row)}
            onChange={(key) => onPriority(row.id, key)}
          />
        </span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )}
        />
        <span
          className={cn(
            "font-serif text-sm",
            off ? "text-muted-foreground" : "text-foreground"
          )}
        >
          {labelFor(row.name)}
        </span>

        <div className="flex-1" />

        {hasNotes && (
          <StickyNote
            className="h-3.5 w-3.5 text-primary"
            aria-label="Has custom instructions"
          />
        )}
        {onDelete && (
          <span onClick={stop} className="inline-flex">
            <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Delete">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </span>
        )}
      </div>

      {/* Expanded detail — how the question is determined + custom instructions. */}
      {expanded && (
        <div className="pb-3 pl-9 pr-2">
          {row.is_builtin ? (
            <p className="font-serif text-sm text-muted-foreground">{row.base_description}</p>
          ) : (
            <div>
              <label className="font-serif text-xs uppercase tracking-wide text-muted-foreground">
                What this asks about
              </label>
              <Textarea
                className="mt-1"
                value={row.base_description}
                onChange={(e) => onPatch(row.id, { base_description: e.target.value })}
                placeholder="What is a question of this type about, and what should it draw on?"
              />
            </div>
          )}

          <SourcePills name={row.name} />

          <div className="mt-3">
            <label className="font-serif text-xs uppercase tracking-wide text-muted-foreground">
              Custom instructions
            </label>
            <Textarea
              className="mt-1"
              value={row.style_note}
              onChange={(e) => onPatch(row.id, { style_note: e.target.value })}
              placeholder="Optional — e.g. only ask about events from the last two days"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The data sources this question type loads into its prompt, shown as pills so
 * you can see at a glance which docs ground it. Derived from the shared
 * CONTEXT_SPECS (sourcesFor). An explicit "none" keeps a sourceless type (a cold,
 * imaginative prompt like Curveball) from looking like a rendering bug.
 */
function SourcePills({ name }: { name: string }) {
  const sources = sourcesFor(name);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="font-serif text-xs uppercase tracking-wide text-muted-foreground">
        Sources
      </span>
      {sources.length === 0 ? (
        <span className="font-serif text-xs italic text-muted-foreground">
          none — asked without your docs
        </span>
      ) : (
        sources.map((s) => (
          <Badge
            key={s}
            variant="outline"
            className="font-mono text-[11px] font-normal text-muted-foreground"
          >
            {s}
          </Badge>
        ))
      )}
    </div>
  );
}

function PriorityPicker({
  value,
  onChange,
}: {
  value: PriorityKey;
  onChange: (key: PriorityKey) => void;
}) {
  const current = PRIORITIES.find((t) => t.key === value)!;
  const CurrentIcon = current.Icon;
  const off = value === "off";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={`Priority: ${current.label}`} />
        }
      >
        <CurrentIcon
          className={cn("h-4 w-4", off ? "text-muted-foreground/60" : "text-foreground")}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-44" align="start">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onChange(v as PriorityKey)}
        >
          {PRIORITIES.map((t) => {
            const Icon = t.Icon;
            return (
              <DropdownMenuRadioItem key={t.key} value={t.key}>
                <Icon
                  className={cn(
                    "h-4 w-4",
                    t.key === "off" ? "text-muted-foreground/60" : "text-foreground"
                  )}
                />
                <span className="font-serif">{t.label}</span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ============================================================
// Recurring posts
// ============================================================

const CADENCE_PRESETS: { label: string; days: number }[] = [
  { label: "Weekly", days: 7 },
  { label: "Monthly", days: 30 },
];

/** The boolean context sources a recurring post can draw on, in load order. */
const FLAG_TOGGLES: {
  key: "present" | "typeHistory" | "history" | "past" | "family";
  label: string;
}[] = [
  { key: "present", label: "About me" },
  { key: "typeHistory", label: "Past posts of this type" },
  { key: "history", label: "My recent entries" },
  { key: "past", label: "My timeline" },
  { key: "family", label: "Family posts" },
];

function cadenceLabel(days: number): string {
  const preset = CADENCE_PRESETS.find((p) => p.days === days);
  return preset ? preset.label.toLowerCase() : `every ${days} days`;
}

function RecurringSection({
  rows,
  onPatch,
  onDelete,
  onAdd,
  pending,
}: {
  rows: Row[];
  onPatch: (id: string, p: Partial<Row>) => void;
  onDelete: (id: string) => void;
  onAdd: (
    name: string,
    desc: string,
    days: number,
    spec: CategoryContextSpec,
    onDone: () => void
  ) => void;
  pending: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [days, setDays] = useState(7);
  const [spec, setSpec] = useState<CategoryContextSpec>(DEFAULT_RECURRING_SPEC);

  function reset() {
    setName("");
    setDesc("");
    setDays(7);
    setSpec(DEFAULT_RECURRING_SPEC);
    setAdding(false);
  }

  return (
    <div className="mt-10">
      <h3 className="font-serif text-sm uppercase tracking-wide text-muted-foreground">
        Recurring posts
      </h3>
      <p className="mt-1 font-serif text-sm italic text-muted-foreground">
        Posts you want to make on a regular cadence. You&apos;ll be nudged when one
        is due, and can start it any time from the new-post menu.
      </p>

      <div className="mt-3">
        {rows.length > 0 && (
          <div className="divide-y divide-border rounded-lg border border-border">
            {rows.map((r) => (
              <RecurringRow
                key={r.id}
                row={r}
                onPatch={onPatch}
                onDelete={() => onDelete(r.id)}
              />
            ))}
          </div>
        )}

        {adding ? (
          <div className="mt-3 rounded-lg border border-border p-3">
            <Input
              autoFocus
              placeholder="name (e.g. school-week)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Textarea
              className="mt-2"
              placeholder="What should this post prompt you about? (e.g. What happened at school this week?)"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
            <div className="mt-3">
              <CadencePicker days={days} onChange={setDays} />
            </div>
            <div className="mt-3">
              <SourceToggles spec={spec} onChange={setSpec} />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => onAdd(name, desc, days, spec, reset)}
                disabled={pending}
              >
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={reset} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            New recurring post
          </Button>
        )}
      </div>
    </div>
  );
}

function RecurringRow({
  row,
  onPatch,
  onDelete,
}: {
  row: Row;
  onPatch: (id: string, p: Partial<Row>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const days = row.recurrence_days ?? 7;
  const spec = row.context_spec ?? DEFAULT_RECURRING_SPEC;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((x) => !x);
          }
        }}
        className="flex cursor-pointer select-none items-center gap-2 px-2 py-1.5"
      >
        <Repeat className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )}
        />
        <span className="font-serif text-sm text-foreground">{labelFor(row.name)}</span>
        <span className="font-serif text-xs text-muted-foreground">
          {cadenceLabel(days)}
        </span>
        <div className="flex-1" />
        <span onClick={stop} className="inline-flex">
          <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Delete">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </span>
      </div>

      {expanded && (
        <div className="pb-3 pl-9 pr-2">
          <label className="font-serif text-xs uppercase tracking-wide text-muted-foreground">
            Prompt
          </label>
          <Textarea
            className="mt-1"
            value={row.base_description}
            onChange={(e) => onPatch(row.id, { base_description: e.target.value })}
            placeholder="What should this post prompt you about?"
          />

          <div className="mt-3">
            <CadencePicker
              days={days}
              onChange={(d) => onPatch(row.id, { recurrence_days: d })}
            />
          </div>

          <div className="mt-3">
            <SourceToggles
              spec={spec}
              onChange={(s) => onPatch(row.id, { context_spec: s })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function CadencePicker({
  days,
  onChange,
}: {
  days: number;
  onChange: (days: number) => void;
}) {
  const isPreset = CADENCE_PRESETS.some((p) => p.days === days);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-serif text-xs uppercase tracking-wide text-muted-foreground">
        Cadence
      </span>
      {CADENCE_PRESETS.map((p) => (
        <button
          key={p.days}
          type="button"
          onClick={() => onChange(p.days)}
          className={cn(
            "rounded-md border px-2.5 py-1 font-serif text-sm transition-colors",
            days === p.days
              ? "border-foreground bg-foreground/10 text-foreground"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          {p.label}
        </button>
      ))}
      <span className="flex items-center gap-1 font-serif text-sm text-muted-foreground">
        <button
          type="button"
          onClick={() => onChange(isPreset ? 14 : days)}
          className={cn(
            "rounded-md border px-2.5 py-1 transition-colors",
            !isPreset
              ? "border-foreground bg-foreground/10 text-foreground"
              : "border-border hover:text-foreground"
          )}
        >
          Every
        </button>
        <Input
          type="number"
          min={1}
          value={days}
          onChange={(e) => {
            const n = Math.max(1, Math.round(Number(e.target.value) || 1));
            onChange(n);
          }}
          className="h-8 w-16"
        />
        <span>days</span>
      </span>
    </div>
  );
}

function SourceToggles({
  spec,
  onChange,
}: {
  spec: CategoryContextSpec;
  onChange: (spec: CategoryContextSpec) => void;
}) {
  function pill(active: boolean, label: string, onClick: () => void) {
    return (
      <button
        key={label}
        type="button"
        onClick={onClick}
        className={cn(
          "rounded-full border px-2.5 py-1 font-serif text-xs transition-colors",
          active
            ? "border-foreground bg-foreground/10 text-foreground"
            : "border-border text-muted-foreground hover:text-foreground"
        )}
      >
        {label}
      </button>
    );
  }

  return (
    <div>
      <span className="font-serif text-xs uppercase tracking-wide text-muted-foreground">
        Context sources
      </span>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {FLAG_TOGGLES.map((t) =>
          pill(Boolean(spec[t.key]), t.label, () =>
            onChange({ ...spec, [t.key]: !spec[t.key] })
          )
        )}
        {pill(spec.calendar === "recent", "Past calendar", () =>
          onChange({
            ...spec,
            calendar: spec.calendar === "recent" ? "none" : "recent",
          })
        )}
        {pill(spec.calendar === "ahead", "Upcoming calendar", () =>
          onChange({
            ...spec,
            calendar: spec.calendar === "ahead" ? "none" : "ahead",
          })
        )}
      </div>
    </div>
  );
}
