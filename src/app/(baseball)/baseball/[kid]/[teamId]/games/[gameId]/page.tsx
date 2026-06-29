import { notFound } from "next/navigation";
import { getGame } from "@/lib/baseball/teams";
import { BoxScore } from "@/components/baseball/box-score";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: Promise<{ kid: string; teamId: string; gameId: string }> }) {
  const { kid, gameId } = await params;
  const detail = await getGame(gameId, kid);
  if (!detail) notFound();
  return <BoxScore kidSlug={kid} detail={detail} />;
}
