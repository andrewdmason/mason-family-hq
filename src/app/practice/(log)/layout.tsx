import { cookies } from "next/headers";
import { PracticeLog } from "@/components/practice-table/practice-log";
import { getPracticeView } from "@/app/practice/feed/actions";
import { LOG_MODE_COOKIE, parseLogMode } from "@/lib/practice/quick-log";

// Renders today's view; a ?date= for another day is picked up on the client,
// which keeps the day cache (see page.tsx for why it isn't read here).
export default async function PracticeLogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [initialView, jar] = await Promise.all([getPracticeView(), cookies()]);

  return (
    <>
      <PracticeLog
        initialView={initialView}
        initialMode={parseLogMode(jar.get(LOG_MODE_COOKIE)?.value)}
      />
      {children}
    </>
  );
}
