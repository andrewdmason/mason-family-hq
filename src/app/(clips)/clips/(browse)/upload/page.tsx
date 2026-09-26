import { UploadForm } from "@/components/clips/upload-form";
import { getClipKids, getRecentGames } from "@/lib/clips/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Upload" };

export default async function ClipsUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ kid?: string; game?: string }>;
}) {
  const { kid, game } = await searchParams;
  const [kids, games] = await Promise.all([getClipKids(), getRecentGames()]);
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6 sm:px-6">
      <h1 className="font-serif text-2xl tracking-tight text-foreground">Upload at-bats</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        One video per at-bat, straight off your phone.
      </p>
      <UploadForm kids={kids} games={games} initialKidSlug={kid} initialGameId={game} />
    </main>
  );
}
