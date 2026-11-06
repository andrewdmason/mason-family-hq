import "katex/dist/katex.min.css";
import { GlobalHeader } from "@/components/layout/global-header";
import { appMetadata } from "@/lib/pwa/apps";

export const metadata = appMetadata("tuttles");

export default function TuttlesLayout({
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
