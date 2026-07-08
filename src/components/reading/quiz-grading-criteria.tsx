"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EssayCriteriaContent } from "@/components/reading/essay-criteria";

/**
 * The reader-facing "how you'll be graded" overview, opened from the writing surface
 * (mainly on narrow screens, where the always-on criteria sidebar collapses). Renders
 * the same static criteria the sidebar shows. Provides its own trigger so it can drop
 * straight into a sentence.
 */
export function GradingCriteriaDialog({
  triggerClassName,
}: {
  triggerClassName?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger className={triggerClassName}>
        See grading criteria
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How your essay is graded</DialogTitle>
          <DialogDescription>
            Two quick pass/fail checks, then your writing is graded on one thing:
            the quality of your thinking.
          </DialogDescription>
        </DialogHeader>

        <EssayCriteriaContent />
      </DialogContent>
    </Dialog>
  );
}
