import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { TriviaGame } from "@/components/games/trivia-game";
import { loadSetupData } from "./actions";

export const dynamic = "force-dynamic";

export default async function TriviaPage() {
  const data = await loadSetupData();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Link
        href="/games"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Games
      </Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="font-serif text-2xl tracking-tight text-foreground">Trivia</h1>
        <Link
          href="/games/trivia/history"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          History
        </Link>
      </div>
      <div className="mt-6">
        <TriviaGame data={data} />
      </div>
    </main>
  );
}
