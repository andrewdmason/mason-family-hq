import { CalendarHeader } from "@/components/calendar/calendar-header";
import { TimezoneProvider } from "@/components/timezone-provider";

export default function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TimezoneProvider />
      <CalendarHeader />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
