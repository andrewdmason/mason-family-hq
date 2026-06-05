import { TimelineHeader } from "@/components/timeline/timeline-header";
import { TimezoneProvider } from "@/components/timezone-provider";
import { getIsOwner } from "@/lib/members/auth";

export default async function TimelineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isOwner = await getIsOwner();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TimezoneProvider />
      <TimelineHeader isOwner={isOwner} />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
