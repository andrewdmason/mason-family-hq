// Calendar's content skeleton. The global header (app switcher) streams its own
// shell from the layout, so this only fills the area under it — but shaped like a
// calendar grid rather than the generic card ghosts in page-loading.tsx, so the
// load phase reads as "the calendar is here, events are filling in" instead of a
// blank panel. Holds the space until the page's event queries resolve.
//
// Deliberately view-agnostic (a weekday strip + a column grid with a few event
// ghosts reads as "calendar" whether you land on day/week/month). The toolbar
// itself lives in the header and is injected by the client component once it
// mounts, so there's nothing to mimic for it here.

const COLUMNS = 7;
const ROWS = 6;

// A sparse, deterministic scatter of "events" so the grid doesn't read as empty.
// Keyed by `${row}-${col}`; the value is a width fraction for the ghost bar.
const EVENTS: Record<string, string> = {
  "0-1": "w-3/4",
  "1-3": "w-1/2",
  "1-5": "w-2/3",
  "2-0": "w-2/3",
  "3-2": "w-3/4",
  "3-6": "w-1/2",
  "4-4": "w-2/3",
};

export default function CalendarLoading() {
  return (
    <div
      aria-busy
      className="mx-auto w-full max-w-5xl flex-1 px-4 pb-12 pt-4 sm:px-6"
    >
      {/* Weekday header strip */}
      <div className="grid grid-cols-7 gap-px">
        {Array.from({ length: COLUMNS }, (_, c) => (
          <div key={c} className="flex justify-center py-2">
            <div className="h-3 w-8 animate-pulse rounded bg-muted/70" />
          </div>
        ))}
      </div>

      {/* Day grid with a few faint event ghosts */}
      <div className="mt-1 grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-border/60">
        {Array.from({ length: ROWS * COLUMNS }, (_, i) => {
          const row = Math.floor(i / COLUMNS);
          const col = i % COLUMNS;
          const event = EVENTS[`${row}-${col}`];
          return (
            <div key={i} className="min-h-16 bg-background p-1.5 sm:min-h-20">
              {event && (
                <div
                  className={`h-4 ${event} animate-pulse rounded bg-muted/60`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
