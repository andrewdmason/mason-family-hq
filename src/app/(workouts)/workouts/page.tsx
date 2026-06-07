import Link from "next/link";
import { Dumbbell, CheckCircle2, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireUserId, getIsOwner } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { listWorkoutEvents } from "@/lib/workouts/calendar";
import { getWorkoutTrend } from "@/lib/workouts/progress";
import { dayLabel, formatSessionDate, relativeDays } from "@/lib/workouts/format";
import { OpenEventButton } from "@/components/workouts/open-event-button";
import { WorkoutsHeader } from "@/components/workouts/workouts-header";
import { WorkoutTrendWidget } from "@/components/workouts/workout-trend-widget";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type TodoRow =
  | { kind: "event"; date: string; title: string; eventId: string }
  | {
      kind: "session";
      date: string;
      title: string;
      blockCount: number;
      id: string;
    };

type DoneRow = {
  date: string;
  title: string;
  blockCount: number;
  id: string;
};

export default async function WorkoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const activeTab = tab === "completed" ? "completed" : "todo";

  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  const now = new Date();
  const fromIso = new Date(now.getTime() - 12 * 3600_000).toISOString();
  const toIso = new Date(now.getTime() + 21 * 86_400_000).toISOString();

  const [{ data: sessionRows }, events, isOwner] = await Promise.all([
    supabase
      .from("workout_sessions")
      .select(
        "id, session_date, title, source, completed_at, calendar_event_id, workout_blocks(count)"
      )
      .order("session_date", { ascending: false }),
    listWorkoutEvents(supabase, userId, { fromIso, toIso }).catch(() => []),
    getIsOwner(supabase),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessions = ((sessionRows ?? []) as any[]).map((s) => ({
    id: s.id as string,
    date: s.session_date as string,
    title: (s.title as string | null) ?? "Workout",
    blockCount: s.workout_blocks?.[0]?.count ?? 0,
    completed: s.completed_at !== null,
    calendarEventId: s.calendar_event_id as string | null,
  }));

  const linkedEventIds = new Set(
    sessions
      .map((s) => s.calendarEventId)
      .filter((id): id is string => !!id)
  );

  // To do = scheduled-but-unopened calendar workouts + opened-but-not-completed
  // sessions, soonest first.
  const eventRows: TodoRow[] = events
    .filter((e) => !linkedEventIds.has(e.id))
    .map((e) => ({
      kind: "event" as const,
      date: localDate(new Date(e.startTime), tz),
      title: e.title,
      eventId: e.id,
    }))
    .filter((e) => e.date >= today);
  const openSessionRows: TodoRow[] = sessions
    .filter((s) => !s.completed)
    .map((s) => ({
      kind: "session" as const,
      date: s.date,
      title: s.title,
      blockCount: s.blockCount,
      id: s.id,
    }));
  const todoRows = [...eventRows, ...openSessionRows].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // Completed = logged & closed, most recent first.
  const doneRows: DoneRow[] = sessions
    .filter((s) => s.completed)
    .map((s) => ({ date: s.date, title: s.title, blockCount: s.blockCount, id: s.id }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const trend =
    activeTab === "completed" ? null : await getWorkoutTrend(supabase, today);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
      <WorkoutsHeader
        active={activeTab === "completed" ? "history" : "home"}
        isOwner={isOwner}
      />

      {activeTab === "completed" ? (
        <DoneTable rows={doneRows} today={today} />
      ) : (
        <>
          {trend && (
            <div className="mb-6">
              <WorkoutTrendWidget trend={trend} />
            </div>
          )}
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Upcoming
          </h2>
          <TodoTable rows={todoRows} today={today} />
        </>
      )}
    </main>
  );
}

function TableShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

const TH =
  "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground";
const TD = "px-3 py-2.5 align-middle";

function DateCell({ date, subLabel }: { date: string; subLabel: string }) {
  return (
    <td className={cn(TD, "whitespace-nowrap")}>
      <div className="text-foreground">{formatSessionDate(date)}</div>
      <div className="text-xs text-muted-foreground">{subLabel}</div>
    </td>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={3} className="px-3 py-12 text-center">
        <Dumbbell className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">{children}</p>
      </td>
    </tr>
  );
}

function TodoTable({ rows, today }: { rows: TodoRow[]; today: string }) {
  return (
    <TableShell>
      <thead className="bg-muted/30">
        <tr>
          <th className={TH}>Date</th>
          <th className={TH}>Workout</th>
          <th className={cn(TH, "text-right")}>{""}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow>
            Nothing queued. Workouts on your calendar show up here to open and log.
          </EmptyRow>
        ) : (
          rows.map((row) => (
            <tr
              key={row.kind === "event" ? `e:${row.eventId}` : `s:${row.id}`}
              className="border-t border-border/60 hover:bg-accent/30"
            >
              <DateCell date={row.date} subLabel={dayLabel(row.date, today)} />
              <td className={cn(TD, "w-full")}>
                {row.kind === "session" ? (
                  <Link
                    href={`/workouts/${row.id}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {row.title}
                  </Link>
                ) : (
                  <span className="font-medium text-foreground">{row.title}</span>
                )}
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {row.kind === "event" ? "Calendar" : "Logging"}
                </span>
              </td>
              <td className={cn(TD, "text-right")}>
                {row.kind === "event" ? (
                  <OpenEventButton eventId={row.eventId} label="Open" />
                ) : (
                  <Link
                    href={`/workouts/${row.id}`}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    Log
                    <ChevronRight className="size-4" />
                  </Link>
                )}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </TableShell>
  );
}

function DoneTable({ rows, today }: { rows: DoneRow[]; today: string }) {
  return (
    <TableShell>
      <thead className="bg-muted/30">
        <tr>
          <th className={TH}>Date</th>
          <th className={TH}>Workout</th>
          <th className={cn(TH, "whitespace-nowrap text-right")}>Blocks</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow>No completed workouts yet.</EmptyRow>
        ) : (
          rows.map((row) => (
            <tr key={row.id} className="border-t border-border/60 hover:bg-accent/30">
              <DateCell date={row.date} subLabel={relativeDays(row.date, today)} />
              <td className={cn(TD, "w-full")}>
                <Link
                  href={`/workouts/${row.id}`}
                  className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
                >
                  <CheckCircle2 className="size-4 shrink-0 text-primary" />
                  {row.title}
                </Link>
              </td>
              <td className={cn(TD, "whitespace-nowrap text-right tabular-nums text-muted-foreground")}>
                {row.blockCount}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </TableShell>
  );
}
