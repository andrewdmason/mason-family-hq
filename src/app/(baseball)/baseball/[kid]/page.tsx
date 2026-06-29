import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCareer } from "@/lib/baseball/teams";
import { CareerView } from "@/components/baseball/career-view";

export const dynamic = "force-dynamic";

export default async function CareerPage({ params }: { params: Promise<{ kid: string }> }) {
  const { kid } = await params;
  const career = await getCareer(kid);
  if (!career) notFound();

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <Link href="/baseball" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Players
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">{career.name}</h1>
        <span className="text-sm text-muted-foreground">
          {career.seasons.length} team{career.seasons.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-5">
        <CareerView kidSlug={kid} career={career} />
      </div>
    </main>
  );
}
