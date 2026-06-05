import { FamilyHeader } from "@/components/family/header";
import { TimezoneProvider } from "@/components/timezone-provider";

export default function FamilyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TimezoneProvider />
      <FamilyHeader />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
