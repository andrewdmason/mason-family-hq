import { ReadingHeader } from "@/components/reading/reading-header";
import { TimezoneProvider } from "@/components/timezone-provider";

export default function ReadingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TimezoneProvider />
      <ReadingHeader />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
