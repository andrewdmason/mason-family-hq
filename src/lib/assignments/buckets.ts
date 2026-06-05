// Pure due-date bucketing, shared by the server (queries) and client (the
// assignments UI). No server-only deps so it's safe to import either side.

import type { DueBucket, SchoolAssignment } from "./types";

/** Bucket a due date relative to a reference "today" (local midnight). */
export function bucketFor(
  dueDate: string | null,
  today: Date = new Date(),
): DueBucket {
  if (!dueDate) return "no_date";
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return "no_date";
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (due.getTime() - start.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays <= 7) return "this_week";
  return "later";
}

/** Group a kid's assignments by due bucket, preserving input order within each. */
export function groupByBucket(
  assignments: SchoolAssignment[],
  today: Date = new Date(),
): Map<DueBucket, SchoolAssignment[]> {
  const groups = new Map<DueBucket, SchoolAssignment[]>();
  for (const a of assignments) {
    const bucket = bucketFor(a.due_date, today);
    const list = groups.get(bucket) ?? [];
    list.push(a);
    groups.set(bucket, list);
  }
  return groups;
}
