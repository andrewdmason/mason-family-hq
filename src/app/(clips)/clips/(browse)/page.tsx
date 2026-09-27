import Link from "next/link";
import { Clapperboard, Upload } from "lucide-react";
import { buttonVariants } from "@/components/ui/button-variants";
import { AtBatCard } from "@/components/clips/at-bat-card";
import { ProcessingRefresher } from "@/components/clips/processing-refresher";
import { formatGameDate } from "@/lib/clips/format";
import { isInFlight } from "@/lib/clips/types";
import { getClipKids, getFeed } from "@/lib/clips/queries";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function ClipsFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ kid?: string }>;
}) {
  const { kid: kidSlug } = await searchParams;
  const kids = await getClipKids();
  const kid = kids.find((k) => k.slug === kidSlug);
  const games = await getFeed(kid?.id);
  const kidName = new Map(kids.map((k) => [k.id, k.displayName.split(" ")[0]]));
  const busy = games.some((g) =>
    g.atBats.some(isInFlight),
  );

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
      <ProcessingRefresher active={busy} />
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">Baseball Clips</h1>
        <Link
          href={kid ? `/clips/upload?kid=${kid.slug}` : "/clips/upload"}
          className={buttonVariants({ size: "lg" })}
        >
          <Upload /> Upload
        </Link>
      </div>

      <nav className="mt-4 flex gap-1.5">
        {[{ slug: undefined, label: "All" }, ...kids.map((k) => ({ slug: k.slug, label: k.displayName.split(" ")[0] }))].map(
          (tab) => {
            const active = tab.slug === kid?.slug;
            return (
              <Link
                key={tab.label}
                href={tab.slug ? `/clips?kid=${tab.slug}` : "/clips"}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          },
        )}
      </nav>

      {games.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <Clapperboard className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No at-bats yet. Upload videos straight off your phone — one video per at-bat.
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          {games.map((game) => (
            <section key={game.id}>
              <div className="mb-2.5 flex items-baseline justify-between gap-3">
                <Link href={`/clips/game/${game.id}`} className="min-w-0 hover:underline">
                  <h2 className="truncate font-serif text-lg text-foreground">{game.name}</h2>
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {!kid && `${kidName.get(game.kidId) ?? ""} · `}
                  {formatGameDate(game.playedOn)}
                </span>
              </div>
              {game.atBats.length === 0 ? (
                <p className="text-sm text-muted-foreground">No at-bats uploaded.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {game.atBats.map((ab, i) => (
                    <AtBatCard key={ab.id} atBat={ab} index={i} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
