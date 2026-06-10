export type TodoBucket = "inbox" | "today" | "anytime" | "someday";

/** The sidebar views. The first four map 1:1 to buckets; snoozed and
 * delegated are status lenses; logbook is history. */
export type TodoView =
  | "inbox"
  | "today"
  | "anytime"
  | "someday"
  | "snoozed"
  | "delegated"
  | "logbook";

export const TODO_VIEWS: TodoView[] = [
  "inbox",
  "today",
  "anytime",
  "someday",
  "snoozed",
  "delegated",
  "logbook",
];

export function isTodoView(value: string): value is TodoView {
  return (TODO_VIEWS as string[]).includes(value);
}

const VIEW_LABELS: Record<TodoView, string> = {
  inbox: "Inbox",
  today: "Today",
  anytime: "Anytime",
  someday: "Someday",
  snoozed: "Snoozed",
  delegated: "Delegated",
  logbook: "Logbook",
};

export function viewLabel(view: TodoView): string {
  return VIEW_LABELS[view];
}

export type TodoMember = {
  email: string;
  name: string | null;
  color: string | null;
};

export type TodoProject = {
  id: string;
  name: string;
  areaId: string | null;
  sortOrder: number;
  memberEmails: string[];
};

export type TodoArea = {
  id: string;
  name: string;
  sortOrder: number;
};

export type TodoTask = {
  id: string;
  title: string;
  notesHtml: string | null;
  bucket: TodoBucket;
  assigneeEmail: string;
  creatorEmail: string;
  projectId: string | null;
  snoozedUntil: string | null;
  completedAt: string | null;
  completedByEmail: string | null;
  sortOrder: number;
  assigneeSeenAt: string | null;
  createdAt: string;
};

/** Raw row shape from supabase selects — mapped to TodoTask via taskFromRow. */
export type TodoTaskRow = {
  id: string;
  title: string;
  notes_html: string | null;
  bucket: TodoBucket;
  assignee_email: string;
  creator_email: string;
  project_id: string | null;
  snoozed_until: string | null;
  completed_at: string | null;
  completed_by_email: string | null;
  sort_order: number;
  assignee_seen_at: string | null;
  created_at: string;
};

export const TASK_COLUMNS =
  "id, title, notes_html, bucket, assignee_email, creator_email, project_id, snoozed_until, completed_at, completed_by_email, sort_order, assignee_seen_at, created_at";

export function taskFromRow(row: TodoTaskRow): TodoTask {
  return {
    id: row.id,
    title: row.title,
    notesHtml: row.notes_html,
    bucket: row.bucket,
    assigneeEmail: row.assignee_email,
    creatorEmail: row.creator_email,
    projectId: row.project_id,
    snoozedUntil: row.snoozed_until,
    completedAt: row.completed_at,
    completedByEmail: row.completed_by_email,
    sortOrder: row.sort_order,
    assigneeSeenAt: row.assignee_seen_at,
    createdAt: row.created_at,
  };
}
