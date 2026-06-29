import { notFound } from "next/navigation";
import { getSeason } from "@/lib/baseball/teams";
import { SeasonView } from "@/components/baseball/season-view";

export const dynamic = "force-dynamic";

export default async function SeasonPage({ params }: { params: Promise<{ kid: string; teamId: string }> }) {
  const { kid, teamId } = await params;
  const detail = await getSeason(teamId, kid);
  if (!detail) notFound();
  return <SeasonView kidSlug={kid} detail={detail} />;
}
