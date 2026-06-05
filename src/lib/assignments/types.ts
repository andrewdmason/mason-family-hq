// School Assignments app types. The data originates from Bentley's Blackbaud
// (myschoolapp.com) portal; see src/lib/assignments/myschoolapp.ts for the
// integration and supabase/migrations/00100_school_assignments.sql for storage.

export type AssignmentStatus = "assigned" | "submitted" | "graded" | "missing";

/** A synced (or manually-added) school assignment row. */
export type SchoolAssignment = {
  id: string;
  kid_email: string;
  external_id: string | null;
  title: string;
  short_description: string | null;
  long_description: string | null;
  course: string | null;
  assignment_type: string | null;
  date_assigned: string | null; // YYYY-MM-DD
  due_date: string | null; // YYYY-MM-DD
  due_time: string | null; // HH:MM:SS
  status: AssignmentStatus;
  max_points: number | null;
  points_earned: number | null;
  source_type: "blackbaud" | "manual";
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The bucket an assignment falls into, recomputed from due_date at render time. */
export type DueBucket =
  | "overdue"
  | "today"
  | "tomorrow"
  | "this_week"
  | "later"
  | "no_date";

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Due today",
  tomorrow: "Due tomorrow",
  this_week: "This week",
  later: "Later",
  no_date: "No due date",
};

/** The order buckets render in. */
export const DUE_BUCKET_ORDER: DueBucket[] = [
  "overdue",
  "today",
  "tomorrow",
  "this_week",
  "later",
  "no_date",
];

/** One kid's assignments, grouped for display (parents see several of these). */
export type KidAssignments = {
  kidEmail: string;
  kidName: string | null;
  assignments: SchoolAssignment[];
};
