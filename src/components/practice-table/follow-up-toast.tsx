"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Toast, ToastViewport } from "@/components/ui/toast";
import {
  FollowUpDialog,
  type FollowUpDefaults,
} from "@/components/practice-table/follow-up-dialog";

const FOLLOW_UP_SCHEDULED_EVENT = "practice-follow-up-scheduled";
const TOAST_DURATION_MS = 8000;

export type FollowUpScheduledDetail = {
  /** The follow-up item that was just created — the toast edits this, not the row. */
  taskId: string;
  pieceName: string | null;
  targetDate: string;
  tomorrowDate: string;
  dayAfterDate: string;
  sessionNumber: number;
  defaults: FollowUpDefaults;
};

export function emitFollowUpScheduled(detail: FollowUpScheduledDetail): void {
  window.dispatchEvent(
    new CustomEvent<FollowUpScheduledDetail>(FOLLOW_UP_SCHEDULED_EVENT, {
      detail,
    })
  );
}

/**
 * Confirms the "archive and repeat tomorrow" action and offers a way back into
 * the details. Mounted once at the table so it outlives the row that triggered
 * it: archiving hides that row in the next-session view, and the toast still
 * has to be clickable afterwards.
 */
export function FollowUpToastHost({
  sessionNumbersByDate,
}: {
  sessionNumbersByDate: Record<string, number[]>;
}) {
  const [scheduled, setScheduled] = useState<
    (FollowUpScheduledDetail & { key: number }) | null
  >(null);
  const [editOpen, setEditOpen] = useState(false);
  const keyRef = useRef(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FollowUpScheduledDetail>).detail;
      keyRef.current += 1;
      setScheduled({ ...detail, key: keyRef.current });
      setEditOpen(false);
    };
    window.addEventListener(FOLLOW_UP_SCHEDULED_EVENT, handler);
    return () => window.removeEventListener(FOLLOW_UP_SCHEDULED_EVENT, handler);
  }, []);

  // Dismiss on its own, unless the sheet is open — then the toast is gone from
  // view anyway and clearing it would unmount the sheet mid-edit.
  const toastKey = scheduled?.key ?? null;
  useEffect(() => {
    if (toastKey === null || editOpen) return;
    const t = setTimeout(() => setScheduled(null), TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [toastKey, editOpen]);

  const handleEditOpenChange = useCallback((open: boolean) => {
    setEditOpen(open);
    if (!open) setScheduled(null);
  }, []);

  if (!scheduled) return null;

  const isDayAfter = scheduled.targetDate === scheduled.dayAfterDate;
  const whenLabel = isDayAfter ? "the day after" : "tomorrow";

  return (
    <>
      {!editOpen && (
        <ToastViewport>
          <Toast
            key={scheduled.key}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="min-w-0 text-muted-foreground">
              {scheduled.pieceName
                ? `Added “${scheduled.pieceName}” to ${whenLabel}`
                : `Added to ${whenLabel}`}
            </span>
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="shrink-0 font-medium text-primary hover:underline"
            >
              Edit
            </button>
          </Toast>
        </ToastViewport>
      )}
      <FollowUpDialog
        open={editOpen}
        onOpenChange={handleEditOpenChange}
        taskId={scheduled.taskId}
        defaults={scheduled.defaults}
        initialDate={scheduled.targetDate}
        tomorrowDate={scheduled.tomorrowDate}
        dayAfterDate={scheduled.dayAfterDate}
        tomorrowSessions={sessionNumbersByDate[scheduled.tomorrowDate] ?? []}
        dayAfterSessions={sessionNumbersByDate[scheduled.dayAfterDate] ?? []}
        defaultSessionNumber={scheduled.sessionNumber}
      />
    </>
  );
}
