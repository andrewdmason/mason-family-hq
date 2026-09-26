import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Upload } from "lucide-react";
import { buttonVariants } from "@/components/ui/button-variants";
import { AtBatCard } from "@/components/clips/at-bat-card";
import { GameActions } from "@/components/clips/game-actions";
import { ProcessingRefresher } from "@/components/clips/processing-refresher";
import { formatGameDate } from "@/lib/clips/format";
import { isInFlight } from "@/lib/clips/types";
import { getClipKids, getGame } from "@/lib/clips/queries";

export const dynamic = "force-dynamic";

export default async function ClipsGamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  const [game, kids] = await Promise.all([getGame(gameId), getClipKids()]);
  if (!game) notFound();
  const kid = kids.find((k) => k.id === game.kidId);
  const busy = game.atBats.some(isInFlight);
  const marked = game.atBats.filter((ab) => ab.pitches.length > 0).length;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
      <ProcessingRefresher active={busy} />
      <Link
        href={kid ? `/clips?kid=${kid.slug}` : "/clips"}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Clips
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl tracking-tight text-foreground">{game.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {kid?.displayName.split(" ")[0]} · {formatGameDate(game.playedOn)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/clips/upload?game=${game.id}`} className={buttonVariants({ variant: "outline" })}>
            <Upload /> Add at-bats
          </Link>
          <GameActions game={game} kids={kids} canExport={marked > 0} />
        </div>
      </div>

      {game.atBats.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No at-bats uploaded yet.</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {game.atBats.map((ab, i) => (
            <AtBatCard key={ab.id} atBat={ab} index={i} />
          ))}
        </div>
      )}
    </main>
  );
}
