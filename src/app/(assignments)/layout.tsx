import { GlobalHeader } from "@/components/layout/global-header";
import { appMetadata } from "@/lib/pwa/apps";

export const metadata = appMetadata("assignments");

export default function AssignmentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <GlobalHeader />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
