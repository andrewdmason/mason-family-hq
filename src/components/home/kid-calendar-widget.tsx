import { CalendarDays } from "lucide-react";
import { WidgetCard } from "./widget-card";
import { formatTimeRange } from "@/lib/calendar/calendar-utils";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { KidAgenda } from "@/lib/home/types";

function EventList({
  events,
  emptyLabel,
}: {
  events: CalendarEvent[];
  emptyLabel: string;
}) {
  if (events.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {events.map((event) => (
        <li key={event.id} className="text-sm leading-snug">
          <span className="text-muted-foreground">
            {formatTimeRange(event.start_time, event.end_time, event.all_day)}
          </span>{" "}
          <span className="text-foreground">{event.title}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The kid Home sidebar's calendar: their own events for today and tomorrow.
 * The title opens the full Calendar app.
 */
export function KidCalendarWidget({ agenda }: { agenda: KidAgenda }) {
  return (
    <WidgetCard title="Calendar" icon={CalendarDays} href="/calendar">
      <div className="space-y-4">
        <section>
          <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            Today
          </div>
          <EventList events={agenda.today} emptyLabel="No more events today." />
        </section>
        <section>
          <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            Tomorrow
          </div>
          <EventList
            events={agenda.tomorrow}
            emptyLabel="Nothing scheduled tomorrow."
          />
        </section>
      </div>
    </WidgetCard>
  );
}
