import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button-variants";
import { getIsParentOrOwner } from "@/lib/members/auth";
import {
  challengeEditHref,
  challengeNewHref,
  readingHomeHref,
} from "@/lib/reading/links";
import { listChallengesAdmin } from "./actions";

export const dynamic = "force-dynamic";

function fmtRange(start: string, end: string): string {
  const f = (d: string) =>
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
      new Date(`${d}T12:00:00`),
    );
  return `${f(start)} – ${f(end)}`;
}

export default async function ChallengesListPage() {
  if (!(await getIsParentOrOwner())) redirect("/reader");

  const items = await listChallengesAdmin();
  const active = items.filter((i) => i.challenge.status === "active");
  const archived = items.filter((i) => i.challenge.status === "archived");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">
          Reading challenges
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href={readingHomeHref(null)}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Back to reading
          </Link>
          <Link href={challengeNewHref()} className={buttonVariants()}>
            <Plus className="h-4 w-4" />
            New challenge
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          No challenges yet. Create one to reward a kid for the pages they read.
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          <ChallengeGroup heading="Active" items={active} />
          <ChallengeGroup heading="Archived" items={archived} muted />
        </div>
      )}
    </main>
  );
}

function ChallengeGroup({
  heading,
  items,
  muted = false,
}: {
  heading: string;
  items: Awaited<ReturnType<typeof listChallengesAdmin>>;
  muted?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {heading}
      </h2>
      <div className="divide-y divide-border rounded-lg border border-border">
        {items.map(({ challenge, kidName, progress }) => (
          <Link
            key={challenge.id}
            href={challengeEditHref(challenge.id)}
            className={cnRow(muted)}
          >
            <div className="min-w-0">
              <p className="truncate font-serif text-base text-foreground">
                {challenge.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {kidName ?? challenge.kid_email} · {fmtRange(challenge.start_date, challenge.end_date)}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {progress && (
                <span className="text-sm tabular-nums text-muted-foreground">
                  {progress.totalPages.toLocaleString()} /{" "}
                  {challenge.page_goal.toLocaleString()} pp · {progress.percent}%
                </span>
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function cnRow(muted: boolean): string {
  return [
    "flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent",
    muted ? "opacity-70" : "",
  ].join(" ");
}
