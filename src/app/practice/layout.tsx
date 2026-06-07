import { Header } from "@/components/layout/header";
import { TransportBar } from "@/components/layout/transport-bar";
import { MetronomeProvider } from "@/components/metronome/metronome-context";
import { TaskTimerProvider } from "@/components/timer/task-timer-context";
import { VideoProvider } from "@/components/video/video-context";
import { SearchProvider } from "@/components/search/search-provider";
import { TimezoneProvider } from "@/components/timezone-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/server";
import { getTodaySummary } from "@/app/practice/timer/actions";
import type { Piece } from "@/lib/types";

export const metadata = {
  title: "Practice Log",
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const [{ data: activePieces }, { data: works }, todaySummary] =
    await Promise.all([
      supabase
        .from("pieces")
        .select(
          "id, work_id, name, composer, status, kind, notes, target_tempo, created_at, updated_at"
        )
        .eq("status", "active")
        .order("name"),
      supabase.from("works").select("id, name"),
      getTodaySummary(),
    ]);

  const worksById: Record<string, string> = {};
  for (const w of works ?? []) worksById[w.id] = w.name;

  const initialDailySeconds = todaySummary.reduce(
    (sum, e) => sum + e.total_seconds,
    0
  );

  return (
    <SearchProvider>
      <MetronomeProvider>
        <TooltipProvider>
          <TimezoneProvider />
          <div className="flex min-h-full flex-1 flex-col">
            <VideoProvider>
              <TaskTimerProvider
                activePieces={(activePieces as Piece[]) ?? []}
                worksById={worksById}
                initialDailySeconds={initialDailySeconds}
              >
                <Header />
                <div className="flex flex-1 flex-col">{children}</div>
                <TransportBar />
              </TaskTimerProvider>
            </VideoProvider>
          </div>
        </TooltipProvider>
      </MetronomeProvider>
    </SearchProvider>
  );
}
