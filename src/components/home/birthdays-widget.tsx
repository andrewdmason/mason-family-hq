import { Cake } from "lucide-react";
import { WidgetCard } from "./widget-card";
import type { UpcomingBirthday } from "@/lib/home/types";

function countdown(daysUntil: number): string {
  if (daysUntil === 0) return "Today!";
  if (daysUntil === 1) return "Tomorrow";
  if (daysUntil < 14) return `in ${daysUntil} days`;
  if (daysUntil < 60) return `in ${Math.round(daysUntil / 7)} weeks`;
  return `in ${Math.round(daysUntil / 30)} months`;
}

/**
 * A small sidebar window into upcoming family birthdays, soonest first. Rendered
 * only when there's at least one to show (the page omits it otherwise).
 */
export function BirthdaysWidget({
  birthdays,
}: {
  birthdays: UpcomingBirthday[];
}) {
  return (
    <WidgetCard title="Birthdays" icon={Cake}>
      <ul className="space-y-2">
        {birthdays.map((b) => (
          <li
            key={`${b.name}-${b.date}`}
            className="flex items-baseline justify-between gap-2"
          >
            <span className="font-serif text-sm text-foreground">
              {b.name}
              {b.turningAge != null && (
                <span className="text-muted-foreground"> turns {b.turningAge}</span>
              )}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {countdown(b.daysUntil)}
            </span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}
