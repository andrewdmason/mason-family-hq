// Workouts' content skeleton. The global header (app switcher) streams its own
// shell from the layout; this fills the area under it shaped like the Workouts
// frame — title + tab bar, then a couple of session-block cards — so a cold
// launch or a tab switch reads as "the workout is here, sets are filling in"
// instead of the generic card ghosts in page-loading.tsx. The Workouts title and
// tabs live inside the page (WorkoutsHeader), not the layout, so they vanish
// during loading and are mirrored here too. Holds the space until the page's
// session queries resolve.

// Faint "set" rows inside a block card; the widths vary so it doesn't read as a
// uniform table.
const SET_ROWS = ["w-2/3", "w-1/2", "w-3/4", "w-2/5"];

function BlockCard() {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="h-5 w-40 animate-pulse rounded bg-muted/70" />
      <div className="mt-4 space-y-2.5">
        {SET_ROWS.map((w, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <div className={`h-4 ${w} animate-pulse rounded bg-muted/50`} />
            <div className="h-4 w-12 animate-pulse rounded bg-muted/40" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WorkoutsLoading() {
  return (
    <main
      aria-busy
      className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6"
    >
      {/* Title row: "Workouts" + the Log-a-workout button */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="h-8 w-32 animate-pulse rounded-md bg-muted/70" />
        <div className="h-9 w-32 animate-pulse rounded-md bg-muted/50" />
      </div>

      {/* Tab bar */}
      <div className="mb-5 flex gap-1 border-b border-border">
        {[14, 20, 10, 16].map((w, i) => (
          <div key={i} className="px-3 py-2">
            <div
              className="h-4 animate-pulse rounded bg-muted/60"
              style={{ width: `${w * 4}px` }}
            />
          </div>
        ))}
      </div>

      {/* Today's session: a couple of block cards */}
      <div className="space-y-4">
        <BlockCard />
        <BlockCard />
      </div>
    </main>
  );
}
