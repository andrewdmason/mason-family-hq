import Link from "next/link";
import { PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelineEntryWithPeople, TimelinePerson, TimelineProminence } from "@/lib/types";
import { personColor } from "@/lib/timeline/config";
import { decadeOf, formatTimelineRange, isUpcoming } from "@/lib/timeline/format";

type Side = "left" | "right";

const firstName = (name: string) => name.trim().split(/\s+/)[0];

/**
 * The lifetime line. Not a flat list: scale encodes importance (major moments are
 * large and photo-forward; minor ones compress to ticks on the line), every event
 * is owned by a person — their face rides the spine and their name + color identify
 * the card — and photos render as gently-tilted scrapbook images. Events alternate
 * sides of a central spine on wide screens; a single column on mobile.
 */
export function VerticalTimeline({
  entries,
  today,
  view,
}: {
  entries: TimelineEntryWithPeople[];
  today: string;
  view: "mine" | "family";
}) {
  if (entries.length === 0) {
    return (
      <p className="font-serif italic text-muted-foreground">
        {view === "mine" ? "No timeline events yet." : "No family timeline events yet."}
      </p>
    );
  }

  const rows = entries.map((e, i) => ({
    e,
    showDecade: i === 0 || decadeOf(e) !== decadeOf(entries[i - 1]),
    decade: decadeOf(e),
    side: (i % 2 === 0 ? "right" : "left") as Side,
  }));

  return (
    <div className="relative">
      {/* The spine — a soft gradient thread rather than a hard rule. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-6 w-px bg-gradient-to-b from-transparent via-border to-transparent md:left-1/2 md:-translate-x-px"
        aria-hidden
      />
      <ol className="space-y-8 md:space-y-10">
        {rows.map(({ e, showDecade, decade, side }) => (
          <li key={e.id}>
            {showDecade && <DecadeMarker decade={decade} />}
            <EntryRow entry={e} side={side} today={today} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function DecadeMarker({ decade }: { decade: string }) {
  return (
    <div className="relative mb-8 mt-12 flex justify-center first:mt-0">
      <span className="relative z-10 rounded-full border bg-background px-4 py-1 font-serif text-sm font-medium uppercase tracking-[0.25em] text-muted-foreground">
        {decade}
      </span>
    </div>
  );
}

function EntryRow({
  entry,
  side,
  today,
}: {
  entry: TimelineEntryWithPeople;
  side: Side;
  today: string;
}) {
  const subject = entry.subjects[0];

  return (
    <div className="relative pl-16 md:grid md:grid-cols-2 md:gap-x-16 md:pl-0">
      {/* The node rides the spine — the primary person's face for real moments,
          a small colored tick for minor ones. */}
      <div className="absolute left-6 top-1 z-10 -translate-x-1/2 md:left-1/2">
        <EntryNode subject={subject} prominence={entry.prominence} />
      </div>

      <div
        className={cn(
          side === "left"
            ? "md:col-start-1 md:row-start-1 md:flex md:justify-end"
            : "md:col-start-2 md:row-start-1"
        )}
      >
        <EntryCard entry={entry} side={side} today={today} />
      </div>
    </div>
  );
}

function EntryNode({
  subject,
  prominence,
}: {
  subject: TimelinePerson | undefined;
  prominence: TimelineProminence;
}) {
  const color = personColor(subject?.member_email);

  if (prominence === "minor" || !subject?.avatarUrl) {
    return (
      <span
        className={cn(
          "block rounded-full ring-2 ring-background",
          color.dot,
          prominence === "minor" ? "h-3 w-3" : prominence === "medium" ? "h-4 w-4" : "h-5 w-5"
        )}
        aria-hidden
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={subject.avatarUrl}
      alt={subject.name}
      className={cn(
        "rounded-full object-cover ring-2 ring-offset-2 ring-offset-background",
        color.ring,
        prominence === "major" ? "h-11 w-11" : "h-8 w-8"
      )}
    />
  );
}

function EntryCard({
  entry: e,
  side,
  today,
}: {
  entry: TimelineEntryWithPeople;
  side: Side;
  today: string;
}) {
  const upcoming = isUpcoming(e, today);
  const tilt = side === "left" ? "-rotate-1" : "rotate-1";
  const major = e.prominence === "major";
  const minor = e.prominence === "minor";

  // Minor events read as a single compact line — a tick of texture between the
  // big moments, not a full card.
  if (minor) {
    return (
      <Link
        href={`/timeline/${e.id}`}
        className="group/card flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5"
      >
        <time className={cn("text-[11px] font-medium tabular-nums", personColor(e.subjects[0]?.member_email).text)}>
          {formatTimelineRange(e)}
        </time>
        <span className="text-sm font-medium text-foreground/90 decoration-1 underline-offset-2 group-hover/card:underline">
          {e.title}
        </span>
        <PeopleStack subjects={e.subjects} size="h-4 w-4 text-[8px]" />
      </Link>
    );
  }

  return (
    <Link href={`/timeline/${e.id}`} className="group/card block w-full md:max-w-sm">
      {/* Photo-forward for major moments: the image leads. */}
      {major && e.coverPhotoUrl && (
        <CoverImage url={e.coverPhotoUrl} alt={e.title} tilt={tilt} upcoming={upcoming} className="aspect-[4/3]" />
      )}

      <div className={cn(major && e.coverPhotoUrl && "mt-4")}>
        <MetaRow entry={e} upcoming={upcoming} />
        <h3
          className={cn(
            "mt-1 font-serif tracking-tight text-foreground decoration-1 underline-offset-4 group-hover/card:underline",
            major ? "text-2xl leading-tight" : "text-lg leading-snug",
            upcoming && "text-muted-foreground"
          )}
        >
          {e.title}
        </h3>

        {/* Medium moments carry a smaller image below the title. */}
        {!major && e.coverPhotoUrl && (
          <CoverImage
            url={e.coverPhotoUrl}
            alt={e.title}
            tilt={tilt}
            upcoming={upcoming}
            className="mt-3 aspect-[3/2] max-w-[16rem]"
          />
        )}

        <p
          className={cn(
            "mt-2 text-sm leading-relaxed text-muted-foreground",
            !major && "line-clamp-2"
          )}
        >
          {e.description}
        </p>
      </div>
    </Link>
  );
}

function CoverImage({
  url,
  alt,
  tilt,
  upcoming,
  className,
}: {
  url: string;
  alt: string;
  tilt: string;
  upcoming: boolean;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className={cn(
        "w-full rounded-2xl object-cover shadow-sm ring-1 ring-black/5 transition-transform duration-300 group-hover/card:rotate-0",
        tilt,
        upcoming && "opacity-80",
        className
      )}
    />
  );
}

function MetaRow({
  entry: e,
  upcoming,
}: {
  entry: TimelineEntryWithPeople;
  upcoming: boolean;
}) {
  const color = personColor(e.subjects[0]?.member_email);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <PeopleStack subjects={e.subjects} size="h-5 w-5 text-[9px]" />
      <Names subjects={e.subjects} />
      <span className="text-muted-foreground/40">·</span>
      <time className={cn("font-medium", color.text)}>{formatTimelineRange(e)}</time>
      {upcoming && (
        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Upcoming
        </span>
      )}
      {e.linkedCount > 0 && (
        <span className="inline-flex items-center gap-0.5 text-muted-foreground">
          <PenLine className="h-3 w-3" />
          {e.linkedCount}
        </span>
      )}
    </div>
  );
}

/** Overlapping subject avatars, color-ringed per person. */
function PeopleStack({ subjects, size }: { subjects: TimelinePerson[]; size: string }) {
  if (subjects.length === 0) return null;
  return (
    <div className="flex -space-x-1.5">
      {subjects.map((s) => {
        const color = personColor(s.member_email);
        return s.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={s.id}
            src={s.avatarUrl}
            alt={s.name}
            className={cn("rounded-full object-cover ring-2 ring-background", size)}
          />
        ) : (
          <span
            key={s.id}
            className={cn(
              "inline-flex items-center justify-center rounded-full font-semibold text-white ring-2 ring-background",
              color.dot,
              size
            )}
          >
            {s.name.charAt(0).toUpperCase()}
          </span>
        );
      })}
    </div>
  );
}

/** Subject first names — colored when it's one person, neutral when shared. */
function Names({ subjects }: { subjects: TimelinePerson[] }) {
  if (subjects.length === 0) return null;
  const color = personColor(subjects[0].member_email);
  const label = subjects.map((s) => firstName(s.name)).join(", ");
  return (
    <span className={cn("font-medium", subjects.length === 1 ? color.text : "text-foreground/80")}>
      {label}
    </span>
  );
}
