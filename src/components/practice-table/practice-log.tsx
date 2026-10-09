"use client";

import { PracticeTable } from "@/components/practice-table/practice-table";
import { RepertoireFocusPanel } from "@/components/timer/repertoire-focus-panel";
import { TwoColumnLayout } from "@/components/layout/two-column-layout";
import { PracticeLogHeader } from "@/components/layout/practice-log-header";
import { PracticeDayProvider } from "@/components/practice-table/practice-day-context";
import { LogModeProvider } from "@/components/practice-table/log-mode";
import type { PracticeView } from "@/app/practice/feed/actions";
import type { LogMode } from "@/lib/practice/quick-log";

/** The practice log: one day at a time, with the repertoire alongside. */
export function PracticeLog({
  initialView,
  initialMode,
}: {
  initialView: PracticeView;
  initialMode: LogMode;
}) {
  return (
    <PracticeDayProvider initialToday={initialView.today}>
      <LogModeProvider initialMode={initialMode}>
        <PracticeLogHeader />
        <TwoColumnLayout
          left={<PracticeTable initialView={initialView} />}
          right={<RepertoireFocusPanel />}
        />
      </LogModeProvider>
    </PracticeDayProvider>
  );
}
