import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getIsAdult } from "@/lib/members/auth";
import { TriviaGenerator } from "@/components/games/trivia-generator";
import { loadBatchSummaries } from "./actions";

export const dynamic = "force-dynamic";

export default async function TriviaGeneratePage() {
  if (!(await getIsAdult())) redirect("/games/trivia");
  const batches = await loadBatchSummaries();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Link
        href="/games/trivia"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Trivia
      </Link>
      <h1 className="mt-2 font-serif text-2xl tracking-tight text-foreground">
        Trivia question bank
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Grow the question bank on demand. Ask the kids what they want to be quizzed on.
      </p>
      <TriviaGenerator batches={batches} />
    </main>
  );
}
