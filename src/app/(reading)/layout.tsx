import { ReadingHeader } from "@/components/reading/reading-header";
import { TimezoneProvider } from "@/components/timezone-provider";
import { getIsOwner } from "@/lib/members/auth";

export default async function ReadingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isOwner = await getIsOwner();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TimezoneProvider />
      <ReadingHeader isOwner={isOwner} />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
