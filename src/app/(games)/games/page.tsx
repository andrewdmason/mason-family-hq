import Link from "next/link";
import { Brain } from "lucide-react";

export const dynamic = "force-dynamic";

// The Games hub. Built to hold many family games over time; v1 ships one tile,
// Trivia. New games add a row here.
const GAMES = [
  {
    href: "/games/trivia",
    name: "Trivia",
    blurb: "Team trivia, made for us — pass-and-play at the table",
    icon: Brain,
  },
];

export default function GamesHome() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <h1 className="font-serif text-2xl tracking-tight text-foreground">Games</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Fun the whole family can play together.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {GAMES.map((game) => {
          const Icon = game.icon;
          return (
            <Link
              key={game.href}
              href={game.href}
              className="group flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-6 transition-colors hover:border-foreground/30 hover:bg-accent"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-foreground group-hover:bg-background">
                <Icon className="h-6 w-6" />
              </span>
              <span className="flex flex-col">
                <span className="font-serif text-lg text-foreground">{game.name}</span>
                <span className="text-xs text-muted-foreground">{game.blurb}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
