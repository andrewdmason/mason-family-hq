import { TimelineHeader } from "@/components/timeline/timeline-header";
import { TimezoneProvider } from "@/components/timezone-provider";

export default function TimelineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TimezoneProvider />
      <TimelineHeader />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
