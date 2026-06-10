// The shared loading.tsx fallback for every app's route group. With a loading
// boundary in place, Next streams the layout shell (header included) the moment
// middleware clears, and this skeleton holds the content area while the page's
// data queries run — instead of the whole screen staying blank until the
// slowest query finishes. Deliberately generic: a title bar and a few card
// ghosts read as "loading" in every app without mimicking any one of them.
export default function PageLoading() {
  return (
    <div aria-busy className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <div className="h-7 w-40 animate-pulse rounded-md bg-muted/70" />
      <div className="mt-6 space-y-3">
        <div className="h-24 animate-pulse rounded-xl bg-muted/60" />
        <div className="h-24 animate-pulse rounded-xl bg-muted/50" />
        <div className="h-24 animate-pulse rounded-xl bg-muted/40" />
      </div>
    </div>
  );
}
