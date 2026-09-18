"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MiniCalendar } from "@/components/ui/mini-calendar";
import { addDays, localDate } from "@/lib/date-utils";

const RESUME_REQUEST_EVENT = "practice-resume-repeat-request";

type ResumeRequest = {
  /** The item's name when it's just one, for the question. */
  pieceName: string | null;
  count: number;
  resolve: (date: string | null) => void;
};

/**
 * Ask when a repeating item should come back, for the case the schedule can't
 * answer: its next slot has already gone by (a vacation, a long stretch of not
 * checking things off). Resolves to the chosen day, or null if the question was
 * dismissed — in which case the caller archives nothing.
 */
export function requestResumeDate(input: {
  pieceName: string | null;
  count: number;
}): Promise<string | null> {
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent<ResumeRequest>(RESUME_REQUEST_EVENT, {
        detail: { ...input, resolve },
      }),
    );
  });
}

/** Mounted once for the log; answers requestResumeDate. */
export function ResumeRepeatDialogHost() {
  const [request, setRequest] = useState<ResumeRequest | null>(null);
  const [picking, setPicking] = useState(false);
  const answeredRef = useRef(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ResumeRequest>).detail;
      answeredRef.current = false;
      setPicking(false);
      setRequest(detail);
    };
    window.addEventListener(RESUME_REQUEST_EVENT, handler);
    return () => window.removeEventListener(RESUME_REQUEST_EVENT, handler);
  }, []);

  const answer = (date: string | null) => {
    if (!request || answeredRef.current) return;
    answeredRef.current = true;
    request.resolve(date);
    setRequest(null);
  };

  const today = localDate();
  const title =
    request && request.count > 1
      ? `When should these ${request.count} repeating items come back?`
      : request?.pieceName
        ? `When should “${request.pieceName}” come back?`
        : "When should this come back?";

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) answer(null);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {request && request.count > 1
              ? "Their usual days have already gone by, so they'll pick up from the day you choose."
              : "Its usual day has already gone by, so it'll pick up from the day you choose."}
          </DialogDescription>
        </DialogHeader>
        {picking && (
          <MiniCalendar
            selected={new Date(`${addDays(today, 1)}T12:00:00`)}
            onSelect={(d) => {
              const picked = localDate(d);
              if (picked >= today) answer(picked);
            }}
            className="mx-auto w-full max-w-xs"
          />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setPicking((p) => !p)}>
            {picking ? "Hide dates" : "Pick a date"}
          </Button>
          <Button variant="outline" onClick={() => answer(addDays(today, 1))}>
            Tomorrow
          </Button>
          <Button autoFocus onClick={() => answer(today)}>
            Today
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
