"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Award,
  Baby,
  Blocks,
  Briefcase,
  Check,
  ChevronDown,
  GraduationCap,
  Heart,
  HeartPulse,
  Home,
  MapPin,
  MessageSquareText,
  MoreHorizontal,
  Music,
  Pencil,
  Plane,
  Plus,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  TimelineCategory,
  TimelineEntryWithPeople,
  TimelinePerson,
  TimelineProminence,
} from "@/lib/types";
import { TIMELINE_CATEGORIES } from "@/lib/types";
import { CATEGORY_LABEL, personColor } from "@/lib/timeline/config";
import { EntryModal } from "@/components/timeline/entry-modal";
import { ReflectOnEventButton } from "@/components/timeline/reflect-on-event-button";
import { deleteTimelineEntry } from "@/lib/timeline/actions";

// A representative icon per category — drawn on the axis (person-colored) and
// shown in the category dropdown as a legend.
const CATEGORY_ICON: Record<TimelineCategory, LucideIcon> = {
  origins: Baby,
  childhood: Blocks,
  education: GraduationCap,
  career: Briefcase,
  recognition: Award,
  relationships: Heart,
  children_family: Users,
  homes: Home,
  travel: Plane,
  music_hobbies: Music,
  health_hard_times: HeartPulse,
};
import { decadeOf, formatTimelineRange, isUpcoming, toFractionalYear } from "@/lib/timeline/format";

/**
 * Full-bleed horizontal timeline pinned to the bottom of the viewport. Scroll
 * up/down to move it left/right. Time flows left → right, proportional to real
 * elapsed years, with events staggered into two rows above/below a central axis,
 * overlapping in crowded years. Each event's dot sits at the LEFT edge of a
 * left-aligned block (date · person, then title, then photo) so everything flows
 * out to the right. Filter chips up top turn individual people and categories
 * on and off.
 */

const COL_W = 156;
const PX_PER_YEAR = 46;
const GAP_OFFSET = 34; // pulled in so close-in-time events still stagger, but less aggressively
const MIN_GAP = -16; // cap on how much neighbors may overlap
const MAX_GAP = 240;
const AXIS_OFFSET = 16; // px the content sits above/below the axis, clearing the icons
const TRACK_H = 500; // px — the content band; the scroller centers it vertically
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const firstName = (name: string) => name.trim().split(/\s+/)[0];

const IMG_H: Record<TimelineProminence, number> = { major: 150, medium: 104, minor: 72 };
const TITLE: Record<TimelineProminence, string> = {
  major: "font-serif text-sm font-medium text-foreground",
  medium: "font-serif text-[13px] text-foreground",
  minor: "font-serif text-xs text-muted-foreground",
};
// The icon "chip" on the axis: a background-filled circle (masks the axis line),
// person-colored ring + icon, sized by prominence.
const ICON_BOX: Record<TimelineProminence, string> = {
  major: "h-7 w-7",
  medium: "h-6 w-6",
  minor: "h-5 w-5",
};
const ICON_SIZE: Record<TimelineProminence, string> = {
  major: "h-4 w-4",
  medium: "h-3.5 w-3.5",
  minor: "h-3 w-3",
};

type Item =
  | { kind: "decade"; label: string }
  | { kind: "now" }
  | { kind: "event"; e: TimelineEntryWithPeople; gap: number; row: 0 | 1; upcoming: boolean };

export function VerticalTimeline({
  entries,
  today,
  currentUserEmail,
}: {
  entries: TimelineEntryWithPeople[];
  today: string;
  currentUserEmail: string | null;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  // The distinct family people and categories present, for the filter chips.
  const people: { email: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    for (const s of e.subjects) {
      const email = s.member_email?.toLowerCase();
      if (email && !seen.has(email)) {
        seen.add(email);
        people.push({ email, name: firstName(s.name) });
      }
    }
  }
  const presentCats = new Set(entries.map((e) => e.category));
  const categories = TIMELINE_CATEGORIES.filter((c) => presentCats.has(c));

  const [onPeople, setOnPeople] = useState<Set<string>>(() => new Set(people.map((p) => p.email)));
  const [onCats, setOnCats] = useState<Set<string>>(() => new Set(categories));

  // Scroll up/down → move left/right; release at the ends so the page can scroll.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!el || el.scrollWidth <= el.clientWidth) return;
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      const atStart = el.scrollLeft <= 0;
      const atEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 1;
      if ((delta < 0 && atStart) || (delta > 0 && atEnd)) return;
      el.scrollLeft += delta;
      e.preventDefault();
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  };

  // Hover popover + edit modal state.
  const router = useRouter();
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hovered, setHovered] = useState<{ entry: TimelineEntryWithPeople; rect: DOMRect } | null>(null);
  const [editing, setEditing] = useState<TimelineEntryWithPeople | null>(null);
  const [creating, setCreating] = useState(false);

  function showPopover(entry: TimelineEntryWithPeople, el: HTMLElement, immediate = false) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (openTimer.current) clearTimeout(openTimer.current);
    const rect = el.getBoundingClientRect();
    if (immediate) setHovered({ entry, rect });
    else openTimer.current = setTimeout(() => setHovered({ entry, rect }), 120);
  }
  function scheduleClose() {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setHovered(null), 220);
  }
  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }
  function closeNow() {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setHovered(null);
  }
  async function handleDelete(id: string) {
    closeNow();
    try {
      await deleteTimelineEntry(id);
      router.refresh();
    } catch {
      /* leave the row if the delete failed */
    }
  }

  const filtered = entries.filter((e) => {
    if (!onCats.has(e.category)) return false;
    const subjectEmails = e.subjects.map((s) => s.member_email?.toLowerCase()).filter(Boolean) as string[];
    if (subjectEmails.length === 0) return true;
    return subjectEmails.some((em) => onPeople.has(em));
  });

  // Build the ordered run of decade rules, the "now" rule, and event columns.
  const items: Item[] = [];
  let eventIdx = 0;
  const todayT = toFractionalYear(today);
  const hasUpcoming = filtered.some((e) => isUpcoming(e, today));
  for (let i = 0; i < filtered.length; i++) {
    const e = filtered[i];
    const prev = i > 0 ? filtered[i - 1] : null;
    if (!prev || decadeOf(prev) !== decadeOf(e)) items.push({ kind: "decade", label: decadeOf(e) });
    if (prev && toFractionalYear(prev.start_date) <= todayT && toFractionalYear(e.start_date) > todayT) {
      items.push({ kind: "now" });
    }
    const gap = prev
      ? clamp((toFractionalYear(e.start_date) - toFractionalYear(prev.start_date)) * PX_PER_YEAR - GAP_OFFSET, MIN_GAP, MAX_GAP)
      : 0;
    items.push({ kind: "event", e, gap, row: (eventIdx % 2) as 0 | 1, upcoming: isUpcoming(e, today) });
    eventIdx++;
  }
  if (filtered.length > 0 && !hasUpcoming) items.push({ kind: "now" });

  return (
    <div className="flex flex-1 flex-col pt-10">
      {/* Title + filters in the reading column. */}
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-serif text-2xl tracking-tight text-foreground">Timeline</h1>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New entry
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <MultiselectDropdown
            label="People"
            summaryAll="Everyone"
            items={people.map((p) => ({
              key: p.email,
              label: p.name,
              leading: <span className={cn("h-2 w-2 shrink-0 rounded-full", personColor(p.email).dot)} />,
            }))}
            selected={onPeople}
            onToggle={(key) => toggle(onPeople, key, setOnPeople)}
            onAll={() => setOnPeople(new Set(people.map((p) => p.email)))}
            onNone={() => setOnPeople(new Set())}
          />
          <MultiselectDropdown
            label="Categories"
            summaryAll="All categories"
            items={categories.map((c) => {
              const Icon = CATEGORY_ICON[c];
              return {
                key: c,
                label: CATEGORY_LABEL[c],
                leading: <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />,
              };
            })}
            selected={onCats}
            onToggle={(key) => toggle(onCats, key, setOnCats)}
            onAll={() => setOnCats(new Set(categories))}
            onNone={() => setOnCats(new Set())}
          />
        </div>
      </div>

      {/* Track: the scroller fills the space and flex-centers the fixed-height
          content band, so the timeline sits vertically centered while its
          horizontal scrollbar lands at the bottom of the viewport. */}
      <div
        ref={scrollerRef}
        onScroll={closeNow}
        className="mt-4 flex w-full flex-1 items-center overflow-x-auto overscroll-x-contain [scrollbar-width:thin]"
      >
        <div className="relative inline-flex shrink-0 items-center pl-10 pr-24" style={{ height: `${TRACK_H}px`, minWidth: "100%" }}>
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border" aria-hidden />
          {filtered.length === 0 ? (
            <p className="font-serif italic text-muted-foreground">Nothing matches those filters.</p>
          ) : (
            items.map((item, idx) => {
              if (item.kind === "decade") return <DecadeRule key={`d${idx}`} label={item.label} />;
              if (item.kind === "now") return <NowRule key={`n${idx}`} />;
              return (
                <EventColumn
                  key={item.e.id}
                  entry={item.e}
                  gap={item.gap}
                  row={item.row}
                  upcoming={item.upcoming}
                  onEnter={(el) => showPopover(item.e, el)}
                  onLeave={scheduleClose}
                  onActivate={(el) => showPopover(item.e, el, true)}
                />
              );
            })
          )}
        </div>
      </div>

      {hovered && (
        <EntryPopover
          entry={hovered.entry}
          rect={hovered.rect}
          onEnter={cancelClose}
          onLeave={scheduleClose}
          onEdit={() => {
            setEditing(hovered.entry);
            closeNow();
          }}
          onDelete={() => handleDelete(hovered.entry.id)}
        />
      )}
      {editing && (
        <EntryModal entry={editing} familyPeople={people} onClose={() => setEditing(null)} />
      )}
      {creating && (
        <EntryModal
          familyPeople={people}
          defaultSubjectEmail={currentUserEmail}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

/** A labeled multiselect dropdown used for both the People and Categories filters. */
function MultiselectDropdown({
  label,
  summaryAll,
  items,
  selected,
  onToggle,
  onAll,
  onNone,
}: {
  label: string;
  summaryAll: string;
  items: { key: string; label: string; leading: React.ReactNode }[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const count = selected.size;
  const total = items.length;
  const summary = count === total ? summaryAll : count === 0 ? "None" : `${count} of ${total}`;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-0.5 text-xs font-medium text-foreground/80 hover:bg-accent"
        >
          {summary}
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <div className="absolute left-0 top-full z-20 mt-1.5 w-60 rounded-lg border border-border bg-background p-1.5 shadow-lg">
            <div className="flex items-center justify-between px-1.5 pb-1.5">
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                Show
              </span>
              <div className="flex gap-2 text-[11px]">
                <button type="button" onClick={onAll} className="text-muted-foreground hover:text-foreground">
                  All
                </button>
                <button type="button" onClick={onNone} className="text-muted-foreground hover:text-foreground">
                  None
                </button>
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {items.map((it) => {
                const on = selected.has(it.key);
                return (
                  <button
                    key={it.key}
                    type="button"
                    onClick={() => onToggle(it.key)}
                    className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-accent"
                  >
                    <span
                      className={cn(
                        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                        on ? "border-foreground bg-foreground text-background" : "border-muted-foreground/40"
                      )}
                    >
                      {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                    </span>
                    {it.leading}
                    <span className={cn(on ? "text-foreground" : "text-muted-foreground")}>{it.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DecadeRule({ label }: { label: string }) {
  return (
    <div className="relative h-full w-10 shrink-0" aria-hidden>
      <div className="absolute inset-y-8 left-1/2 w-px bg-border/70" />
      <span className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap font-serif text-xs font-semibold tabular-nums text-foreground/60">
        {label}
      </span>
    </div>
  );
}

function NowRule() {
  return (
    <div className="relative h-full w-10 shrink-0">
      <div className="absolute inset-y-6 left-1/2 border-l border-dashed border-muted-foreground/50" />
      <span className="absolute left-1/2 top-2 -translate-x-1/2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        now
      </span>
    </div>
  );
}

function EventColumn({
  entry: e,
  gap,
  row,
  upcoming,
  onEnter,
  onLeave,
  onActivate,
}: {
  entry: TimelineEntryWithPeople;
  gap: number;
  row: 0 | 1;
  upcoming: boolean;
  onEnter: (el: HTMLElement) => void;
  onLeave: () => void;
  onActivate: (el: HTMLElement) => void;
}) {
  const top = row === 0;
  const color = personColor(e.subjects[0]?.member_email);
  const imgH = IMG_H[e.prominence];
  const showImage = !!e.coverPhotoUrl && imgH > 0;
  const Icon = CATEGORY_ICON[e.category];

  const meta = (
    <div className="flex items-center gap-1.5 whitespace-nowrap text-[10px]">
      <span className="font-mono tabular-nums text-muted-foreground">
        {e.start_date.slice(0, 4)}
        {e.end_date && e.end_date.slice(0, 4) !== e.start_date.slice(0, 4)
          ? `–${e.end_date.slice(0, 4)}`
          : ""}
      </span>
      <Names subjects={e.subjects} />
      {e.linkedCount > 0 && (
        <span className="inline-flex items-center gap-0.5 text-muted-foreground/70" title={`${e.linkedCount} related post${e.linkedCount > 1 ? "s" : ""}`}>
          <MessageSquareText className="h-3 w-3" />
          {e.linkedCount}
        </span>
      )}
    </div>
  );

  const title = (
    <div className={cn(TITLE[e.prominence], "line-clamp-2 leading-snug group-hover:underline")}>
      {e.title}
    </div>
  );

  const image = showImage ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={e.coverPhotoUrl!}
      alt=""
      style={{ height: `${imgH}px` }}
      className={cn("w-full rounded-lg object-cover shadow-sm ring-1 ring-black/5", upcoming && "opacity-70")}
    />
  ) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onMouseEnter={(ev) => onEnter(ev.currentTarget)}
      onMouseLeave={onLeave}
      onClick={(ev) => onActivate(ev.currentTarget)}
      onFocus={(ev) => onEnter(ev.currentTarget)}
      className="group relative h-full shrink-0 cursor-pointer"
      style={{ width: `${COL_W}px`, marginLeft: `${gap}px` }}
    >
      {/* The datum at the LEFT edge, on the axis: the category's icon, colored
          to the person. */}
      <span className="absolute left-0 top-1/2 z-10 -translate-y-1/2" aria-hidden>
        <span
          className={cn(
            "flex items-center justify-center rounded-full bg-background ring-1",
            color.ring,
            ICON_BOX[e.prominence],
            upcoming && "opacity-40"
          )}
        >
          <Icon className={cn(color.text, ICON_SIZE[e.prominence])} strokeWidth={2} />
        </span>
      </span>

      {/* Left-aligned block, flush to the dot, flowing right; above or below the axis. */}
      <div
        className={cn("absolute left-0 flex w-full flex-col items-start gap-1", upcoming && "opacity-60")}
        style={top ? { bottom: `calc(50% + ${AXIS_OFFSET}px)` } : { top: `calc(50% + ${AXIS_OFFSET}px)` }}
      >
        {top ? (
          <>
            {image}
            {meta}
            {title}
          </>
        ) : (
          <>
            {meta}
            {title}
            {image}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Show a color-coded name only when a single person owns the event; for shared
 * events (more than one subject) we show no person label at all. Includes its own
 * leading separator so the caller drops the dot when there's nothing to show.
 */
function Names({ subjects }: { subjects: TimelinePerson[] }) {
  if (subjects.length !== 1) return null;
  const s = subjects[0];
  return (
    <>
      <span className="text-muted-foreground/40">·</span>
      <span className={cn("font-medium uppercase tracking-wider", personColor(s.member_email).text)}>
        {firstName(s.name)}
      </span>
    </>
  );
}

/** The hover card: content, reflect action, related posts, and an overflow menu. */
function EntryPopover({
  entry: e,
  rect,
  onEnter,
  onLeave,
  onEdit,
  onDelete,
}: {
  entry: TimelineEntryWithPeople;
  rect: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const color = personColor(e.subjects[0]?.member_email);
  const Icon = CATEGORY_ICON[e.category];
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const W = 336;
  const axisY = rect.top + rect.height / 2;
  const left = Math.max(12, Math.min(rect.left - 16, vw - W - 12));
  const below = axisY + 360 < vh;
  const style: React.CSSProperties = below
    ? { left, top: axisY + 14 }
    : { left, bottom: vh - (axisY - 14) };

  return (
    <div
      className="fixed z-40 max-h-[72vh] w-[336px] overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-xl"
      style={style}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1", color.ring)}>
            <Icon className={cn(color.text, "h-4 w-4")} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="font-mono tabular-nums text-muted-foreground">{formatTimelineRange(e)}</span>
              <Names subjects={e.subjects} />
            </div>
            <h3 className="font-serif text-base leading-snug text-foreground">{e.title}</h3>
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>{CATEGORY_LABEL[e.category]}</span>
              {e.location && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <MapPin className="h-3 w-3" />
                  <span>{e.location}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <OverflowMenu onEdit={onEdit} onDelete={onDelete} />
      </div>

      <p className="mt-2.5 text-sm leading-relaxed text-foreground/90">{e.description}</p>

      <div className="mt-3">
        <ReflectOnEventButton
          timelineEntryId={e.id}
          label={e.linkedPosts.length > 0 ? "Reflect again" : "Reflect on this"}
        />
      </div>

      {e.linkedPosts.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <h4 className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Related posts
          </h4>
          <ul className="space-y-1">
            {e.linkedPosts.map((p) => (
              <li key={p.id}>
                <Link href={`/journal/${p.id}`} className="block rounded px-1 py-1 hover:bg-accent">
                  <div className="truncate text-sm text-foreground">
                    {p.title || p.summary || "Journal entry"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {[p.authorName, p.entry_date].filter(Boolean).join(" · ")}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function OverflowMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(ev: MouseEvent) {
      if (ref.current && !ref.current.contains(ev.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-border bg-background p-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit event
          </button>
          {confirming ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirming(false);
                onDelete();
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" /> Really delete?
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
