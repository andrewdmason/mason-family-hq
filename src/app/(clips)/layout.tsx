import { appMetadata } from "@/lib/pwa/apps";

export const metadata = appMetadata("clips");

// The feed and upload screens add the global header (see (browse)/layout.tsx);
// the at-bat player runs full-bleed without it.
export default function ClipsLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full flex-1 flex-col">{children}</div>;
}
