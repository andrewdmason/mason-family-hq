"use client";

import { PracticeTable } from "@/components/practice-table/practice-table";
import { RepertoireFocusPanel } from "@/components/timer/repertoire-focus-panel";
import { TwoColumnLayout } from "@/components/layout/two-column-layout";
import { PracticeLogHeader } from "@/components/layout/practice-log-header";
import { PracticeDayProvider } from "@/components/practice-table/practice-day-context";
import { ResumeRepeatDialogHost } from "@/components/practice-table/resume-repeat-dialog";
import type { PracticeView } from "@/app/practice/feed/actions";

/** The practice log: one day at a time, with the repertoire alongside. */
export function PracticeLog({ initialView }: { initialView: PracticeView }) {
  return (
    <PracticeDayProvider initialToday={initialView.today}>
      <PracticeLogHeader />
      <TwoColumnLayout
        left={<PracticeTable initialView={initialView} />}
        right={<RepertoireFocusPanel />}
      />
      <ResumeRepeatDialogHost />
    </PracticeDayProvider>
  );
}
