import {
  createTaskOptimistic,
  emitOptimisticTask,
  type OptimisticTaskDetail,
} from "@/lib/optimistic-task";
import { emitFollowUpScheduled } from "@/components/practice-table/follow-up-toast";
import { loadSectionPickerData } from "@/lib/section-picker-cache";
import { addDays, localDate } from "@/lib/date-utils";

export type RepeatOccurrence = Omit<
  OptimisticTaskDetail,
  "tempId" | "afterTaskId"
> & {
  text: string;
  timerSeconds: number;
  sessionNumber: number;
  repeatIntervalDays: number | null;
  repeatSourceTaskId: string;
};

/**
 * Put a repeating item's next occurrence on the board right away rather than
 * stopping to ask. The toast that follows is the escape hatch for anyone who
 * wanted to change something about it, so it goes up immediately too — waiting
 * on the write would make finishing an item feel like a request instead of a
 * click. Shared by a row's own archive and the leftovers list's.
 */
export function scheduleRepeatOccurrence(occurrence: RepeatOccurrence): void {
  // Warm the section picker so the sheet is ready if the toast is taken up on.
  if (occurrence.pieceId) void loadSectionPickerData(occurrence.pieceId);

  const tempId = emitOptimisticTask(occurrence);
  const today = localDate();
  emitFollowUpScheduled({
    taskId: tempId,
    pieceName: occurrence.pieceName,
    targetDate: occurrence.date,
    alternateDates: [today, addDays(today, 1), addDays(today, 2)],
    sessionNumber: occurrence.sessionNumber,
    defaults: {
      pieceId: occurrence.pieceId,
      pieceName: occurrence.pieceName,
      pieceComposer: occurrence.pieceComposer,
      pieceKind: occurrence.pieceKind,
      sectionId: occurrence.sectionId,
      sectionLabel: occurrence.sectionLabel,
      sectionStatus: occurrence.sectionStatus,
      metronomeSpeed: occurrence.metronomeSpeed,
      timerSeconds: occurrence.timerSeconds,
      text: occurrence.text,
      repeatIntervalDays: occurrence.repeatIntervalDays,
    },
  });
  void createTaskOptimistic({ ...occurrence, existingTempId: tempId });
}
