import { GlobalHeader } from "@/components/layout/global-header";
import { TimezoneProvider } from "@/components/timezone-provider";
import { ProfileSuggestionToaster } from "@/components/journal/profile-suggestion-toaster";
import { JournalTimerProvider } from "@/components/journal/timer-context";

export default async function JournalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <JournalTimerProvider>
      <div className="flex min-h-full flex-1 flex-col">
        <TimezoneProvider />
        <GlobalHeader />
        <div className="flex flex-1 flex-col">{children}</div>
        <ProfileSuggestionToaster />
      </div>
    </JournalTimerProvider>
  );
}
