import Link from "next/link";
import { CircleDot } from "lucide-react";
import { getKids } from "@/lib/baseball/people";

export const dynamic = "force-dynamic";

export default async function BaseballHome() {
  const kids = await getKids();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <h1 className="font-serif text-2xl tracking-tight text-foreground">Baseball</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Season-by-season stats, imported from GameChanger.
      </p>

      {kids.length === 0 ? (
        <p className="mt-10 rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          No seasons imported yet. Run the importer to bring in a season
          (see <code className="font-mono">docs/baseball-import-runbook.md</code>).
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {kids.map((kid) => (
            <Link
              key={kid.slug}
              href={`/baseball/${kid.slug}`}
              className="group flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-6 transition-colors hover:border-foreground/30 hover:bg-accent"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-foreground group-hover:bg-background">
                <CircleDot className="h-6 w-6" />
              </span>
              <span className="flex flex-col">
                <span className="font-serif text-lg text-foreground">{kid.displayName}</span>
                <span className="text-xs text-muted-foreground">View career stats</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
