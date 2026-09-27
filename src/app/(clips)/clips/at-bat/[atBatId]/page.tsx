import { notFound } from "next/navigation";
import { AtBatPlayer } from "@/components/clips/player/at-bat-player";
import { getAtBat, getGame } from "@/lib/clips/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "At-bat" };

export default async function AtBatPage({ params }: { params: Promise<{ atBatId: string }> }) {
  const { atBatId } = await params;
  const atBat = await getAtBat(atBatId);
  if (!atBat) notFound();
  const game = await getGame(atBat.gameId);
  if (!game) notFound();
  const index = game.atBats.findIndex((ab) => ab.id === atBat.id);

  return (
    <AtBatPlayer
      // Remount per at-bat so moving between at-bats starts clean.
      key={atBat.id}
      atBat={atBat}
      game={{ id: game.id, name: game.name }}
      index={index}
      count={game.atBats.length}
      prevId={game.atBats[index - 1]?.id ?? null}
      nextId={game.atBats[index + 1]?.id ?? null}
    />
  );
}
