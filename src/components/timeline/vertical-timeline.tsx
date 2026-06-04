"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Award,
  Baby,
  Blocks,
  Briefcase,
  GraduationCap,
  Heart,
  HeartPulse,
  Home,
  ImagePlus,
  ListFilter,
  Loader2,
  MapPin,
  MessageSquareText,
  MoreHorizontal,
  Music,
  Pencil,
  Plane,
  Plus,
  Trash2,
  Users,
  X,
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
import { deleteTimelineEntry, deleteTimelinePhoto } from "@/lib/timeline/actions";
import { MAX_UPLOAD_BYTES, detectMediaType, uploadTimelineMedia } from "@/lib/journal/photo-upload";

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
const PHOTO_W = 236; // px — photos run wider than the column so busy stretches overlap, pinboard-style
const PX_PER_YEAR = 46;
const GAP_OFFSET = 34; // pulled in so close-in-time events still stagger, but less aggressively
const MIN_GAP = -16; // cap on how much neighbors may overlap
const MAX_GAP = 240;
const AXIS_OFFSET = 16; // px the content sits above/below the axis, clearing the icons
const TRACK_H = 730; // px — the content band; the scroller centers it vertically
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const firstName = (name: string) => name.trim().split(/\s+/)[0];

const IMG_H: Record<TimelineProminence, number> = { major: 256, medium: 200, minor: 152 };

/** A stable small tilt (deg) per entry, so prints look scattered on a pinboard. */
function tiltFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 700) / 100 - 3.5; // -3.5° .. +3.5°
}
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

  // Empty = no filter on that axis (show all). Selecting pills narrows down to
  // those values: OR within a section, AND across sections (Linear-style).
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(() => new Set());
  const [selectedCats, setSelectedCats] = useState<Set<string>>(() => new Set());
  // "Shared only" keeps just the family milestones (2+ subjects), hiding any
  // single-person event — the inverse of what `Names` labels with a person.
  const [sharedOnly, setSharedOnly] = useState(false);

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

  // Click-activated popover (opened from an entry's title), a full-size photo
  // lightbox, and the edit modal. The popover no longer opens on hover.
  const router = useRouter();
  const [hovered, setHovered] = useState<{ entry: TimelineEntryWithPeople; rect: DOMRect } | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [editing, setEditing] = useState<TimelineEntryWithPeople | null>(null);
  const [creating, setCreating] = useState(false);

  function showPopover(entry: TimelineEntryWithPeople, el: HTMLElement) {
    setHovered({ entry, rect: el.getBoundingClientRect() });
  }
  function closeNow() {
    setHovered(null);
  }

  // The popover is anchored (not hover-tracked), so close it on an outside click
  // or Escape. Clicks on a title or inside the popover itself are ignored.
  useEffect(() => {
    if (!hovered) return;
    function onDown(ev: MouseEvent) {
      const t = ev.target as Element | null;
      if (t?.closest("[data-timeline-popover]") || t?.closest("[data-timeline-title]")) return;
      setHovered(null);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setHovered(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [hovered]);

  async function handleDelete(id: string) {
    closeNow();
    try {
      await deleteTimelineEntry(id);
      router.refresh();
    } catch {
      /* leave the row if the delete failed */
    }
  }

  // Drop photos on an event → pin them directly to it (no journal post); they
  // become part of the event's photos and its cover after refresh.
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  async function addPhotosToEvent(timelineEntryId: string, files: File[]) {
    const valid = files.filter((f) => detectMediaType(f) && f.size <= MAX_UPLOAD_BYTES);
    if (valid.length === 0) return;
    setUploadingId(timelineEntryId);
    try {
      await Promise.all(valid.map((f) => uploadTimelineMedia(timelineEntryId, f)));
      router.refresh();
    } catch (err) {
      console.error("[timeline] photo upload failed", err);
    } finally {
      setUploadingId(null);
    }
  }

  async function removePhoto(photoId: string) {
    try {
      await deleteTimelinePhoto(photoId);
      router.refresh();
    } catch (err) {
      console.error("[timeline] photo delete failed", err);
    }
  }

  // Swallow file drops outside a target so the browser doesn't navigate to them
  // (preventing default on dragover is also what enables dropping at all).
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  const filtered = entries.filter((e) => {
    if (sharedOnly && e.subjects.length < 2) return false;
    if (selectedCats.size > 0 && !selectedCats.has(e.category)) return false;
    if (selectedPeople.size > 0) {
      const subjectEmails = e.subjects.map((s) => s.member_email?.toLowerCase()).filter(Boolean) as string[];
      if (!subjectEmails.some((em) => selectedPeople.has(em))) return false;
    }
    return true;
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
      {/* Filter + New entry in the reading column (the nav already labels this page). */}
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="flex items-center justify-between gap-4">
          <FilterPopover
            people={people}
            categories={categories}
            selectedPeople={selectedPeople}
            selectedCats={selectedCats}
            sharedOnly={sharedOnly}
            onTogglePerson={(email) => toggle(selectedPeople, email, setSelectedPeople)}
            onToggleCategory={(cat) => toggle(selectedCats, cat, setSelectedCats)}
            onToggleSharedOnly={() => setSharedOnly((v) => !v)}
            onClear={() => {
              setSelectedPeople(new Set());
              setSelectedCats(new Set());
              setSharedOnly(false);
            }}
          />
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New entry
          </button>
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
                  onActivate={(el) => showPopover(item.e, el)}
                  onOpenPhoto={(src) => setLightboxSrc(src)}
                  onAddPhotos={(files) => addPhotosToEvent(item.e.id, files)}
                  uploading={uploadingId === item.e.id}
                />
              );
            })
          )}
        </div>
      </div>

      {hovered && (
        <EntryPopover
          // Read the live entry by id so the photo gallery reflects adds/removes
          // after router.refresh() (the hovered snapshot would otherwise be stale).
          entry={entries.find((x) => x.id === hovered.entry.id) ?? hovered.entry}
          rect={hovered.rect}
          uploading={uploadingId === hovered.entry.id}
          onEdit={() => {
            setEditing(hovered.entry);
            closeNow();
          }}
          onDelete={() => handleDelete(hovered.entry.id)}
          onAddPhotos={(files) => addPhotosToEvent(hovered.entry.id, files)}
          onRemovePhoto={removePhoto}
          onOpenPhoto={(src) => setLightboxSrc(src)}
        />
      )}
      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
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

/**
 * A single Linear-style filter popover with People and Categories sections.
 * Each section is a flow of toggle pills (Linear's "Display properties"); nothing
 * is selected by default, and selecting pills narrows the timeline to those values.
 */
function FilterPopover({
  people,
  categories,
  selectedPeople,
  selectedCats,
  sharedOnly,
  onTogglePerson,
  onToggleCategory,
  onToggleSharedOnly,
  onClear,
}: {
  people: { email: string; name: string }[];
  categories: TimelineCategory[];
  selectedPeople: Set<string>;
  selectedCats: Set<string>;
  sharedOnly: boolean;
  onTogglePerson: (email: string) => void;
  onToggleCategory: (cat: TimelineCategory) => void;
  onToggleSharedOnly: () => void;
  onClear: () => void;
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

  const activeCount = selectedPeople.size + selectedCats.size + (sharedOnly ? 1 : 0);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition",
          activeCount > 0
            ? "border-foreground/20 bg-accent text-foreground"
            : "border-border bg-background text-foreground/80 hover:bg-accent"
        )}
      >
        <ListFilter className="h-3.5 w-3.5" />
        Filter
        {activeCount > 0 && (
          <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-foreground px-1 text-[10px] font-semibold tabular-nums text-background">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-lg border border-border bg-background p-3 shadow-xl">
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Filter
            </span>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>

          <FilterSection label="Scope">
            <FilterPill
              selected={sharedOnly}
              onClick={onToggleSharedOnly}
              leading={<Users className={cn("h-3.5 w-3.5 shrink-0", sharedOnly ? "text-background" : "text-muted-foreground")} />}
            >
              Shared only
            </FilterPill>
          </FilterSection>

          <FilterSection label="People">
            {people.map((p) => (
              <FilterPill
                key={p.email}
                selected={selectedPeople.has(p.email)}
                onClick={() => onTogglePerson(p.email)}
                leading={<span className={cn("h-2 w-2 shrink-0 rounded-full", personColor(p.email).dot)} />}
              >
                {p.name}
              </FilterPill>
            ))}
          </FilterSection>

          <FilterSection label="Categories">
            {categories.map((c) => {
              const Icon = CATEGORY_ICON[c];
              const selected = selectedCats.has(c);
              return (
                <FilterPill
                  key={c}
                  selected={selected}
                  onClick={() => onToggleCategory(c)}
                  leading={
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", selected ? "text-background" : "text-muted-foreground")} />
                  }
                >
                  {CATEGORY_LABEL[c]}
                </FilterPill>
              );
            })}
          </FilterSection>
        </div>
      )}
    </div>
  );
}

function FilterSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function FilterPill({
  selected,
  onClick,
  leading,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  leading: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {leading}
      {children}
    </button>
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
  onActivate,
  onOpenPhoto,
  onAddPhotos,
  uploading,
}: {
  entry: TimelineEntryWithPeople;
  gap: number;
  row: 0 | 1;
  upcoming: boolean;
  onActivate: (el: HTMLElement) => void;
  onOpenPhoto: (src: string) => void;
  onAddPhotos: (files: File[]) => void;
  uploading: boolean;
}) {
  const top = row === 0;
  const color = personColor(e.subjects[0]?.member_email);
  const imgH = IMG_H[e.prominence];
  const showImage = !!e.coverPhotoUrl && imgH > 0;
  const Icon = CATEGORY_ICON[e.category];
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

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
    <button
      type="button"
      data-timeline-title
      onClick={(ev) => {
        ev.stopPropagation();
        if (rootRef.current) onActivate(rootRef.current);
      }}
      className={cn(
        TITLE[e.prominence],
        "line-clamp-2 cursor-pointer text-left leading-snug hover:underline"
      )}
    >
      {e.title}
    </button>
  );

  const image = showImage ? (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        onOpenPhoto(e.coverPhotoUrl!);
      }}
      aria-label="View photo"
      style={{ transform: `rotate(${tiltFor(e.id)}deg)` }}
      className={cn(
        "block shrink-0 cursor-zoom-in border-0 bg-transparent p-0",
        // Breathing room between the print and the caption (which sits below it on
        // the top row, above it on the bottom row).
        top ? "mb-4" : "mt-4"
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={e.coverPhotoUrl!}
        alt=""
        style={{ height: `${imgH}px`, width: `${PHOTO_W}px` }}
        className={cn(
          "block max-w-none rounded-[2px] border-[6px] border-white bg-white object-cover shadow-[0_5px_18px_rgba(0,0,0,0.2)] ring-1 ring-black/10 transition-shadow duration-200 group-hover:shadow-[0_12px_34px_rgba(0,0,0,0.3)]",
          upcoming && "opacity-70"
        )}
      />
    </button>
  ) : null;

  return (
    <div
      ref={rootRef}
      onDragEnter={(ev) => {
        if (ev.dataTransfer?.types?.includes("Files")) {
          ev.preventDefault();
          setDragOver(true);
        }
      }}
      onDragOver={(ev) => ev.preventDefault()}
      onDragLeave={(ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(ev) => {
        ev.preventDefault();
        setDragOver(false);
        const files = Array.from(ev.dataTransfer?.files ?? []);
        if (files.length) onAddPhotos(files);
      }}
      className="group relative z-10 h-full shrink-0 hover:z-20"
      style={{ width: `${COL_W}px`, marginLeft: `${gap}px` }}
    >
      {/* The datum at the LEFT edge, on the axis: the category's icon, colored
          to the person. */}
      <span className="absolute left-0 top-1/2 z-10 -translate-y-1/2" aria-hidden>
        <span
          className={cn(
            "flex items-center justify-center rounded-full bg-background ring-1 transition-all",
            dragOver ? "scale-110 ring-2 ring-primary" : color.ring,
            ICON_BOX[e.prominence],
            upcoming && !dragOver && "opacity-40"
          )}
        >
          {uploading ? (
            <Loader2 className={cn("animate-spin text-primary", ICON_SIZE[e.prominence])} />
          ) : dragOver ? (
            <ImagePlus className={cn("text-primary", ICON_SIZE[e.prominence])} />
          ) : (
            <Icon className={cn(color.text, ICON_SIZE[e.prominence])} strokeWidth={2} />
          )}
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
  uploading,
  onEdit,
  onDelete,
  onAddPhotos,
  onRemovePhoto,
  onOpenPhoto,
}: {
  entry: TimelineEntryWithPeople;
  rect: DOMRect;
  uploading: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAddPhotos: (files: File[]) => void;
  onRemovePhoto: (photoId: string) => void;
  onOpenPhoto: (src: string) => void;
}) {
  const color = personColor(e.subjects[0]?.member_email);
  const Icon = CATEGORY_ICON[e.category];
  const fileInputRef = useRef<HTMLInputElement>(null);
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
      data-timeline-popover
      className="fixed z-40 max-h-[72vh] w-[336px] overflow-y-auto rounded-xl border border-border bg-background p-4 shadow-xl"
      style={style}
      onDragOver={(ev) => ev.preventDefault()}
      onDrop={(ev) => {
        ev.preventDefault();
        const files = Array.from(ev.dataTransfer?.files ?? []);
        if (files.length) onAddPhotos(files);
      }}
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

      {e.photos.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {e.photos.map((photo) => (
            <div key={photo.id} className="group/photo relative aspect-square overflow-hidden rounded-md bg-muted">
              <button
                type="button"
                onClick={() => onOpenPhoto(photo.displayUrl)}
                aria-label="View photo"
                className="block h-full w-full cursor-zoom-in"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.displayUrl} alt="" className="h-full w-full object-cover" />
              </button>
              <button
                type="button"
                onClick={() => onRemovePhoto(photo.id)}
                aria-label="Remove photo"
                className="absolute right-1 top-1 hidden rounded-full bg-black/60 p-0.5 text-white transition group-hover/photo:block hover:bg-black/80"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <ReflectOnEventButton
          timelineEntryId={e.id}
          label={e.linkedPosts.length > 0 ? "Reflect again" : "Reflect on this"}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground/80 hover:bg-accent disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {uploading ? "Adding…" : "Add photo"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(ev) => {
            const files = Array.from(ev.target.files ?? []);
            ev.target.value = "";
            if (files.length) onAddPhotos(files);
          }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">Or drop a photo on the event to attach it.</p>

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

/** A full-screen modal showing a single photo at its natural size. */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        onClick={(ev) => ev.stopPropagation()}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
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
