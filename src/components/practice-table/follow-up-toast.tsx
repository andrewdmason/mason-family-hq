"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Toast, ToastViewport } from "@/components/ui/toast";
import {
  FollowUpDialog,
  type FollowUpDefaults,
} from "@/components/practice-table/follow-up-dialog";
import { relativeDayPhrase } from "@/lib/practice/repeat";
import type { OptimisticTaskRename } from "@/lib/optimistic-task";

const FOLLOW_UP_SCHEDULED_EVENT = "practice-follow-up-scheduled";
const TOAST_DURATION_MS = 8000;

export type FollowUpScheduledDetail = {
  /** The occurrence that was just scheduled — the toast edits this, not the row. */
  taskId: string;
  pieceName: string | null;
  targetDate: string;
  /** Nearby days the sheet offers besides the scheduled one. */
  alternateDates: string[];
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
 * Confirms that archiving a repeating item scheduled its next occurrence, and
 * offers a way into the details. Mounted once at the table so it outlives the
 * row that triggered it: archiving hides that row in the focus view, and the
 * toast still has to be clickable afterwards.
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

  // The toast goes up before the write lands, so it starts out holding the
  // placeholder id. Adopt the real one as soon as the server hands it back.
  useEffect(() => {
    const handler = (e: Event) => {
      const { tempId, realId } = (e as CustomEvent<OptimisticTaskRename>).detail;
      setScheduled((prev) =>
        prev && prev.taskId === tempId ? { ...prev, taskId: realId } : prev
      );
    };
    window.addEventListener("task-rename-optimistic", handler);
    return () => window.removeEventListener("task-rename-optimistic", handler);
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

  const dateOptions = [
    ...new Set([scheduled.targetDate, ...scheduled.alternateDates]),
  ].sort();
  const whenPhrase = relativeDayPhrase(scheduled.targetDate);

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
                ? `“${scheduled.pieceName}” is back ${whenPhrase}`
                : `Back ${whenPhrase}`}
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
        dateOptions={dateOptions}
        sessionNumbersByDate={sessionNumbersByDate}
        defaultSessionNumber={scheduled.sessionNumber}
      />
    </>
  );
}
