import { PracticeLog } from "@/components/practice-table/practice-log";
import { getPracticeView } from "@/app/practice/feed/actions";

// Renders today's view; a ?date= for another day is picked up on the client,
// which keeps the day cache (see page.tsx for why it isn't read here).
export default async function PracticeLogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialView = await getPracticeView();

  return (
    <>
      <PracticeLog initialView={initialView} />
      {children}
    </>
  );
}
