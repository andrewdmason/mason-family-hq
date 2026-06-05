import { CalendarRange } from "lucide-react";
import { WidgetCard } from "./widget-card";
import { formatTimeRange } from "@/lib/calendar/calendar-utils";
import type { MemberDay } from "@/lib/home/types";

/**
 * The sidebar window into everyone else's day: today's events grouped by family
 * member, so you have awareness of what the rest of the family is up to. Content
 * is naturally vertical (a list per person), so this sits as a tall sidebar
 * card. The title opens the Calendar.
 */
export function OthersDayWidget({ days }: { days: MemberDay[] }) {
  return (
    <WidgetCard title="Family today" icon={CalendarRange} href="/calendar">
      {days.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          Nothing on anyone else&apos;s calendar today.
        </p>
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <div key={day.email || day.name}>
              <div className="flex items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: day.color ?? undefined }}
                />
                <span className="font-serif text-sm text-foreground">
                  {day.name}
                </span>
              </div>
              <ul className="mt-1.5 space-y-1 pl-[1.125rem]">
                {day.events.map((event) => (
                  <li key={event.id} className="text-sm leading-snug">
                    <span className="text-muted-foreground">
                      {formatTimeRange(
                        event.start_time,
                        event.end_time,
                        event.all_day
                      )}
                    </span>{" "}
                    <span className="text-foreground">{event.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
