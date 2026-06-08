import { GlobalHeader } from "@/components/layout/global-header";
import { TimezoneProvider } from "@/components/timezone-provider";
import { appMetadata } from "@/lib/pwa/apps";

export const metadata = appMetadata("reader");

export default function ReadingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TimezoneProvider />
      <GlobalHeader />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
