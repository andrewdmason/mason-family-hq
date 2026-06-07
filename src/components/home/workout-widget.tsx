import Link from "next/link";
import { Dumbbell, CheckCircle2 } from "lucide-react";
import { WidgetCard } from "./widget-card";
import { OpenEventButton } from "@/components/workouts/open-event-button";
import { dayLabel } from "@/lib/workouts/format";
import type { HomeWorkout } from "@/lib/home/workouts";

/**
 * The workout to focus on. Today's stays in focus until it's marked done; then it
 * shifts to the next scheduled workout with a "today done" indicator. The title
 * links into the Workouts app.
 */
export function WorkoutWidget({
  workout,
  today,
}: {
  workout: HomeWorkout;
  today: string;
}) {
  if (workout === null) {
    return (
      <WidgetCard title="Workout" icon={Dumbbell} href="/workouts">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">No workout scheduled.</p>
          <Link
            href="/workouts/new"
            className="text-sm text-primary transition-opacity hover:opacity-80"
          >
            Log one
          </Link>
        </div>
      </WidgetCard>
    );
  }

  const { focus, todayCompleted } = workout;
  const when = dayLabel(focus.date, today);

  return (
    <WidgetCard title="Workout" icon={Dumbbell} href="/workouts">
      {todayCompleted && (
        <p className="mb-2 inline-flex items-center gap-1.5 text-xs text-primary">
          <CheckCircle2 className="size-3.5" />
          Today&apos;s workout complete
        </p>
      )}

      {focus.kind === "event" ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-serif text-base text-foreground">
              {focus.title}
            </p>
            <p className="text-xs text-muted-foreground">{when}</p>
          </div>
          <OpenEventButton eventId={focus.eventId} label="Open" />
        </div>
      ) : (
        <Link href={`/workouts/${focus.sessionId}`} className="block">
          <div className="flex items-center gap-2">
            <p className="truncate font-serif text-base text-foreground">
              {focus.title}
            </p>
            {focus.completed && (
              <CheckCircle2 className="size-4 shrink-0 text-primary" />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {when}
            {focus.completed
              ? " · completed"
              : ` · ${focus.blockCount} ${focus.blockCount === 1 ? "block" : "blocks"} · tap to log`}
          </p>
        </Link>
      )}
    </WidgetCard>
  );
}
