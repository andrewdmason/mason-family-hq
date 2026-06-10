// Streams the app shell (header included) the moment middleware clears and
// holds the content area while the page's data queries run — without this
// boundary, force-dynamic pages leave the old view frozen until the server
// answers, which on a real network reads as a dead click. Unlike the generic
// page-loading.tsx, this mirrors the todos two-column frame (sidebar rail +
// list) so switching views doesn't jolt.
export default function TodosLoading() {
  return (
    <main
      aria-busy
      className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6"
    >
      <div className="md:flex md:gap-8">
        {/* Desktop sidebar rail */}
        <div className="hidden w-52 shrink-0 md:block">
          <div className="space-y-2 pt-1">
            {[70, 60, 65, 55, 60, 50, 55].map((opacity, i) => (
              <div
                key={i}
                className="h-7 animate-pulse rounded-lg bg-muted"
                style={{ opacity: opacity / 100 }}
              />
            ))}
          </div>
        </div>

        {/* Mobile pills */}
        <div className="-mx-4 mb-4 flex gap-1.5 overflow-hidden px-4 md:hidden">
          {[24, 20, 24, 24].map((w, i) => (
            <div
              key={i}
              className="h-8 shrink-0 animate-pulse rounded-full bg-muted/50"
              style={{ width: `${w * 4}px` }}
            />
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="h-8 w-32 animate-pulse rounded-md bg-muted/70" />
            <div className="h-7 w-16 animate-pulse rounded-md bg-muted/50" />
          </div>
          <div className="space-y-1.5">
            <div className="h-9 animate-pulse rounded-lg bg-muted/60" />
            <div className="h-9 animate-pulse rounded-lg bg-muted/50" />
            <div className="h-9 animate-pulse rounded-lg bg-muted/40" />
            <div className="h-9 animate-pulse rounded-lg bg-muted/30" />
            <div className="h-9 animate-pulse rounded-lg bg-muted/20" />
          </div>
        </div>
      </div>
    </main>
  );
}
