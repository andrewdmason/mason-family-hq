"use client";

import { SlidersHorizontal, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { RATING_OPTIONS } from "@/components/reading/rating-picker";
import { READING_GENRES, type ReadingGenre } from "@/lib/reading/book-genres";
import {
  FICTION_OPTIONS,
  GROUP_BY_OPTIONS,
  activeFilterCount,
  defaultView,
  isDefaultView,
  type ShelfGroupBy,
  type ShelfRating,
  type ShelfView,
} from "@/lib/reading/shelf-view";
import { cn } from "@/lib/utils";
import type { ReadingBookStatus } from "@/lib/types";

/**
 * The shelf's display options: how to group it, what to hide, what you typed.
 *
 * One popover rather than a row of controls above the covers, because the shelf
 * is meant to look like a bookshelf — the moment you add a segmented control, a
 * genre dropdown and a search box to the page, the books stop being the thing you
 * see first. Everything lives behind one button until you want it.
 *
 * Only genres and ratings actually present on the current tab are offered, with
 * counts, so you never tap a filter that empties the shelf.
 */
export function ShelfDisplayMenu({
  view,
  onChange,
  tab,
  genreCounts,
  ratingCounts,
  showGrouping = true,
}: {
  view: ShelfView;
  onChange: (next: ShelfView) => void;
  tab: ReadingBookStatus;
  genreCounts: Map<string, number>;
  ratingCounts: Map<string, number>;
  /** False where the tab's order is the reader's own — the ranked Queue. */
  showGrouping?: boolean;
}) {
  const filterCount = activeFilterCount(view);
  const touched = !isDefaultView(view, tab);

  const set = <K extends keyof ShelfView>(key: K, value: ShelfView[K]) =>
    onChange({ ...view, [key]: value });

  const toggle = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const genres = READING_GENRES.filter((g) => (genreCounts.get(g.value) ?? 0) > 0);
  const ratings = (
    [
      { value: "unrated" as ShelfRating, label: "Unrated", glyph: "" },
      ...RATING_OPTIONS.map((o) => ({
        value: o.value as ShelfRating,
        label: o.label,
        glyph: o.emoji ?? o.chip ?? "",
      })),
    ] satisfies { value: ShelfRating; label: string; glyph: string }[]
  ).filter((r) => (ratingCounts.get(r.value) ?? 0) > 0);

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Display options"
        className={cn(
          "ml-auto flex h-7 w-7 items-center justify-center rounded-full transition-colors",
          touched
            ? "bg-foreground text-background"
            : "bg-muted/70 text-muted-foreground hover:text-foreground"
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        {filterCount > 0 && <span className="sr-only">{filterCount} filters</span>}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 gap-0 p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-xs font-medium text-muted-foreground">
            Display
          </span>
          {touched && (
            <button
              type="button"
              onClick={() => onChange(defaultView(tab))}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Reset
            </button>
          )}
        </div>

        {showGrouping && (
          <Section>
            <Row label="Grouping">
              <select
                value={view.groupBy}
                onChange={(e) => set("groupBy", e.target.value as ShelfGroupBy)}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {GROUP_BY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Row>
          </Section>
        )}

        <Section>
          <Row label="Fiction">
            <div className="inline-flex rounded-lg bg-muted/60 p-0.5">
              {FICTION_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => set("fiction", o.value)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
                    view.fiction === o.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Row>

          {genres.length > 0 && (
            <Group label="Genre">
              {genres.map((g) => (
                <Chip
                  key={g.value}
                  active={view.genres.includes(g.value)}
                  count={genreCounts.get(g.value) ?? 0}
                  onClick={() =>
                    set("genres", toggle<ReadingGenre>(view.genres, g.value))
                  }
                >
                  {g.label}
                </Chip>
              ))}
            </Group>
          )}

          {ratings.length > 0 && (
            <Group label="Rating">
              {ratings.map((r) => (
                <Chip
                  key={r.value}
                  active={view.ratings.includes(r.value)}
                  count={ratingCounts.get(r.value) ?? 0}
                  onClick={() =>
                    set("ratings", toggle<ShelfRating>(view.ratings, r.value))
                  }
                >
                  {r.glyph ? `${r.glyph} ${r.label}` : r.label}
                </Chip>
              ))}
            </Group>
          )}
        </Section>

        <div className="p-3">
          <div className="relative">
            <Input
              value={view.query}
              onChange={(e) => set("query", e.target.value)}
              placeholder="Title or author"
              className="h-8 pr-7 text-xs"
            />
            {view.query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => set("query", "")}
                className="absolute inset-y-0 right-2 flex items-center text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-border px-3 py-3">
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Chip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "bg-muted/70 text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
      <span className="ml-1 tabular-nums opacity-70">{count}</span>
    </button>
  );
}
