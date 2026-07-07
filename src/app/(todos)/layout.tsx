import { Suspense } from "react";
import { GlobalHeader } from "@/components/layout/global-header";
import { TimezoneProvider } from "@/components/timezone-provider";
import { RefreshOnReturn } from "@/components/refresh-on-return";
import { TodosShortcuts } from "@/components/todos/todos-shortcuts";
import { appMetadata } from "@/lib/pwa/apps";

export const metadata = appMetadata("todos");

export default function TodosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TimezoneProvider />
      {/* Layout-level so every todos screen (views, project, browse) picks up
          phone/other-member additions when the window regains focus. */}
      <RefreshOnReturn />
      {/* Suspense: TodosShortcuts reads useSearchParams (the ?as= param). */}
      <Suspense fallback={null}>
        <TodosShortcuts />
      </Suspense>
      <GlobalHeader />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
